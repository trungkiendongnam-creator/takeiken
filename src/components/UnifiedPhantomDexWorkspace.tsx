import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Laptop,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wallet,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type { TerminalSnapshot } from '../types/terminal';
import { LiveDexSwapPanel } from './LiveDexSwapPanel';
import { PhantomSolanaPanel } from './PhantomSolanaPanel';
import { PhantomTransferPanel } from './PhantomTransferPanel';

export type PhantomDexSubTab = 'swap' | 'transfer' | 'wallet';

interface PhantomHeaderProvider {
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
}

interface UnifiedPhantomDexWorkspaceProps {
  snapshot: TerminalSnapshot;
  initialOutputMint?: string | null;
  requestedSubTab?: PhantomDexSubTab;
  onRefreshState: (next: TerminalSnapshot) => void;
  onToast: (msg: string) => void;
  embedded?: boolean;
}

export const UnifiedPhantomDexWorkspace: React.FC<UnifiedPhantomDexWorkspaceProps> = ({
  snapshot,
  initialOutputMint,
  requestedSubTab = 'swap',
  onRefreshState,
  onToast,
  embedded = false,
}) => {
  const [subTab, setSubTab] = useState<PhantomDexSubTab>(requestedSubTab);
  const [walletBusy, setWalletBusy] = useState(false);

  useEffect(() => {
    setSubTab(requestedSubTab);
  }, [requestedSubTab]);

  useEffect(() => {
    if (initialOutputMint) {
      setSubTab('swap');
    }
  }, [initialOutputMint]);

  const { wallet } = snapshot;

  const handleQuickConnectPhantom = async () => {
    const w = window as unknown as {
      phantom?: { solana?: PhantomHeaderProvider };
      solana?: PhantomHeaderProvider;
    };
    const provider = w.phantom?.solana?.isPhantom ? w.phantom.solana : w.solana?.isPhantom ? w.solana : null;

    if (!provider) {
      setSubTab('wallet');
      onToast('Chưa phát hiện tiện ích Phantom trên trình duyệt — bạn có thể dùng QR Điện thoại hoặc nhập địa chỉ ví.');
      return;
    }

    setWalletBusy(true);
    try {
      const resp = await provider.connect({ onlyIfTrusted: false });
      const pubKey = resp.publicKey.toString();
      const res = await apiFetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicAddress: pubKey,
          connectionMethod: 'PHANTOM_EXTENSION',
          deviceType: 'Tiện ích Phantom Desktop',
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; snapshot?: TerminalSnapshot };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Không thể kết nối Ví Phantom');
      }
      onRefreshState(data.snapshot);
      onToast(`Đã kết nối Ví Phantom (${data.snapshot.wallet.shortAddress}) · Sẵn sàng giao dịch & nạp/rút.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Đã hủy kết nối Ví Phantom');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleQuickSyncRpc = async () => {
    setWalletBusy(true);
    try {
      const res = await apiFetch('/api/wallet/sync', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string; snapshot?: TerminalSnapshot };
      if (!res.ok || !data.snapshot) throw new Error(data.error || 'Đồng bộ RPC thất bại');
      onRefreshState(data.snapshot);
      onToast('Đã đồng bộ lại số dư SOL & tài khoản token từ Solana Mainnet.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Lỗi đồng bộ Solana RPC');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleQuickDisconnect = async () => {
    setWalletBusy(true);
    try {
      const w = window as unknown as {
        phantom?: { solana?: PhantomHeaderProvider };
        solana?: PhantomHeaderProvider;
      };
      const provider = w.phantom?.solana?.isPhantom ? w.phantom.solana : w.solana?.isPhantom ? w.solana : null;
      if (provider?.disconnect) {
        await provider.disconnect().catch(() => {});
      }
      const res = await apiFetch('/api/wallet/disconnect', { method: 'POST' });
      const data = (await res.json()) as { snapshot?: TerminalSnapshot };
      if (data.snapshot) onRefreshState(data.snapshot);
      onToast('Đã ngắt kết nối Ví Phantom.');
    } finally {
      setWalletBusy(false);
    }
  };

  return (
    <div id="phantom-dex-hub" className={embedded ? 'space-y-4 scroll-mt-4' : 'space-y-4 p-4 scroll-mt-4'}>
      {/* Unified Phantom + Jupiter DEX Header */}
      <section className="rounded-xl border border-[#39DEA2]/50 bg-[#06231F] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#39DEA2]/15 text-[#39DEA2]">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-[#39DEA2]/70 bg-[#39DEA2]/15 px-2 py-0.5 font-mono-tabular text-[10px] font-bold text-[#39DEA2]">
                  KHU VỰC GIAO DỊCH THẬT · TIỀN THẬT
                </span>
                <h2 className="text-sm font-bold text-[#E6F2ED]">
                  Ví Phantom & Sàn Jupiter Aggregator v1 (Raydium · Orca · Meteora · Pump.fun)
                </h2>
              </div>
              <p className="mt-1 text-xs text-[#8FA9A0]">
                Khu vực tách biệt hoàn toàn với mục chạy mô phỏng: Kết nối Phantom (Desktop / QR Điện thoại / Chỉ đọc), Nạp & Rút SOL/SPL Token và Khớp lệnh DEX thật trên Solana Mainnet — ký 100% trong Ví Phantom, không lưu Private Key hay Seed Phrase.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
            {wallet.connected ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#39DEA2]/60 bg-[#39DEA2]/15 px-3 py-1.5 font-semibold text-[#39DEA2]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {wallet.shortAddress} ·{' '}
                  {wallet.solBalance !== null ? `${wallet.solBalance.toFixed(4)} SOL` : `RPC ${wallet.rpcStatus}`}
                  <span className="ml-1 rounded bg-[#031713] px-1.5 py-0.5 text-[10px] text-[#43D7B1]">
                    {wallet.connectionMethod === 'PHANTOM_EXTENSION' ? 'NON-CUSTODIAL' : 'CHỈ ĐỌC ĐỊA CHỈ'}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={walletBusy}
                  onClick={handleQuickSyncRpc}
                  className="inline-flex items-center gap-1 rounded-md border border-[#145B4B] bg-[#092D27] px-2.5 py-1.5 text-xs text-[#43D7B1] hover:border-[#43D7B1] disabled:opacity-50 cursor-pointer"
                  title="Làm mới số dư từ Solana Mainnet"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${walletBusy ? 'animate-spin' : ''}`} />
                  Làm mới
                </button>
                <button
                  type="button"
                  disabled={walletBusy}
                  onClick={handleQuickDisconnect}
                  className="inline-flex items-center gap-1 rounded-md border border-[#EF6682]/50 bg-[#EF6682]/10 px-2.5 py-1.5 text-xs text-[#EF6682] hover:bg-[#EF6682]/20 disabled:opacity-50 cursor-pointer"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Ngắt
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={walletBusy}
                onClick={handleQuickConnectPhantom}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#A986F5] bg-[#A986F5]/20 px-3 py-1.5 font-semibold text-[#E6F2ED] hover:bg-[#A986F5]/30 disabled:opacity-50 cursor-pointer"
              >
                <Laptop className="h-3.5 w-3.5 text-[#A986F5]" />
                Kết nối Phantom (Desktop / QR)
              </button>
            )}
          </div>
        </div>

        {/* Unified Internal Sub-Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#145B4B]/70 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSubTab('swap')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                subTab === 'swap'
                  ? 'border-[#39DEA2] bg-[#39DEA2]/15 text-[#39DEA2]'
                  : 'border-[#145B4B] bg-[#031713] text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              Hoán đổi DEX (Jupiter v1)
            </button>

            <button
              type="button"
              onClick={() => setSubTab('transfer')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                subTab === 'transfer'
                  ? 'border-[#43D7B1] bg-[#43D7B1]/15 text-[#43D7B1]'
                  : 'border-[#145B4B] bg-[#031713] text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Nạp / Rút Ví Phantom ({snapshot.walletTransfers.length})
            </button>

            <button
              type="button"
              onClick={() => setSubTab('wallet')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                subTab === 'wallet'
                  ? 'border-[#A986F5] bg-[#A986F5]/15 text-[#A986F5]'
                  : 'border-[#145B4B] bg-[#031713] text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              Kết nối QR Mobile & Tài sản RPC ({wallet.tokenAccounts.length})
            </button>
          </div>

          <span className="font-mono-tabular text-[11px] text-[#8FA9A0]">
            RPC: <strong className="text-[#43D7B1]">{snapshot.rpcEndpoint}</strong>
          </span>
        </div>
      </section>

      {subTab === 'swap' && (
        <LiveDexSwapPanel
          snapshot={snapshot}
          initialOutputMint={initialOutputMint}
          onRefreshState={onRefreshState}
          onToast={onToast}
          embedded
        />
      )}

      {subTab === 'transfer' && (
        <PhantomTransferPanel
          snapshot={snapshot}
          onRefreshState={onRefreshState}
          onToast={onToast}
        />
      )}

      {subTab === 'wallet' && (
        <PhantomSolanaPanel
          snapshot={snapshot}
          onRefreshState={onRefreshState}
          embedded
        />
      )}
    </div>
  );
};
