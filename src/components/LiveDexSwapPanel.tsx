import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Laptop,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type {
  DexRouterOption,
  DexTokenOption,
  JupiterQuoteSummary,
  TerminalSnapshot,
} from '../types/terminal';

interface PhantomSigningProvider {
  isPhantom?: boolean;
  publicKey?: { toString: () => string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  signAndSendTransaction?: (
    transaction: VersionedTransaction,
    options?: { skipPreflight?: boolean; maxRetries?: number }
  ) => Promise<{ signature: string }>;
  signTransaction?: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
}

interface LiveDexSwapPanelProps {
  snapshot: TerminalSnapshot;
  initialOutputMint?: string | null;
  onRefreshState: (next: TerminalSnapshot) => void;
  onToast: (msg: string) => void;
  onOpenTransferTab?: () => void;
  embedded?: boolean;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function getPhantomProvider(): PhantomSigningProvider | null {
  const w = window as unknown as {
    phantom?: { solana?: PhantomSigningProvider };
    solana?: PhantomSigningProvider;
  };
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w.solana?.isPhantom) return w.solana;
  return null;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const LiveDexSwapPanel: React.FC<LiveDexSwapPanelProps> = ({
  snapshot,
  initialOutputMint,
  onRefreshState,
  onToast,
  onOpenTransferTab,
  embedded = false,
}) => {
  const [tokens, setTokens] = useState<DexTokenOption[]>([]);
  const [inputMint, setInputMint] = useState<string>(SOL_MINT);
  const [outputMint, setOutputMint] = useState<string>(USDC_MINT);
  const [customMintInput, setCustomMintInput] = useState<string>('');
  const [customMintAudit, setCustomMintAudit] = useState<{
    mint: string;
    decimals: number;
    mintAuthorityRevoked: boolean | null;
    freezeAuthorityRevoked: boolean | null;
    verified: boolean;
  } | null>(null);

  const [amountUi, setAmountUi] = useState<string>('0.05');
  const [slippagePct, setSlippagePct] = useState<string>('0.5');
  const [dexFilter, setDexFilter] = useState<DexRouterOption>('AUTO');
  const [priorityFeeLamports, setPriorityFeeLamports] = useState<number>(100_000);

  const [quote, setQuote] = useState<JupiterQuoteSummary | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [simResult, setSimResult] = useState<{
    ok: boolean;
    err: string | null;
    unitsConsumed: number | null;
    logs: string[];
  } | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTxSignature, setLastTxSignature] = useState<string | null>(null);
  const [phantomDetected, setPhantomDetected] = useState<boolean>(false);
  const [refreshingSig, setRefreshingSig] = useState<string | null>(null);

  useEffect(() => {
    setPhantomDetected(Boolean(getPhantomProvider()));
  }, []);

  // Load curated + scanner tokens
  useEffect(() => {
    apiFetch('/api/dex/tokens')
      .then((res) => res.json())
      .then((data: { ok?: boolean; tokens?: DexTokenOption[] }) => {
        if (data.ok && Array.isArray(data.tokens)) {
          setTokens(data.tokens);
        }
      })
      .catch(() => {});
  }, [snapshot.tokens]);

  useEffect(() => {
    if (initialOutputMint && initialOutputMint !== inputMint) {
      setOutputMint(initialOutputMint);
    }
  }, [initialOutputMint, inputMint]);

  const tokenMap = useMemo(() => {
    const map = new Map<string, DexTokenOption>();
    for (const t of tokens) map.set(t.mint, t);
    if (customMintAudit && !map.has(customMintAudit.mint)) {
      map.set(customMintAudit.mint, {
        mint: customMintAudit.mint,
        symbol: `${customMintAudit.mint.slice(0, 4)}..${customMintAudit.mint.slice(-3)}`,
        name: 'Custom Solana Token',
        decimals: customMintAudit.decimals,
        verified: customMintAudit.verified,
        source: 'On-Chain Mint Lookup',
      });
    }
    return map;
  }, [tokens, customMintAudit]);

  const inputTokenInfo = tokenMap.get(inputMint);
  const outputTokenInfo = tokenMap.get(outputMint);

  // Connected wallet balance for selected input token
  const availableInputBalance = useMemo(() => {
    if (!snapshot.wallet.connected) return null;
    if (inputMint === SOL_MINT) return snapshot.wallet.solBalance;
    const found = snapshot.wallet.tokenAccounts.find((ta) => ta.mint === inputMint);
    return found ? found.amount : 0;
  }, [snapshot.wallet, inputMint]);

