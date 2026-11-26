import React, { useMemo, useState } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Copy,
  ExternalLink,
  FlaskConical,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type { TerminalSnapshot } from '../types/terminal';

interface PhantomLegacyProvider {
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  signAndSendTransaction?: (
    transaction: VersionedTransaction,
    options?: { skipPreflight?: boolean; maxRetries?: number }
  ) => Promise<{ signature: string }>;
  signTransaction?: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
}

interface PhantomTransferPanelProps {
  snapshot: TerminalSnapshot;
  onRefreshState: (next: TerminalSnapshot) => void;
  onToast?: (msg: string) => void;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

function getPhantomProvider(): PhantomLegacyProvider | null {
  const w = window as unknown as {
    phantom?: { solana?: PhantomLegacyProvider };
    solana?: PhantomLegacyProvider;
  };
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w.solana?.isPhantom) return w.solana;
  return null;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
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

export const PhantomTransferPanel: React.FC<PhantomTransferPanelProps> = ({
  snapshot,
  onRefreshState,
  onToast,
}) => {
  const [mode, setMode] = useState<'WITHDRAW' | 'DEPOSIT'>('WITHDRAW');
  const [assetMint, setAssetMint] = useState<string>(SOL_MINT);
  const [amount, setAmount] = useState<string>('0.05');
  const [targetAddress, setTargetAddress] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [simInfo, setSimInfo] = useState<{ ok: boolean; msg: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successSig, setSuccessSig] = useState<string | null>(null);
  const [refreshingSig, setRefreshingSig] = useState<string | null>(null);

  // Deposit QR state
  const [depositQr, setDepositQr] = useState<{
    destinationAddress: string;
    solanaPayUri: string;
    qrDataUrl: string;
  } | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);

  const assetOptions = useMemo(() => {
    const list = [
      { mint: SOL_MINT, symbol: 'SOL', balance: snapshot.wallet.solBalance },
      {
        mint: USDC_MINT,
        symbol: 'USDC',
        balance:
          snapshot.wallet.tokenAccounts.find((t) => t.mint === USDC_MINT)?.amount ?? null,
      },
      {
        mint: USDT_MINT,
        symbol: 'USDT',
        balance:
          snapshot.wallet.tokenAccounts.find((t) => t.mint === USDT_MINT)?.amount ?? null,
      },
    ];
    for (const ta of snapshot.wallet.tokenAccounts) {
      if (!list.some((x) => x.mint === ta.mint)) {
        list.push({ mint: ta.mint, symbol: ta.symbol, balance: ta.amount });
      }
    }
    return list;
  }, [snapshot.wallet]);

  const selectedAsset = assetOptions.find((a) => a.mint === assetMint) ?? assetOptions[0];

  const handleGenerateDepositQr = async () => {
    const dest = (targetAddress || snapshot.wallet.publicAddress || '').trim();
    if (!dest) {
      setErrorMsg('Vui lòng kết nối ví Phantom hoặc nhập địa chỉ ví nhận để tạo mã QR nạp tiền.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/wallet/deposit-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationAddress: dest,
          amount: Number(amount) > 0 ? Number(amount) : undefined,
          mintAddress: assetMint,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        destinationAddress?: string;
        solanaPayUri?: string;
        qrDataUrl?: string;
      };
      if (!res.ok || !data.ok || !data.qrDataUrl || !data.solanaPayUri || !data.destinationAddress) {
        throw new Error(data.error || 'Tạo mã QR nạp tiền thất bại');
      }
      setDepositQr({
        destinationAddress: data.destinationAddress,
        solanaPayUri: data.solanaPayUri,
        qrDataUrl: data.qrDataUrl,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi tạo mã QR nạp tiền');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 2000);
    } catch {
      // Ignore clipboard permission fallback
    }
  };

  const handleSimulateTransfer = async () => {
    const fromAddr = snapshot.wallet.publicAddress;
    const toAddr = (targetAddress || snapshot.wallet.publicAddress || '').trim();
    const numAmt = Number(amount);
    if (!fromAddr) {
      setErrorMsg('Cần kết nối ví Phantom nguồn trước khi kiểm tra giao dịch rút/nạp.');
      return;
    }
    if (!toAddr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(toAddr)) {
      setErrorMsg('Địa chỉ Ví Phantom nhận không đúng định dạng Solana Base58.');
      return;
    }
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      setErrorMsg('Vui lòng nhập số lượng hợp lệ (> 0).');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setSimInfo(null);
    try {
      const buildRes = await apiFetch('/api/wallet/build-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAddress: fromAddr,
          toAddress: toAddr,
          mintAddress: assetMint,
          amountUi: Number(amount),
        }),
      });
      const built = (await buildRes.json()) as {
        ok?: boolean;
        transactionBase64?: string;
        error?: string;
      };
      if (!buildRes.ok || !built.ok || !built.transactionBase64) {
        throw new Error(built.error || 'Không tạo được giao dịch kiểm tra');
      }

      const simRes = await apiFetch('/api/dex/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapTransaction: built.transactionBase64 }),
      });
      const simData = (await simRes.json()) as {
        ok?: boolean;
        error?: string;
        simulation?: { ok: boolean; err: string | null; unitsConsumed: number | null };
      };
      if (!simRes.ok || !simData.ok || !simData.simulation) {
        throw new Error(simData.error || 'Mô phỏng RPC thất bại');
      }
      setSimInfo({
        ok: simData.simulation.ok,
        msg: simData.simulation.ok
          ? `RPC Simulate ĐẠT (${simData.simulation.unitsConsumed ?? 450} CU) — Giao dịch sẵn sàng ký trên Phantom.`
          : `RPC Simulate lỗi: ${simData.simulation.err ?? 'Không đủ số dư / phí mạng'}`,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi kiểm tra giao dịch');
    } finally {
      setBusy(false);
    }
  };

