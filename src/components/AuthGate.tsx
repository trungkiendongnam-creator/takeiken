import React, { useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { setBearerToken } from '../lib/apiClient';
import { GrokLogo } from './GrokLogo';

interface AuthGateProps {
  needsSetup: boolean;
  envConfigured: boolean;
  onAuthenticated: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  needsSetup,
  envConfigured,
  onAuthenticated,
}) => {
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (needsSetup) {
      if (passcode.length < 8) {
        setErrorMsg('Mật khẩu quản trị phải có tối thiểu 8 ký tự.');
        return;
      }
      if (passcode !== confirmPasscode) {
        setErrorMsg('Mật khẩu xác nhận không khớp.');
        return;
      }
    } else if (!passcode) {
      setErrorMsg('Vui lòng nhập mật khẩu truy cập Terminal.');
      return;
    }

    setBusy(true);
    try {
      const endpoint = needsSetup ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token) {
        throw new Error(
          data.error || (needsSetup ? 'Thiết lập mật khẩu thất bại.' : 'Mật khẩu không hợp lệ.')
        );
      }

      setBearerToken(data.token);
      setPasscode('');
      setConfirmPasscode('');
      onAuthenticated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Xác thực thất bại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#031713] text-[#E6F2ED] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#145B4B] bg-[#06231F] p-6 shadow-[0_0_40px_rgba(67,215,177,0.12)] space-y-5">
        <div className="flex items-center gap-3.5 border-b border-[#145B4B]/70 pb-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#145B4B] bg-[#031713]">
            <GrokLogo className="h-9 w-9" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">
              <span className="text-[#FF9B45]">Grok Bot</span>{' '}
              <span className="text-[#E6F2ED]">Terminal</span>
            </h1>
            <p className="font-mono-tabular text-xs text-[#43D7B1]">
              {needsSetup
                ? 'Thiết lập mật khẩu quản trị lần đầu'
                : 'Xác thực phiên điều khiển bảo mật'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-[#43D7B1]/40 bg-[#031713] p-3 text-xs text-[#8FA9A0]">
          <ShieldCheck className="h-4 w-4 text-[#43D7B1] shrink-0 mt-0.5" />
          <span>
            {needsSetup
              ? 'Tạo mật khẩu truy cập (tối thiểu 8 ký tự) để bảo vệ toàn bộ API mô phỏng, chiến lược và kết nối Jupiter DEX.'
              : envConfigured
              ? 'Máy chủ đang bảo vệ bằng mã truy cập cấu hình hệ thống. Vui lòng nhập mật khẩu để mở khóa phiên làm việc.'
              : 'Vui lòng nhập mật khẩu quản trị để nhận phiên Bearer xác thực vào Terminal.'}
          </span>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-[#EF6682] bg-[#EF6682]/10 p-3 text-xs text-[#EF6682]">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block font-mono-tabular text-xs text-[#8FA9A0] mb-1.5">
              {needsSetup ? 'Mật khẩu quản trị mới (>= 8 ký tự)' : 'Mật khẩu truy cập Terminal'}
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8FA9A0]" />
              <input
                type="password"
                autoFocus
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Nhập mật khẩu..."
                className="w-full rounded-lg border border-[#145B4B] bg-[#031713] py-2.5 pl-9 pr-3 font-mono-tabular text-sm text-[#E6F2ED] placeholder-[#8FA9A0]/50 focus:border-[#43D7B1] focus:outline-none"
              />
            </div>
          </div>

          {needsSetup && (
            <div>
              <label className="block font-mono-tabular text-xs text-[#8FA9A0] mb-1.5">
                Xác nhận lại mật khẩu
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8FA9A0]" />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPasscode}
                  onChange={(e) => setConfirmPasscode(e.target.value)}
                  placeholder="Nhập lại mật khẩu..."
                  className="w-full rounded-lg border border-[#145B4B] bg-[#031713] py-2.5 pl-9 pr-3 font-mono-tabular text-sm text-[#E6F2ED] placeholder-[#8FA9A0]/50 focus:border-[#43D7B1] focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-[#39DEA2] bg-[#39DEA2] py-2.5 text-sm font-bold text-[#031713] transition-colors hover:bg-[#5ce8b5] disabled:opacity-50 cursor-pointer"
          >
            {busy
              ? 'Đang xác thực...'
              : needsSetup
              ? 'Khởi tạo mật khẩu & Vào Terminal'
              : 'Mở khóa Terminal'}
          </button>
        </form>
      </div>
    </div>
  );
};
