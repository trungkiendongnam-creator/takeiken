import React, { useState } from 'react';
import { CheckCircle2, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import { GrokLogo } from './GrokLogo';

interface PhantomPairMobilePageProps {
  pairCode: string;
}

export const PhantomPairMobilePage: React.FC<PhantomPairMobilePageProps> = ({ pairCode }) => {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<'IDLE' | 'SENDING' | 'DONE' | 'ERROR'>('IDLE');
  const [msg, setMsg] = useState<string | null>(null);

  const submitPublicAddress = async (pubKey: string, deviceLabel: string) => {
    setStatus('SENDING');
    setMsg(null);
    try {
      const res = await fetch(`/api/wallet/qr-session/${encodeURIComponent(pairCode)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicAddress: pubKey.trim(), deviceLabel }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Xác nhận ghép nối thất bại');
      }
      setStatus('DONE');
      setMsg('Đã đồng bộ địa chỉ công khai về Grok Bot Terminal Desktop (Chỉ đọc).');
    } catch (err) {
      setStatus('ERROR');
      setMsg(err instanceof Error ? err.message : 'Lỗi xác nhận ghép nối trên di động');
    }
  };

  const handlePhantomMobileConnect = async () => {
    const provider = (
      window as unknown as {
        solana?: { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toString: () => string } }> };
      }
    ).solana;

    if (!provider?.isPhantom) {
      setStatus('ERROR');
      setMsg(
        'Mở trang này bên trong trình duyệt của Phantom App trên điện thoại, hoặc dán địa chỉ ví công khai bên dưới.'
      );
      return;
    }

    try {
      const res = await provider.connect();
      await submitPublicAddress(res.publicKey.toString(), 'Trình duyệt Phantom Mobile');
    } catch (err) {
      setStatus('ERROR');
      setMsg(err instanceof Error ? err.message : 'Đã hủy kết nối Phantom Mobile');
    }
  };

  return (
    <div className="min-h-screen bg-[#031713] p-4 flex items-center justify-center text-[#E6F2ED]">
      <div className="w-full max-w-md rounded-2xl border border-[#145B4B] bg-[#06231F] p-6 space-y-5 shadow-[0_0_32px_rgba(67,215,177,0.15)]">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#145B4B] bg-[#031713]">
            <GrokLogo className="h-9 w-9" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold">
              <span className="text-[#FF9B45]">Grok Bot</span> Đồng hành Di động
            </h1>
            <div className="font-mono-tabular text-xs text-[#43D7B1]">
              Mã ghép nối: {pairCode} · Chỉ đọc
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#43D7B1]/40 bg-[#031713] p-3 text-xs text-[#8FA9A0] flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-[#43D7B1] shrink-0 mt-0.5" />
          <span>
            Kết nối này chỉ gửi địa chỉ ví công khai (Public Key) về máy tính. Tuyệt đối không yêu cầu ký thông điệp hay quyền chuyển tài sản.
          </span>
        </div>

        {status === 'DONE' ? (
          <div className="rounded-xl border border-[#39DEA2] bg-[#39DEA2]/10 p-4 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-[#39DEA2] mx-auto" />
            <div className="text-sm font-bold text-[#39DEA2]">Đồng bộ thành công!</div>
            <p className="text-xs text-[#E6F2ED]">{msg}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              disabled={status === 'SENDING'}
              onClick={handlePhantomMobileConnect}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#A986F5] bg-[#A986F5]/20 py-3 text-sm font-semibold text-[#E6F2ED] hover:bg-[#A986F5]/30 cursor-pointer"
            >
              <Smartphone className="h-4 w-4 text-[#A986F5]" />
              Kết nối Phantom Di động (Chỉ đọc)
            </button>

            <div className="border-t border-[#145B4B]/60 pt-4 space-y-2">
              <label className="block text-xs text-[#8FA9A0]">
                Hoặc dán địa chỉ Solana công khai (Public Address):
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Nhập địa chỉ công khai Solana Base58..."
                className="w-full rounded-lg border border-[#145B4B] bg-[#031713] px-3 py-2.5 font-mono-tabular text-xs text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              />
              <button
                type="button"
                disabled={status === 'SENDING' || !address.trim()}
                onClick={() => submitPublicAddress(address, 'Nhập thủ công trên Di động')}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#43D7B1]/60 bg-[#092D27] py-2.5 text-xs font-semibold text-[#43D7B1] disabled:opacity-40 cursor-pointer"
              >
                <Wallet className="h-4 w-4" />
                Xác nhận gửi Public Address về Desktop
              </button>
            </div>

            {msg && status === 'ERROR' && (
              <div className="rounded-lg border border-[#EF6682]/60 bg-[#EF6682]/10 p-3 text-xs text-[#EF6682]">
                {msg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