  const handleExecutePhantomTransfer = async (direction: 'DEPOSIT' | 'WITHDRAW') => {
    setErrorMsg(null);
    setSuccessSig(null);

    const numAmt = Number(amount);
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      setErrorMsg('Vui lòng nhập số lượng nạp/rút hợp lệ (> 0).');
      return;
    }
    if (
      direction === 'WITHDRAW' &&
      selectedAsset.balance !== null &&
      numAmt > selectedAsset.balance
    ) {
      setErrorMsg(
        `Số dư ${selectedAsset.symbol} khả dụng (${selectedAsset.balance.toFixed(4)}) không đủ để rút ${amount}.`
      );
      return;
    }

    const toAddr = (targetAddress || snapshot.wallet.publicAddress || '').trim();
    if (!toAddr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(toAddr)) {
      setErrorMsg('Vui lòng nhập địa chỉ Ví Phantom nhận hợp lệ (Solana Base58).');
      return;
    }

    const provider = getPhantomProvider();
    if (!provider) {
      setErrorMsg(
        'Không phát hiện tiện ích Phantom trên trình duyệt này. Để ký lệnh Nạp/Rút trực tiếp, hãy cài Phantom Extension trên máy tính hoặc mở liên kết trong trình duyệt app Phantom Mobile.'
      );
      return;
    }

