import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Laptop,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
  Wallet,
  Zap,
} from 'lucide-react';
import type { TerminalSnapshot } from '../types/terminal';
import { PhantomTransferPanel } from './PhantomTransferPanel';

interface PhantomProvider {
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
}

interface PhantomSolanaPanelProps {
  snapshot: TerminalSnapshot;
  onRefreshState: (next: TerminalSnapshot) => void;
  onOpenLiveTrade?: () => void;
  onToast?: (msg: string) => void;
  embedded?: boolean;
}

export const PhantomSolanaPanel: React.FC<PhantomSolanaPanelProps> = ({
  snapshot,
  onRefreshState,
  onOpenLiveTrade,
  onToast,
  embedded = false,
}) => {
  const [manualAddress, setManualAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [qrSession, setQrSession] = useState<{
    code: string;
    pairUrl: string;
    qrDataUrl: string;
    expiresAt: number;
    status: string;
  } | null>(null);

  const { wallet } = snapshot;

  // Poll active QR pairing session every 2.5s until confirmed or expired
  useEffect(() => {
    if (!qrSession || qrSession.status !== 'PENDING') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/wallet/qr-session/${qrSession.code}`);
        if (!res.ok) return;
        const data = (await res.json()) as { status: string; publicAddress?: string | null };
        if (data.status === 'CONFIRMED') {
          setQrSession((prev) => (prev ? { ...prev, status: 'CONFIRMED' } : null));
          setInfoMsg(`Đã ghép nối ví di động ${data.publicAddress ?? ''} ở chế độ CHỈ ĐỌC.`);
          const stRes = await fetch('/api/state');
          if (stRes.ok) onRefreshState((await stRes.json()) as TerminalSnapshot);
        } else if (data.status === 'EXPIRED') {
          setQrSession((prev) => (prev ? { ...prev, status: 'EXPIRED' } : null));
        }
      } catch {
        // Ignore transient poll error
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [qrSession, onRefreshState]);

  const connectPublicAddress = async (
    addr: string,
    method: 'PHANTOM_EXTENSION' | 'PUBLIC_ADDRESS',
    deviceType: string
  ) => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await fetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicAddress: addr.trim(),
          connectionMethod: method,
          deviceType,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; snapshot?: TerminalSnapshot };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Không thể kết nối địa chỉ ví ở chế độ Chỉ đọc');
      }
      onRefreshState(data.snapshot);
      setManualAddress('');
      setInfoMsg('Đã kết nối ở chế độ CHỈ ĐỌC tuyệt đối. Số dư được đồng bộ từ Solana Mainnet.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi kết nối ví');
    } finally {
      setBusy(false);
    }
  };

  const handlePhantomExtension = async () => {
    setErrorMsg(null);
    const provider = (window as unknown as { solana?: PhantomProvider }).solana;
    if (!provider?.isPhantom) {
      setErrorMsg(
        'Không phát hiện tiện ích Phantom trên trình duyệt này. Vui lòng dùng mã QR trên điện thoại hoặc dán địa chỉ Solana công khai bên dưới.'
      );
      return;
    }
    try {
      setBusy(true);
      const resp = await provider.connect({ onlyIfTrusted: false });
      const pubKey = resp.publicKey.toString();
      await connectPublicAddress(pubKey, 'PHANTOM_EXTENSION', 'Tiện ích Phantom Desktop');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Đã hủy kết nối tiện ích Phantom');
      setBusy(false);
    }
  };

  const handleGenerateQr = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await fetch('/api/wallet/qr-session', { method: 'POST' });
      const data = (await res.json()) as {
        ok: boolean;
        code: string;
        pairUrl: string;
        qrDataUrl: string;
        expiresAt: number;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không thể tạo phiên QR');
      setQrSession({
        code: data.code,
        pairUrl: data.pairUrl,
        qrDataUrl: data.qrDataUrl,
        expiresAt: data.expiresAt,
        status: 'PENDING',
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Tạo mã QR thất bại');
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/wallet/sync', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string; snapshot?: TerminalSnapshot };
      if (!res.ok || !data.snapshot) throw new Error(data.error || 'Đồng bộ thất bại');
      onRefreshState(data.snapshot);
      setInfoMsg('Đã làm mới số dư và tài khoản token từ Solana Mainnet.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi đồng bộ RPC');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      const provider = (window as unknown as { solana?: PhantomProvider }).solana;
      if (provider?.disconnect) {
        await provider.disconnect().catch(() => {});
      }
      const res = await fetch('/api/wallet/disconnect', { method: 'POST' });
      const data = (await res.json()) as { snapshot?: TerminalSnapshot };
      if (data.snapshot) onRefreshState(data.snapshot);
      setInfoMsg('Đã ngắt kết nối ví Chỉ đọc.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-4'}>
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#43D7B1]/50 bg-[#06231F] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#43D7B1]/15 text-[#43D7B1]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#E6F2ED]">
                Phantom Wallet & Solana Mainnet — Chế độ READ-ONLY tuyệt đối
              </h2>
              <p className="mt-0.5 text-xs text-[#8FA9A0]">
                Chỉ đọc Public Address, số dư SOL và SPL / Token-2022 accounts. Không ký thông điệp, không ký/gửi giao dịch, không lưu Seed Phrase hay Private Key. Số dư Phantom tách biệt hoàn toàn với vốn Paper Trading.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenLiveTrade && (
              <button
                type="button"
                onClick={onOpenLiveTrade}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#39DEA2] bg-[#39DEA2]/15 px-3 py-1.5 text-xs font-bold text-[#39DEA2] hover:bg-[#39DEA2]/25 cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5" />
                Mở sàn Jupiter DEX (Giao dịch thật)
              </button>
            )}
            <span className="rounded border border-[#43D7B1]/50 bg-[#092D27] px-2.5 py-1 font-mono-tabular text-xs font-semibold text-[#43D7B1]">
              {snapshot.rpcEndpoint}
            </span>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-[#EF6682] bg-[#EF6682]/10 p-3 text-xs text-[#EF6682]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {infoMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-[#39DEA2] bg-[#39DEA2]/10 p-3 text-xs text-[#39DEA2]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{infoMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Connection Methods */}
        <div className="lg:col-span-5 space-y-4">
          {/* Desktop Extension & Mobile QR */}
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
            <h3 className="text-xs font-bold tracking-wider text-[#E6F2ED]">
              1. KẾT NỐI PHANTOM (DESKTOP & ĐIỆN THOẠI)
            </h3>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={handlePhantomExtension}
                className="flex items-center justify-center gap-2 rounded-lg border border-[#A986F5]/60 bg-[#A986F5]/15 px-3 py-2.5 text-xs font-semibold text-[#E6F2ED] transition-colors hover:bg-[#A986F5]/25 disabled:opacity-50 cursor-pointer"
              >
                <Laptop className="h-4 w-4 text-[#A986F5]" />
                Tiện ích Phantom
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={handleGenerateQr}
                className="flex items-center justify-center gap-2 rounded-lg border border-[#43D7B1]/60 bg-[#43D7B1]/15 px-3 py-2.5 text-xs font-semibold text-[#E6F2ED] transition-colors hover:bg-[#43D7B1]/25 disabled:opacity-50 cursor-pointer"
              >
                <Smartphone className="h-4 w-4 text-[#43D7B1]" />
                QR Phantom Di động
              </button>
            </div>

            {qrSession && (
              <div className="rounded-lg border border-[#145B4B] bg-[#031713] p-3 text-center space-y-2">
                <div className="flex items-center justify-between text-xs font-mono-tabular">
                  <span className="text-[#43D7B1] flex items-center gap-1.5">
                    <QrCode className="h-3.5 w-3.5" />
                    Mã ghép: {qrSession.code}
                  </span>
                  <span className="text-[#EAC64D]">
                    {qrSession.status === 'PENDING'
                      ? 'ĐANG CHỜ QUÉT'
                      : qrSession.status === 'CONFIRMED'
                      ? 'ĐÃ XÁC NHẬN'
                      : 'HẾT HẠN'}
                  </span>
                </div>
                <img
                  src={qrSession.qrDataUrl}
                  alt="Mã QR ghép nối Phantom Mobile Chỉ đọc"
                  className="mx-auto h-44 w-44 rounded-lg border border-[#145B4B]"
                />
                <p className="text-[11px] text-[#8FA9A0]">
                  Mở bằng Phantom Mobile hoặc trình duyệt điện thoại. Mã QR hết hạn sau 5 phút và chỉ dùng 1 lần.
                </p>
                <a
                  href={qrSession.pairUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-mono-tabular text-[11px] text-[#49A9ED] underline break-all"
                >
                  {qrSession.pairUrl}
                </a>
              </div>
            )}
          </div>

          {/* Public Address Manual Read-Only Fallback */}
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
            <h3 className="text-xs font-bold tracking-wider text-[#E6F2ED]">
              2. NHẬP ĐỊA CHỈ VÍ CÔNG KHAI (SOLANA BASE58)
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (manualAddress.trim()) {
                  connectPublicAddress(manualAddress, 'PUBLIC_ADDRESS', 'Theo dõi địa chỉ công khai');
                }
              }}
              className="space-y-2.5"
            >
              <input
                type="text"
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                placeholder="VD: vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg"
                className="w-full rounded-lg border border-[#145B4B] bg-[#031713] px-3 py-2 font-mono-tabular text-xs text-[#E6F2ED] placeholder-[#8FA9A0]/50 focus:border-[#43D7B1] focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setManualAddress('vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg')
                  }
                  className="text-[11px] text-[#49A9ED] hover:underline cursor-pointer"
                >
                  Dùng địa chỉ công khai Solana mẫu
                </button>
                <button
                  type="submit"
                  disabled={busy || !manualAddress.trim()}
                  className="rounded-lg border border-[#43D7B1]/60 bg-[#092D27] px-3.5 py-1.5 text-xs font-semibold text-[#43D7B1] hover:bg-[#145B4B]/60 disabled:opacity-40 cursor-pointer"
                >
                  Đọc dữ liệu Mainnet
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Connected Wallet & Solana On-Chain Assets */}
        <div className="lg:col-span-7 rounded-xl border border-[#145B4B] bg-[#06231F] p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#145B4B]/60 pb-3">
              <div className="flex items-center gap-2.5">
                <Wallet className="h-4 w-4 text-[#A986F5]" />
                <span className="text-xs font-bold tracking-wider text-[#E6F2ED]">
                  TRẠNG THÁI TRÊN CHUỖI SOLANA MAINNET
                </span>
              </div>

              {wallet.connected && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSync}
                    className="inline-flex items-center gap-1 rounded border border-[#145B4B] bg-[#092D27] px-2.5 py-1 text-xs text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
                  >
                    <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
                    Làm mới RPC
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDisconnect}
                    className="inline-flex items-center gap-1 rounded border border-[#EF6682]/50 bg-[#EF6682]/10 px-2.5 py-1 text-xs text-[#EF6682] hover:bg-[#EF6682]/20 cursor-pointer"
                  >
                    <Unplug className="h-3 w-3" />
                    Ngắt kết nối
                  </button>
                </div>
              )}
            </div>

            {!wallet.connected ? (
              <div className="py-12 text-center space-y-2">
                <div className="text-sm font-semibold text-[#E6F2ED]">
                  Chưa kết nối ví Phantom (Chỉ đọc)
                </div>
                <p className="mx-auto max-w-md text-xs text-[#8FA9A0]">
                  Chọn Tiện ích Phantom, tạo mã QR cho Phantom Di động, hoặc nhập địa chỉ Solana công khai để đọc số dư SOL và danh sách SPL / Token-2022 từ Solana Mainnet.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
                    <div className="text-[11px] text-[#8FA9A0]">Địa chỉ công khai (Public Key)</div>
                    <div className="mt-1 font-mono-tabular text-xs font-semibold text-[#E6F2ED] break-all">
                      {wallet.publicAddress}
                    </div>
                    <div className="mt-1 text-[10px] text-[#43D7B1]">
                      {wallet.connectionMethod} · {wallet.deviceType}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
                    <div className="text-[11px] text-[#8FA9A0]">Số dư SOL thật (Chỉ đọc)</div>
                    <div className="mt-1 font-mono-tabular text-xl font-bold text-[#39DEA2]">
                      {wallet.rpcStatus === 'OK' && wallet.solBalance !== null
                        ? `${wallet.solBalance.toFixed(6)} SOL`
                        : 'Lỗi RPC'}
                    </div>
                    <div className="mt-1 font-mono-tabular text-[10px] text-[#8FA9A0]">
                      {wallet.rpcError
                        ? wallet.rpcError
                        : wallet.solBalance !== null && snapshot.solPriceUsd > 0
                        ? `≈ $${(wallet.solBalance * snapshot.solPriceUsd).toFixed(2)} USD (Tách biệt vốn ảo)`
                        : wallet.network}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
                    <div className="text-[11px] text-[#8FA9A0]">Trạng thái RPC & Tài khoản Token</div>
                    <div className="mt-1 font-mono-tabular text-base font-bold text-[#E6F2ED]">
                      {wallet.rpcStatus === 'OK' ? 'ỔN ĐỊNH' : wallet.rpcStatus} · {wallet.tokenAccounts.length} token
                    </div>
                    <div className="mt-1 font-mono-tabular text-[10px] text-[#8FA9A0]">
                      Đồng bộ lúc: {wallet.lastSyncedAt ? new Date(wallet.lastSyncedAt).toLocaleTimeString('vi-VN') : '—'}
                    </div>
                  </div>
                </div>

                {/* SPL & Token-2022 Table */}
                <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] overflow-hidden">
                  <div className="border-b border-[#145B4B]/60 px-3 py-2 text-xs font-semibold text-[#8FA9A0]">
                    Danh sách tài khoản SPL Token & Token-2022
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {wallet.tokenAccounts.length === 0 ? (
                      <div className="p-4 text-center font-mono-tabular text-xs text-[#8FA9A0]">
                        {wallet.rpcStatus === 'OK'
                          ? 'Không tìm thấy tài khoản SPL hoặc Token-2022 nào trên địa chỉ công khai này.'
                          : 'Không thể tải danh sách tài khoản token do lỗi trạng thái RPC.'}
                      </div>
                    ) : (
                      <table className="w-full text-left font-mono-tabular text-xs">
                        <thead className="bg-[#06231F] text-[11px] text-[#8FA9A0]">
                          <tr>
                            <th className="px-3 py-2">Địa chỉ Mint</th>
                            <th className="px-3 py-2">Chuẩn</th>
                            <th className="px-3 py-2 text-right">Số lượng</th>
                            <th className="px-3 py-2 text-right">Số lẻ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#145B4B]/40">
                          {wallet.tokenAccounts.map((ta) => (
                            <tr key={ta.tokenAccount} className="hover:bg-[#092D27]/40">
                              <td className="px-3 py-2 text-[#E6F2ED]">{ta.mint}</td>
                              <td className="px-3 py-2 text-[#49A9ED]">{ta.program}</td>
                              <td className="px-3 py-2 text-right text-[#39DEA2]">{ta.amount}</td>
                              <td className="px-3 py-2 text-right text-[#8FA9A0]">{ta.decimals}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {!embedded && (
        <PhantomTransferPanel snapshot={snapshot} onRefreshState={onRefreshState} onToast={onToast} />
      )}
    </div>
  );
};