  const fetchQuote = useCallback(async () => {
    const amt = Number(amountUi);
    if (!Number.isFinite(amt) || amt <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const slip = Math.min(15, Math.max(0.1, Number(slippagePct) || 0.5));
    const slippageBps = Math.round(slip * 100);

    setQuoteLoading(true);
    setQuoteError(null);
    setSimResult(null);
    try {
      const res = await apiFetch('/api/dex/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputMint,
          outputMint,
          amountUi: amt,
          slippageBps,
          dexFilter,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; quote?: JupiterQuoteSummary; error?: string };
      if (!res.ok || !data.ok || !data.quote) {
        throw new Error(data.error || 'Không lấy được báo giá Jupiter');
      }
      setQuote(data.quote);
    } catch (err) {
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : 'Lỗi lấy báo giá Jupiter');
    } finally {
      setQuoteLoading(false);
    }
  }, [inputMint, outputMint, amountUi, slippagePct, dexFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchQuote();
    }, 450);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  const handleConnectPhantomForSigning = async () => {
    setSwapError(null);
    const provider = getPhantomProvider();
    setPhantomDetected(Boolean(provider));
    if (!provider) {
      setSwapError(
        'Không phát hiện tiện ích Ví Phantom trên trình duyệt này. Trên máy tính hãy cài Phantom Extension; trên điện thoại hãy mở đường dẫn ứng dụng bên trong trình duyệt của ứng dụng Phantom.'
      );
      return;
    }
    try {
      setSwapBusy(true);
      const resp = await provider.connect({ onlyIfTrusted: false });
      const pubKey = resp.publicKey.toString();
      const res = await apiFetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicAddress: pubKey,
          connectionMethod: 'PHANTOM_EXTENSION',
          deviceType: 'Phantom Wallet (Non-Custodial Signer)',
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; snapshot?: TerminalSnapshot };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Đồng bộ ví Phantom thất bại');
      }
      onRefreshState(data.snapshot);
      onToast(`Đã kết nối Phantom (${pubKey.slice(0, 4)}...${pubKey.slice(-4)}) sẵn sàng ký giao dịch.`);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'Người dùng đã hủy kết nối Phantom.');
    } finally {
      setSwapBusy(false);
    }
  };

  const handleLookupCustomMint = async () => {
    const trimmed = customMintInput.trim();
    if (!trimmed) return;
    setQuoteError(null);
    try {
      const res = await apiFetch(`/api/dex/mint-info/${encodeURIComponent(trimmed)}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        info?: {
          mint: string;
          decimals: number;
          mintAuthorityRevoked: boolean | null;
          freezeAuthorityRevoked: boolean | null;
          verified: boolean;
        };
      };
      if (!res.ok || !data.ok || !data.info) {
        throw new Error(data.error || 'Địa chỉ Mint không hợp lệ trên Solana Mainnet');
      }
      setCustomMintAudit(data.info);
      setOutputMint(data.info.mint);
      onToast(`Đã kiểm tra Mint ${data.info.mint.slice(0, 6)}... (${data.info.decimals} decimals).`);
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : 'Lỗi kiểm tra Mint');
    }
  };

  const handleSimulateSwap = async () => {
    if (!quote) return;
    const pubKey = snapshot.wallet.publicAddress || 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg';
    setSimLoading(true);
    setSwapError(null);
    setSimResult(null);
    try {
      const buildRes = await apiFetch('/api/dex/build-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPublicKey: pubKey,
          quoteResponse: quote.rawQuoteResponse,
          priorityFeeLamports,
        }),
      });
      const built = (await buildRes.json()) as {
        ok?: boolean;
        swapTransaction?: string;
        error?: string;
      };
      if (!buildRes.ok || !built.ok || !built.swapTransaction) {
        throw new Error(built.error || 'Không tạo được giao dịch mô phỏng');
      }

      const simRes = await apiFetch('/api/dex/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapTransaction: built.swapTransaction }),
      });
      const simData = (await simRes.json()) as {
        ok?: boolean;
        error?: string;
        simulation?: { ok: boolean; err: string | null; unitsConsumed: number | null; logs: string[] };
      };
      if (!simRes.ok || !simData.ok || !simData.simulation) {
        throw new Error(simData.error || 'Mô phỏng RPC thất bại');
      }
      setSimResult(simData.simulation);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'Lỗi mô phỏng RPC');
    } finally {
      setSimLoading(false);
    }
  };

  const handleExecuteRealSwap = async () => {
    if (!quote) return;
    setSwapError(null);
    setLastTxSignature(null);

    if (inputMint === outputMint) {
      setSwapError('Token trả (Sell) và Token nhận (Buy) không được trùng nhau.');
      return;
    }
    if (availableInputBalance !== null && Number(amountUi) > availableInputBalance) {
      setSwapError(
        `Số dư ${inputTokenInfo?.symbol ?? 'tài sản'} hiện tại (${availableInputBalance.toFixed(4)}) không đủ để thực hiện lệnh ${amountUi}.`
      );
      return;
    }

    const provider = getPhantomProvider();
    if (!provider) {
      setSwapError(
        'Cần tiện ích Ví Phantom (Extension trên Desktop hoặc Trình duyệt trong app Phantom Mobile) để ký giao dịch thật an toàn không lộ Private Key.'
      );
      return;
    }

    setSwapBusy(true);
    try {
      const conn = await provider.connect({ onlyIfTrusted: false });
      const userPublicKey = conn.publicKey.toString();

      // 1. Fetch fresh quote immediately prior to build so slippage is accurate
      const freshQuoteRes = await apiFetch('/api/dex/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputMint,
          outputMint,
          amountUi: Number(amountUi),
          slippageBps: quote.slippageBps,
          dexFilter,
        }),
      });
      const freshQuoteData = (await freshQuoteRes.json()) as {
        ok?: boolean;
        quote?: JupiterQuoteSummary;
        error?: string;
      };
      if (!freshQuoteRes.ok || !freshQuoteData.ok || !freshQuoteData.quote) {
        throw new Error(freshQuoteData.error || 'Báo giá Jupiter vừa hết hạn, vui lòng thử lại.');
      }
      const activeQuote = freshQuoteData.quote;
      setQuote(activeQuote);

      // 2. Build unsigned VersionedTransaction from Jupiter v1 API
      const buildRes = await apiFetch('/api/dex/build-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPublicKey,
          quoteResponse: activeQuote.rawQuoteResponse,
          priorityFeeLamports,
        }),
      });
      const built = (await buildRes.json()) as {
        ok?: boolean;
        swapTransaction?: string;
        error?: string;
      };
      if (!buildRes.ok || !built.ok || !built.swapTransaction) {
        throw new Error(built.error || 'Không khởi tạo được giao dịch hoán đổi Jupiter.');
      }

      // 3. Deserialize unsigned VersionedTransaction and prompt Phantom Wallet UI to sign
      const unsignedTx = VersionedTransaction.deserialize(base64ToUint8Array(built.swapTransaction));

      let signature = '';
      if (typeof provider.signAndSendTransaction === 'function') {
        const result = await provider.signAndSendTransaction(unsignedTx, {
          skipPreflight: false,
          maxRetries: 3,
        });
        signature = result.signature;
      } else if (typeof provider.signTransaction === 'function') {
        const signedTx = await provider.signTransaction(unsignedTx);
        const signedBase64 = uint8ArrayToBase64(signedTx.serialize());
        const bRes = await apiFetch('/api/dex/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signedTransaction: signedBase64 }),
        });
        const bData = (await bRes.json()) as { ok?: boolean; signature?: string; error?: string };
        if (!bRes.ok || !bData.ok || !bData.signature) {
          throw new Error(bData.error || 'Phát giao dịch đã ký lên Solana RPC thất bại.');
        }
        signature = bData.signature;
      } else {
        throw new Error('Phiên bản Phantom Wallet này không hỗ trợ ký VersionedTransaction.');
      }

      setLastTxSignature(signature);

      // 4. Record & verify tx on Solana Mainnet RPC + sync wallet
      const recRes = await apiFetch('/api/dex/record-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          walletAddress: userPublicKey,
          routeLabels: activeQuote.routeLabels.join(' → '),
          inputMint,
          inputSymbol: inputTokenInfo?.symbol ?? inputMint.slice(0, 4),
          inputAmount: activeQuote.inAmountUi,
          outputMint,
          outputSymbol: outputTokenInfo?.symbol ?? outputMint.slice(0, 4),
          outputAmountEst: activeQuote.outAmountUi,
          slippageBps: activeQuote.slippageBps,
          priceImpactPct: activeQuote.priceImpactPct,
          priorityFeeLamports,
        }),
      });
      const recData = (await recRes.json()) as {
        ok?: boolean;
        status?: string;
        snapshot?: TerminalSnapshot;
      };
      if (recRes.ok && recData.snapshot) {
        onRefreshState(recData.snapshot);
      }
      onToast(`Đã gửi giao dịch thật qua Jupiter DEX! Tx: ${signature.slice(0, 8)}...`);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'Giao dịch thất bại hoặc đã bị hủy trên Phantom.');
    } finally {
      setSwapBusy(false);
    }
  };

  const handleRefreshTxStatus = async (sig: string) => {
    setRefreshingSig(sig);
    try {
      const res = await apiFetch(`/api/dex/refresh-tx/${encodeURIComponent(sig)}`, { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
      if (res.ok && data.snapshot) {
        onRefreshState(data.snapshot);
      }
    } finally {
      setRefreshingSig(null);
    }
  };

  const handleFlipPair = () => {
    setInputMint(outputMint);
    setOutputMint(inputMint);
    setQuote(null);
    setSimResult(null);
  };

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-4'}>
      {!embedded && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#39DEA2]/50 bg-[#06231F] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#39DEA2]/15 text-[#39DEA2]">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#E6F2ED]">
                Giao dịch Thực tế Solana · Jupiter Aggregator v1 (Raydium · Orca · Meteora · Pump.fun)
              </h2>
              <p className="mt-0.5 text-xs text-[#8FA9A0]">
                Kiến trúc Non-Custodial chuẩn quốc tế: Backend chỉ lấy báo giá tối ưu từ Jupiter và dựng giao dịch chưa ký. Việc ký xác nhận thực hiện hoàn toàn trong Ví Phantom của bạn — tuyệt đối không lộ Private Key hay Seed Phrase.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
            {onOpenTransferTab && (
              <button
                type="button"
                onClick={onOpenTransferTab}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#43D7B1]/60 bg-[#43D7B1]/15 px-3 py-1.5 font-semibold text-[#43D7B1] hover:bg-[#43D7B1]/25 cursor-pointer"
              >
                <Wallet className="h-3.5 w-3.5" />
                Nạp / Rút Ví Phantom
              </button>
            )}
            {snapshot.wallet.connected && snapshot.wallet.connectionMethod === 'PHANTOM_EXTENSION' ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#39DEA2]/60 bg-[#39DEA2]/15 px-3 py-1.5 font-semibold text-[#39DEA2]">
                <ShieldCheck className="h-3.5 w-3.5" />
                {snapshot.wallet.shortAddress} ·{' '}
                {snapshot.wallet.solBalance !== null ? `${snapshot.wallet.solBalance.toFixed(4)} SOL` : 'RPC'}
              </span>
            ) : (
              <button
                type="button"
                disabled={swapBusy}
                onClick={handleConnectPhantomForSigning}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#A986F5] bg-[#A986F5]/20 px-3 py-1.5 font-semibold text-[#E6F2ED] hover:bg-[#A986F5]/30 disabled:opacity-50 cursor-pointer"
              >
                <Laptop className="h-3.5 w-3.5 text-[#A986F5]" />
                Kết nối Phantom (Ký giao dịch)
              </button>
            )}
          </div>
        </section>
      )}

      {!phantomDetected && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#EAC64D]/50 bg-[#EAC64D]/10 p-3 text-xs text-[#EAC64D]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Chưa phát hiện tiện ích Phantom trên trình duyệt này:</strong> Bạn vẫn có thể xem báo giá trực tiếp từ Jupiter Aggregator và chạy mô phỏng RPC trên Solana Mainnet. Để ký và khớp lệnh bằng tiền thật, hãy mở trang này trên trình duyệt máy tính có cài <strong>Phantom Extension</strong> hoặc mở liên kết qua <strong>Trình duyệt trong app Phantom Mobile</strong>.
          </div>
        </div>
      )}

      {swapError && (
        <div className="flex items-start gap-2 rounded-xl border border-[#EF6682] bg-[#EF6682]/10 p-3 text-xs text-[#EF6682]">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{swapError}</span>
        </div>
      )}

      {lastTxSignature && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#39DEA2] bg-[#39DEA2]/10 p-3 text-xs text-[#39DEA2]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="font-mono-tabular">
              Giao dịch thật đã được gửi lên Solana Mainnet: <strong>{lastTxSignature}</strong>
            </span>
          </div>
          <a
            href={`https://solscan.io/tx/${encodeURIComponent(lastTxSignature)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded border border-[#39DEA2]/60 bg-[#031713] px-2.5 py-1 font-semibold text-[#39DEA2] hover:bg-[#092D27]"
          >
            <span>Kiểm tra trên Solscan</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Jupiter Swap Execution Console */}
        <div className="lg:col-span-6 rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#145B4B]/60 pb-2.5">
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#E6F2ED]">
              <Sparkles className="h-4 w-4 text-[#43D7B1]" />
              LỆNH HOÁN ĐỔI TRỰC TIẾP (JUPITER V1 ROUTER)
            </div>
            <button
              type="button"
              onClick={() => void fetchQuote()}
              disabled={quoteLoading}
              className="inline-flex items-center gap-1 rounded border border-[#145B4B] bg-[#092D27] px-2 py-1 font-mono-tabular text-[11px] text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${quoteLoading ? 'animate-spin' : ''}`} />
              Cập nhật giá
            </button>
          </div>

          {/* Input Token + Amount */}
          <div className="rounded-lg border border-[#145B4B] bg-[#031713] p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-[#8FA9A0]">
              <span>BẠN TRẢ (SELL)</span>
              <span className="font-mono-tabular">
                Số dư:{' '}
                <strong className="text-[#E6F2ED]">
                  {availableInputBalance !== null ? availableInputBalance.toFixed(4) : '—'}
                </strong>{' '}
                {inputTokenInfo?.symbol ?? ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={inputMint}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === outputMint) {
                    setOutputMint(inputMint);
                  }
                  setInputMint(next);
                }}
                className="rounded-lg border border-[#145B4B] bg-[#06231F] px-2.5 py-2 font-mono-tabular text-xs font-bold text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              >
                {tokens.map((t) => (
                  <option key={t.mint} value={t.mint}>
                    {t.symbol} — {t.name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                step="any"
                min="0"
                value={amountUi}
                onChange={(e) => setAmountUi(e.target.value)}
                placeholder="0.05"
                className="flex-1 min-w-[120px] rounded-lg border border-[#145B4B] bg-[#06231F] px-3 py-2 text-right font-mono-tabular text-sm font-bold text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              />
            </div>

            {availableInputBalance !== null && availableInputBalance > 0 && (
              <div className="flex items-center justify-end gap-1.5 font-mono-tabular text-[10px]">
                {[0.25, 0.5, 1].map((ratio) => {
                  const usable =
                    inputMint === SOL_MINT
                      ? Math.max(0, availableInputBalance - 0.01)
                      : availableInputBalance;
                  const val = Number((usable * ratio).toFixed(4));
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAmountUi(String(val))}
                      className="rounded border border-[#145B4B] bg-[#06231F] px-2 py-0.5 text-[#8FA9A0] hover:border-[#43D7B1] hover:text-[#43D7B1] cursor-pointer"
                    >
                      {ratio === 1 ? 'TỐI ĐA' : `${ratio * 100}%`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Flip Button */}
          <div className="flex justify-center -my-1.5">
            <button
              type="button"
              onClick={handleFlipPair}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#145B4B] bg-[#092D27] text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
              title="Đảo chiều cặp giao dịch"
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Output Token + Estimated Receive */}
          <div className="rounded-lg border border-[#145B4B] bg-[#031713] p-3 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] text-[#8FA9A0]">
              <span>BẠN NHẬN (BUY · ƯỚC TÍNH)</span>
              <span className="font-mono-tabular text-[#43D7B1]">
                {quote ? `≈ ${quote.outAmountUi} ${outputTokenInfo?.symbol ?? ''}` : '—'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={outputMint}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === inputMint) {
                    setInputMint(outputMint);
                  }
                  setOutputMint(next);
                }}
                className="flex-1 min-w-[180px] rounded-lg border border-[#145B4B] bg-[#06231F] px-2.5 py-2 font-mono-tabular text-xs font-bold text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              >
                {tokens.map((t) => (
                  <option key={t.mint} value={t.mint}>
                    {t.symbol} — {t.name} {t.verified ? '✓' : `(${t.source})`}
                  </option>
                ))}
                {customMintAudit && !tokens.some((t) => t.mint === customMintAudit.mint) && (
                  <option value={customMintAudit.mint}>
                    {customMintAudit.mint.slice(0, 6)}... (Mint Tùy chỉnh)
                  </option>
                )}
              </select>

              <div className="rounded-lg border border-[#145B4B]/70 bg-[#06231F] px-3 py-2 font-mono-tabular text-sm font-bold text-[#39DEA2] min-w-[130px] text-right">
                {quoteLoading ? '...' : quote ? quote.outAmountUi : '0.00'}
              </div>
            </div>

            {/* Custom Solana Mint Input + Authority Audit */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={customMintInput}
                onChange={(e) => setCustomMintInput(e.target.value)}
                placeholder="Hoặc dán địa chỉ Mint Solana bất kỳ (Base58)..."
                className="flex-1 rounded border border-[#145B4B] bg-[#06231F] px-2.5 py-1.5 font-mono-tabular text-[11px] text-[#E6F2ED] placeholder-[#8FA9A0]/50 focus:border-[#43D7B1] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleLookupCustomMint}
                className="rounded border border-[#43D7B1]/50 bg-[#092D27] px-2.5 py-1.5 text-[11px] font-semibold text-[#43D7B1] hover:bg-[#145B4B]/60 cursor-pointer"
              >
                Kiểm tra Mint
              </button>
            </div>

            {customMintAudit && customMintAudit.mint === outputMint && (
              <div className="flex flex-wrap items-center gap-3 rounded border border-[#145B4B]/70 bg-[#06231F] px-2.5 py-1.5 font-mono-tabular text-[10px]">
                <span className="text-[#8FA9A0]">Decimals: {customMintAudit.decimals}</span>
                <span
                  className={
                    customMintAudit.mintAuthorityRevoked === true
                      ? 'text-[#39DEA2]'
                      : customMintAudit.mintAuthorityRevoked === null
                      ? 'text-[#F5B74F]'
                      : 'text-[#EF6682]'
                  }
                >
                  Mint Auth:{' '}
                  {customMintAudit.mintAuthorityRevoked === true
                    ? 'Đã hủy (An toàn)'
                    : customMintAudit.mintAuthorityRevoked === null
                    ? 'Chưa xác minh (Cảnh báo)'
                    : 'Còn mở (Cảnh báo)'}
                </span>
                <span
                  className={
                    customMintAudit.freezeAuthorityRevoked === true
                      ? 'text-[#39DEA2]'
                      : customMintAudit.freezeAuthorityRevoked === null
                      ? 'text-[#F5B74F]'
                      : 'text-[#EF6682]'
                  }
                >
                  Freeze Auth:{' '}
                  {customMintAudit.freezeAuthorityRevoked === true
                    ? 'Đã hủy (An toàn)'
                    : customMintAudit.freezeAuthorityRevoked === null
                    ? 'Chưa xác minh (Cảnh báo)'
                    : 'Còn mở (Cảnh báo)'}
                </span>
              </div>
            )}
          </div>

          {/* DEX Router + Slippage + Priority Fee */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 font-mono-tabular text-xs">
            <div className="rounded-lg border border-[#145B4B] bg-[#031713] p-2.5">
              <label className="block text-[10px] text-[#8FA9A0] mb-1">SÀN DEX ĐỊNH TUYẾN</label>
              <select
                value={dexFilter}
                onChange={(e) => setDexFilter(e.target.value as DexRouterOption)}
                className="w-full bg-transparent text-xs font-semibold text-[#43D7B1] focus:outline-none"
              >
                <option value="AUTO" className="bg-[#031713]">
                  Jupiter (Tự động tốt nhất)
                </option>
                <option value="RAYDIUM" className="bg-[#031713]">
                  Chỉ Raydium (AMM/CLMM)
                </option>
                <option value="ORCA" className="bg-[#031713]">
                  Chỉ Orca Whirlpool
                </option>
                <option value="METEORA" className="bg-[#031713]">
                  Chỉ Meteora DLMM
                </option>
                <option value="PUMP_FUN" className="bg-[#031713]">
                  Chỉ Pump.fun AMM
                </option>
              </select>
            </div>

            <div className="rounded-lg border border-[#145B4B] bg-[#031713] p-2.5">
              <label className="block text-[10px] text-[#8FA9A0] mb-1">TRƯỢT GIÁ (SLIPPAGE %)</label>
              <div className="flex items-center gap-1">
                {['0.5', '1.0', '2.5'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlippagePct(s)}
                    className={`rounded px-1.5 py-0.5 text-[10px] cursor-pointer ${
                      slippagePct === s
                        ? 'bg-[#43D7B1] text-[#031713] font-bold'
                        : 'border border-[#145B4B] text-[#8FA9A0]'
                    }`}
                  >
                    {s}%
                  </button>
                ))}
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="15"
                  value={slippagePct}
                  onChange={(e) => setSlippagePct(e.target.value)}
                  className="w-12 rounded border border-[#145B4B] bg-[#06231F] px-1 py-0.5 text-right text-[11px] text-[#E6F2ED]"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[#145B4B] bg-[#031713] p-2.5">
              <label className="block text-[10px] text-[#8FA9A0] mb-1">PHÍ ƯU TIÊN (GAS)</label>
              <select
                value={priorityFeeLamports}
                onChange={(e) => setPriorityFeeLamports(Number(e.target.value))}
                className="w-full bg-transparent text-xs font-semibold text-[#E6F2ED] focus:outline-none"
              >
                <option value={50000} className="bg-[#031713]">
                  Tiêu chuẩn (0.00005 SOL)
                </option>
                <option value={200000} className="bg-[#031713]">
                  Nhanh (0.0002 SOL)
                </option>
                <option value={1000000} className="bg-[#031713]">
                  Turbo (0.001 SOL)
                </option>
              </select>
            </div>
          </div>

          {/* Quote Summary Box */}
          {quoteError && (
            <div className="rounded-lg border border-[#EF6682]/60 bg-[#EF6682]/10 p-2.5 text-xs text-[#EF6682]">
              {quoteError}
            </div>
          )}

          {quote && (
            <div className="rounded-lg border border-[#145B4B] bg-[#031713] p-3 font-mono-tabular text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#8FA9A0]">Tuyến thanh khoản Jupiter:</span>
                <span className="font-semibold text-[#43D7B1]">{quote.routeLabels.join(' → ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8FA9A0]">Nhận tối thiểu (sau trượt giá):</span>
                <span className="text-[#E6F2ED]">
                  {quote.minOutAmountUi} {outputTokenInfo?.symbol ?? ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8FA9A0]">Tác động giá (Price Impact):</span>
                <span
                  className={
                    quote.priceImpactPct > 3
                      ? 'font-bold text-[#EF6682]'
                      : quote.priceImpactPct > 1
                      ? 'text-[#EAC64D]'
                      : 'text-[#39DEA2]'
                  }
                >
                  {quote.priceImpactPct}%
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              disabled={!quote || simLoading || swapBusy}
              onClick={handleSimulateSwap}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#49A9ED]/70 bg-[#092D27] px-3 py-2.5 text-xs font-semibold text-[#49A9ED] hover:bg-[#145B4B]/60 disabled:opacity-40 cursor-pointer"
            >
              <FlaskConical className="h-4 w-4" />
              {simLoading ? 'Đang mô phỏng RPC...' : 'Mô phỏng trước (RPC Simulate)'}
            </button>

            <button
              type="button"
              disabled={!quote || swapBusy}
              onClick={handleExecuteRealSwap}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#39DEA2] bg-[#39DEA2] px-3 py-2.5 text-xs font-bold text-[#031713] hover:bg-[#5ce8b5] disabled:opacity-40 cursor-pointer"
            >
              <Wallet className="h-4 w-4" />
              {swapBusy ? 'Đang chờ Phantom ký...' : 'Ký & Giao dịch Thật qua Phantom'}
            </button>
          </div>
        </div>

        {/* Right: RPC Simulation Diagnostic + Live On-Chain Trades Table */}
        <div className="lg:col-span-6 space-y-4">
          {/* RPC Pre-flight Simulation Output */}
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold tracking-wider text-[#E6F2ED]">
              <span>KIỂM TRA TIỀN KHỚP LỆNH (SOLANA MAINNET RPC SIMULATION)</span>
              {simResult && (
                <span
                  className={`rounded px-2 py-0.5 font-mono-tabular text-[10px] ${
                    simResult.ok
                      ? 'bg-[#39DEA2]/15 text-[#39DEA2]'
                      : 'bg-[#EF6682]/15 text-[#EF6682]'
                  }`}
                >
                  {simResult.ok ? 'PASS · SẴN SÀNG KÝ' : 'THẤT BẠI'}
                </span>
              )}
            </div>

            {!simResult ? (
              <p className="text-xs text-[#8FA9A0]">
                Nhấn "Mô phỏng trước (RPC Simulate)" để kiểm tra xem giao dịch Jupiter có đủ số dư và thanh khoản trước khi ký thật trên ví Phantom.
              </p>
            ) : (
              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 font-mono-tabular text-[11px] space-y-1.5">
                <div className="flex justify-between text-[#8FA9A0]">
                  <span>Compute Units dự kiến:</span>
                  <span className="text-[#43D7B1]">
                    {simResult.unitsConsumed ? simResult.unitsConsumed.toLocaleString() : '—'} CU
                  </span>
                </div>
                {simResult.err && <div className="text-[#EF6682]">Lỗi RPC: {simResult.err}</div>}
                {simResult.logs.length > 0 && (
                  <div className="max-h-28 overflow-y-auto border-t border-[#145B4B]/50 pt-1.5 text-[10px] text-[#8FA9A0] space-y-0.5">
                    {simResult.logs.map((line, i) => (
                      <div key={i} className="truncate">
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Real On-Chain Trades History */}
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#145B4B]/60 pb-2">
              <div className="text-xs font-bold tracking-wider text-[#E6F2ED]">
                LỊCH SỬ GIAO DỊCH ON-CHAIN THẬT ({snapshot.liveTrades.length})
              </div>
              <span className="font-mono-tabular text-[11px] text-[#39DEA2]">
                Solana Mainnet-Beta
              </span>
            </div>

            {snapshot.liveTrades.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#8FA9A0]">
                Chưa có giao dịch on-chain nào được thực hiện từ phiên này. Toàn bộ lệnh đã xác nhận qua Phantom & Jupiter sẽ được lưu tại đây kèm liên kết Solscan.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-[#145B4B]/70 bg-[#031713]">
                <table className="w-full text-left font-mono-tabular text-xs">
                  <thead className="bg-[#092D27] text-[10px] text-[#8FA9A0]">
                    <tr>
                      <th className="px-2.5 py-2">Cặp hoán đổi</th>
                      <th className="px-2.5 py-2">Tuyến DEX</th>
                      <th className="px-2.5 py-2">Trạng thái</th>
                      <th className="px-2.5 py-2 text-right">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#145B4B]/40">
                    {snapshot.liveTrades.map((lt) => (
                      <tr key={lt.signature} className="hover:bg-[#092D27]/40">
                        <td className="px-2.5 py-2">
                          <div className="font-semibold text-[#E6F2ED]">
                            {lt.inputAmount} {lt.inputSymbol} → {lt.outputAmountEst} {lt.outputSymbol}
                          </div>
                          <div className="text-[10px] text-[#8FA9A0]">
                            Trượt {(lt.slippageBps / 100).toFixed(1)}% · Impact {lt.priceImpactPct}%
                          </div>
                        </td>
                        <td className="px-2.5 py-2 text-[11px] text-[#43D7B1]">{lt.routeLabels}</td>
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-1">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                lt.status === 'CONFIRMED'
                                  ? 'bg-[#39DEA2]/15 text-[#39DEA2]'
                                  : lt.status === 'FAILED'
                                  ? 'bg-[#EF6682]/15 text-[#EF6682]'
                                  : 'bg-[#EAC64D]/15 text-[#EAC64D]'
                              }`}
                            >
                              {lt.status}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRefreshTxStatus(lt.signature)}
                              disabled={refreshingSig === lt.signature}
                              className="text-[#8FA9A0] hover:text-[#43D7B1] cursor-pointer"
                              title="Kiểm tra lại trạng thái trên Solana Mainnet"
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${refreshingSig === lt.signature ? 'animate-spin' : ''}`}
                              />
                            </button>
                          </div>
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          <a
                            href={lt.solscanUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-[#49A9ED] hover:underline"
                          >
                            <span>{lt.signature.slice(0, 6)}...</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