    setBusy(true);
    try {
      const conn = await provider.connect({ onlyIfTrusted: false });
      const fromAddr = conn.publicKey.toString();

      const buildRes = await apiFetch('/api/wallet/build-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAddress: fromAddr,
          toAddress: toAddr,
          mintAddress: assetMint,
          amountUi: Number(amount),
        }),
      });
      const built = (await buildRes.json()) as {
        ok?: boolean;
        transactionBase64?: string;
        error?: string;
      };
      if (!buildRes.ok || !built.ok || !built.transactionBase64) {
        throw new Error(built.error || 'Không tạo được lệnh chuyển khoản Solana');
      }

      const tx = VersionedTransaction.deserialize(base64ToUint8Array(built.transactionBase64));
      let signature = '';

      if (typeof provider.signAndSendTransaction === 'function') {
        const res = await provider.signAndSendTransaction(tx, {
          skipPreflight: false,
          maxRetries: 3,
        });
        signature = res.signature;
      } else if (typeof provider.signTransaction === 'function') {
        const signed = await provider.signTransaction(tx);
        const signedBase64 = uint8ArrayToBase64(signed.serialize());
        const bRes = await apiFetch('/api/dex/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signedTransaction: signedBase64 }),
        });
        const bData = (await bRes.json()) as { ok?: boolean; signature?: string; error?: string };
        if (!bRes.ok || !bData.ok || !bData.signature) {
          throw new Error(bData.error || 'Phát giao dịch thất bại');
        }
        signature = bData.signature;
      } else {
        throw new Error('Ví Phantom hiện tại không hỗ trợ ký giao dịch.');
      }

      setSuccessSig(signature);

      const recRes = await apiFetch('/api/wallet/record-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction,
          assetSymbol: selectedAsset.symbol,
          mintAddress: assetMint,
          amount: Number(amount),
          fromAddress: fromAddr,
          toAddress: toAddr,
          signature,
          note: note.trim() || undefined,
        }),
      });
      const recData = (await recRes.json()) as {
        ok?: boolean;
        snapshot?: TerminalSnapshot;
      };
      if (recRes.ok && recData.snapshot) {
        onRefreshState(recData.snapshot);
      }
      onToast?.(
        `Đã ${direction === 'DEPOSIT' ? 'nạp' : 'rút'} ${amount} ${selectedAsset.symbol} thành công! Tx: ${signature.slice(0, 8)}...`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Lệnh nạp/rút đã bị hủy hoặc gặp lỗi trên Phantom.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshTransfer = async (sig: string) => {
    setRefreshingSig(sig);
    try {
      const res = await apiFetch(`/api/wallet/refresh-transfer/${encodeURIComponent(sig)}`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
      if (res.ok && data.snapshot) {
        onRefreshState(data.snapshot);
      }
    } finally {
      setRefreshingSig(null);
    }
  };

  return (
    <section className="rounded-xl border border-[#43D7B1]/50 bg-[#06231F] p-4 space-y-4">
      {/* Header + Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#E6F2ED]">
            <Wallet className="h-4 w-4 text-[#39DEA2]" />
            CỔNG NẠP & RÚT TIỀN ON-CHAIN VỀ VÍ PHANTOM (SOLANA MAINNET)
          </h3>
          <p className="mt-0.5 text-[11px] text-[#8FA9A0]">
            Nạp SOL/USDC/Token qua mã QR Solana Pay hoặc chuyển khoản ký trực tiếp bằng Ví Phantom. Rút tài sản về bất kỳ địa chỉ Phantom nào (Non-Custodial).
          </p>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-[#145B4B] bg-[#031713] p-1 font-mono-tabular text-xs">
          <button
            type="button"
            onClick={() => {
              setMode('WITHDRAW');
              setErrorMsg(null);
              setSimInfo(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold cursor-pointer ${
              mode === 'WITHDRAW'
                ? 'bg-[#39DEA2] text-[#031713]'
                : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
            }`}
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            Rút về Ví Phantom
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('DEPOSIT');
              setErrorMsg(null);
              setSimInfo(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold cursor-pointer ${
              mode === 'DEPOSIT'
                ? 'bg-[#43D7B1] text-[#031713]'
                : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
            }`}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Nạp vào Ví
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-[#EF6682] bg-[#EF6682]/10 p-2.5 text-xs text-[#EF6682]">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {simInfo && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
            simInfo.ok
              ? 'border-[#39DEA2] bg-[#39DEA2]/10 text-[#39DEA2]'
              : 'border-[#EF6682] bg-[#EF6682]/10 text-[#EF6682]'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="font-mono-tabular">{simInfo.msg}</span>
        </div>
      )}

      {successSig && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#39DEA2] bg-[#39DEA2]/10 p-2.5 text-xs text-[#39DEA2]">
          <span className="font-mono-tabular">
            Giao dịch thành công! Signature: <strong>{successSig.slice(0, 14)}...</strong>
          </span>
          <a
            href={`https://solscan.io/tx/${encodeURIComponent(successSig)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded border border-[#39DEA2]/60 bg-[#031713] px-2 py-1 font-semibold hover:bg-[#092D27]"
          >
            Xem Solscan <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Form Area */}
        <div className="lg:col-span-6 space-y-3 rounded-lg border border-[#145B4B] bg-[#031713] p-3.5">
          {/* Asset & Amount */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] text-[#8FA9A0] mb-1">Tài sản (SOL / SPL Token)</label>
              <select
                value={assetMint}
                onChange={(e) => setAssetMint(e.target.value)}
                className="w-full rounded-lg border border-[#145B4B] bg-[#06231F] px-2.5 py-2 font-mono-tabular text-xs font-bold text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              >
                {assetOptions.map((a) => (
                  <option key={a.mint} value={a.mint}>
                    {a.symbol}{' '}
                    {a.balance !== null ? `(Số dư: ${a.balance.toFixed(4)})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-[#8FA9A0] mb-1">
                <span>Số lượng</span>
                {selectedAsset.balance !== null && (
                  <span className="font-mono-tabular text-[#43D7B1]">
                    Khả dụng: {selectedAsset.balance.toFixed(4)}
                  </span>
                )}
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-[#145B4B] bg-[#06231F] px-3 py-2 text-right font-mono-tabular text-xs font-bold text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              />
            </div>
          </div>

          {selectedAsset.balance !== null && selectedAsset.balance > 0 && mode === 'WITHDRAW' && (
            <div className="flex items-center justify-end gap-1.5 font-mono-tabular text-[10px]">
              {[0.25, 0.5, 1].map((ratio) => {
                const usable =
                  assetMint === SOL_MINT
                    ? Math.max(0, selectedAsset.balance! - 0.005)
                    : selectedAsset.balance!;
                return (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAmount(String(Number((usable * ratio).toFixed(5))))}
                    className="rounded border border-[#145B4B] bg-[#06231F] px-2 py-0.5 text-[#8FA9A0] hover:border-[#43D7B1] hover:text-[#43D7B1] cursor-pointer"
                  >
                    {ratio === 1 ? 'TỐI ĐA' : `${ratio * 100}%`}
                  </button>
                );
              })}
            </div>
          )}

          {/* Destination Phantom Address */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <label className="text-[11px] text-[#8FA9A0]">
                {mode === 'WITHDRAW'
                  ? 'Địa chỉ Ví Phantom nhận tiền rút (Base58)'
                  : 'Địa chỉ Ví nhận nạp tiền (Base58)'}
              </label>
              {snapshot.wallet.publicAddress && (
                <button
                  type="button"
                  onClick={() => setTargetAddress(snapshot.wallet.publicAddress ?? '')}
                  className="text-[10px] text-[#49A9ED] hover:underline cursor-pointer"
                >
                  Dùng ví đang kết nối ({snapshot.wallet.shortAddress})
                </button>
              )}
            </div>
            <input
              type="text"
              value={targetAddress}
              onChange={(e) => setTargetAddress(e.target.value)}
              placeholder={
                snapshot.wallet.publicAddress
                  ? `Mặc định: ${snapshot.wallet.publicAddress}`
                  : 'Dán địa chỉ công khai Ví Phantom nhận...'
              }
              className="w-full rounded-lg border border-[#145B4B] bg-[#06231F] px-3 py-2 font-mono-tabular text-xs text-[#E6F2ED] placeholder-[#8FA9A0]/50 focus:border-[#43D7B1] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#8FA9A0] mb-1">Ghi chú (tùy chọn)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === 'WITHDRAW' ? 'VD: Rút lãi về ví chính Phantom' : 'VD: Nạp thêm SOL giao dịch'}
              className="w-full rounded-lg border border-[#145B4B] bg-[#06231F] px-3 py-1.5 text-xs text-[#E6F2ED] placeholder-[#8FA9A0]/50 focus:border-[#43D7B1] focus:outline-none"
            />
          </div>

          {mode === 'WITHDRAW' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={handleSimulateTransfer}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#49A9ED]/60 bg-[#092D27] px-3 py-2 text-xs font-semibold text-[#49A9ED] hover:bg-[#145B4B]/60 disabled:opacity-50 cursor-pointer"
              >
                <FlaskConical className="h-3.5 w-3.5" />
                Kiểm tra RPC (Simulate)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleExecutePhantomTransfer('WITHDRAW')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#39DEA2] bg-[#39DEA2] px-3 py-2 text-xs font-bold text-[#031713] hover:bg-[#5ce8b5] disabled:opacity-50 cursor-pointer"
              >
                <ArrowUpFromLine className="h-3.5 w-3.5" />
                {busy ? 'Đang xử lý...' : 'Ký & Rút về Ví Phantom'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={handleGenerateDepositQr}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#43D7B1] bg-[#092D27] px-3 py-2 text-xs font-semibold text-[#43D7B1] hover:bg-[#145B4B]/60 disabled:opacity-50 cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5" />
                Tạo QR Nạp (Solana Pay)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleExecutePhantomTransfer('DEPOSIT')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#A986F5] bg-[#A986F5]/20 px-3 py-2 text-xs font-bold text-[#E6F2ED] hover:bg-[#A986F5]/30 disabled:opacity-50 cursor-pointer"
              >
                <ArrowDownToLine className="h-3.5 w-3.5 text-[#A986F5]" />
                {busy ? 'Đang ký...' : 'Nạp ngay từ Phantom'}
              </button>
            </div>
          )}

          {/* Solana Pay QR preview when in Deposit mode */}
          {mode === 'DEPOSIT' && depositQr && (
            <div className="rounded-lg border border-[#43D7B1]/50 bg-[#06231F] p-3 text-center space-y-2">
              <img
                src={depositQr.qrDataUrl}
                alt="Mã QR Solana Pay Nạp tiền Phantom"
                className="mx-auto h-40 w-40 rounded-lg border border-[#145B4B]"
              />
              <div className="flex items-center justify-center gap-2 font-mono-tabular text-[11px] text-[#E6F2ED]">
                <span className="truncate max-w-[230px]">{depositQr.destinationAddress}</span>
                <button
                  type="button"
                  onClick={() => handleCopyAddress(depositQr.destinationAddress)}
                  className="inline-flex items-center gap-1 rounded border border-[#145B4B] bg-[#031713] px-2 py-0.5 text-[10px] text-[#43D7B1] cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  {copiedAddr ? 'Đã chép' : 'Sao chép'}
                </button>
              </div>
              <div className="text-[10px] text-[#8FA9A0]">
                Quét mã bằng Phantom Mobile hoặc chuyển từ sàn (Binance / OKX / Bybit) theo mạng Solana.
              </div>
            </div>
          )}
        </div>

        {/* Transfer History Table */}
        <div className="lg:col-span-6 rounded-lg border border-[#145B4B] bg-[#031713] p-3.5 flex flex-col">
          <div className="flex items-center justify-between border-b border-[#145B4B]/60 pb-2">
            <span className="text-xs font-bold tracking-wider text-[#E6F2ED]">
              LỊCH SỬ NẠP / RÚT PHANTOM ({snapshot.walletTransfers.length})
            </span>
            <span className="font-mono-tabular text-[10px] text-[#43D7B1]">Solana Mainnet</span>
          </div>

          {snapshot.walletTransfers.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10 text-center text-xs text-[#8FA9A0]">
              Chưa có giao dịch Nạp/Rút on-chain nào được thực hiện. Mọi lệnh chuyển tiền ký qua Phantom sẽ lưu kèm mã kiểm tra Solscan tại đây.
            </div>
          ) : (
            <div className="mt-2.5 max-h-72 overflow-y-auto">
              <table className="w-full text-left font-mono-tabular text-xs">
                <thead className="bg-[#06231F] text-[10px] text-[#8FA9A0]">
                  <tr>
                    <th className="px-2 py-1.5">Loại</th>
                    <th className="px-2 py-1.5">Số lượng</th>
                    <th className="px-2 py-1.5">Ví nhận</th>
                    <th className="px-2 py-1.5">Trạng thái</th>
                    <th className="px-2 py-1.5 text-right">Tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#145B4B]/40">
                  {snapshot.walletTransfers.map((wt) => (
                    <tr key={wt.signature} className="hover:bg-[#06231F]/60">
                      <td className="px-2 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            wt.direction === 'DEPOSIT'
                              ? 'bg-[#43D7B1]/15 text-[#43D7B1]'
                              : 'bg-[#A986F5]/15 text-[#A986F5]'
                          }`}
                        >
                          {wt.direction === 'DEPOSIT' ? 'NẠP' : 'RÚT'}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-semibold text-[#E6F2ED]">
                        {wt.amount} {wt.assetSymbol}
                      </td>
                      <td className="px-2 py-2 text-[11px] text-[#8FA9A0]">
                        {wt.toAddress.slice(0, 4)}...{wt.toAddress.slice(-4)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              wt.status === 'CONFIRMED'
                                ? 'bg-[#39DEA2]/15 text-[#39DEA2]'
                                : wt.status === 'FAILED'
                                ? 'bg-[#EF6682]/15 text-[#EF6682]'
                                : 'bg-[#EAC64D]/15 text-[#EAC64D]'
                            }`}
                          >
                            {wt.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRefreshTransfer(wt.signature)}
                            disabled={refreshingSig === wt.signature}
                            className="text-[#8FA9A0] hover:text-[#43D7B1] cursor-pointer"
                            title="Kiểm tra lại trạng thái RPC"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${refreshingSig === wt.signature ? 'animate-spin' : ''}`}
                            />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <a
                          href={wt.solscanUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[#49A9ED] hover:underline"
                        >
                          {wt.signature.slice(0, 5)}...
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
    </section>
  );
};
