import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  Power,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { DailyDrawdownGuardState } from '../types/terminal';

interface DailyDrawdownGuardCardProps {
  guard: DailyDrawdownGuardState;
  busy: boolean;
  onUpdateConfig: (payload: {
    enabled?: boolean;
    maxDailyDrawdownPct?: number;
    minEquityThresholdUsd?: number | null;
    clearHalt?: boolean;
  }) => Promise<void>;
  onResetPaper: () => void;
}

export const DailyDrawdownGuardCard: React.FC<DailyDrawdownGuardCardProps> = ({
  guard,
  busy,
  onUpdateConfig,
  onResetPaper,
}) => {
  const [draftPct, setDraftPct] = useState<string>(String(guard.maxDailyDrawdownPct));
  const [draftMinUsd, setDraftMinUsd] = useState<string>(
    guard.minEquityThresholdUsd !== null ? String(guard.minEquityThresholdUsd) : ''
  );
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    setDraftPct(String(guard.maxDailyDrawdownPct));
    setDraftMinUsd(
      guard.minEquityThresholdUsd !== null ? String(guard.minEquityThresholdUsd) : ''
    );
  }, [guard.maxDailyDrawdownPct, guard.minEquityThresholdUsd]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);

    const parsedPct = Number(draftPct);
    if (!Number.isFinite(parsedPct) || parsedPct < 1 || parsedPct > 95) {
      setFormErr('Giới hạn sụt giảm tối đa phải nằm trong khoảng 1% đến 95%.');
      return;
    }

    let parsedFloor: number | null = null;
    if (draftMinUsd.trim() !== '') {
      const val = Number(draftMinUsd);
      if (!Number.isFinite(val) || val < 0 || val > 1_000_000) {
        setFormErr('Ngưỡng sàn Equity tối thiểu phải từ $0 đến $1,000,000.');
        return;
      }
      parsedFloor = Number(val.toFixed(2));
    }

    await onUpdateConfig({
      maxDailyDrawdownPct: Number(parsedPct.toFixed(1)),
      minEquityThresholdUsd: parsedFloor,
    });
  };

  const drawdownRatio =
    guard.maxDailyDrawdownPct > 0
      ? Math.min(100, Math.max(0, (guard.currentDailyDrawdownPct / guard.maxDailyDrawdownPct) * 100))
      : 0;

  return (
    <section
      className={`rounded-xl border p-3.5 space-y-3 ${
        guard.isHalted
          ? 'border-[#EF6682] bg-[#1F0A10]/90 shadow-[0_0_24px_rgba(239,102,130,0.22)]'
          : 'border-[#145B4B] bg-[#06231F]'
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#145B4B]/60 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {guard.isHalted ? (
            <ShieldAlert className="h-4 w-4 text-[#EF6682]" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-[#39DEA2]" />
          )}
          <span className="text-xs font-bold tracking-wider text-[#E6F2ED]">
            GIỚI HẠN SỤT GIẢM NGÀY TỐI ĐA (MAXIMUM DAILY DRAWDOWN)
          </span>
          <span
            className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-bold ${
              !guard.enabled
                ? 'border-[#8FA9A0]/50 bg-[#031713] text-[#8FA9A0]'
                : guard.isHalted
                ? 'border-[#EF6682] bg-[#EF6682]/20 text-[#EF6682]'
                : 'border-[#39DEA2]/60 bg-[#39DEA2]/10 text-[#39DEA2]'
            }`}
          >
            {!guard.enabled
              ? 'ĐÃ TẮT'
              : guard.isHalted
              ? 'ĐÃ NGẮT MẠCH (HALTED)'
              : 'ĐANG BẢO VỆ'}
          </span>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdateConfig({ enabled: !guard.enabled })}
          className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-mono-tabular text-[11px] font-bold cursor-pointer disabled:opacity-40 ${
            guard.enabled
              ? 'border-[#39DEA2]/60 bg-[#39DEA2]/15 text-[#39DEA2] hover:bg-[#39DEA2]/25'
              : 'border-[#EAC64D]/60 bg-[#EAC64D]/15 text-[#EAC64D] hover:bg-[#EAC64D]/25'
          }`}
          title="Bật hoặc tắt cơ chế tự động ngắt mạch theo giới hạn sụt giảm ngày"
        >
          <Power className="h-3 w-3" />
          {guard.enabled ? 'ĐANG BẬT BẢO VỆ' : 'BẬT LẠI BẢO VỆ'}
        </button>
      </div>

      {/* Halted Emergency Banner */}
      {guard.isHalted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EF6682] bg-[#EF6682]/10 p-3 font-mono-tabular text-xs text-[#EF6682]">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertOctagon className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold">
                TOÀN BỘ HOẠT ĐỘNG GIAO DỊCH CỦA AGENT ĐÃ TỰ ĐỘNG TẠM DỪNG
              </div>
              <div className="text-[11px] text-[#E6F2ED]/90">
                {guard.haltReason ??
                  `Tổng tài sản ($${guard.totalPortfolioEquityUsd.toFixed(2)}) đã chạm ngưỡng ngắt mạch ($${guard.effectiveHaltThresholdUsd.toFixed(2)}).`}
              </div>
              {guard.haltedAt && (
                <div className="text-[10px] text-[#8FA9A0]">
                  Thời điểm ngắt mạch: {new Date(guard.haltedAt).toLocaleString('vi-VN')}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={onResetPaper}
              className="inline-flex items-center gap-1 rounded border border-[#43D7B1] bg-[#092D27] px-2.5 py-1.5 text-[11px] font-bold text-[#43D7B1] hover:bg-[#145B4B]/60 disabled:opacity-40 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Đặt lại vốn $50
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdateConfig({ clearHalt: true })}
              className="inline-flex items-center gap-1 rounded border border-[#EAC64D] bg-[#EAC64D]/15 px-2.5 py-1.5 text-[11px] font-bold text-[#EAC64D] hover:bg-[#EAC64D]/25 disabled:opacity-40 cursor-pointer"
              title="Chỉ gỡ ngắt mạch nếu tài sản hiện tại đã vượt trên ngưỡng ngắt"
            >
              Gỡ ngắt mạch
            </button>
          </div>
        </div>
      )}

      {/* 4 Live Portfolio Equity & Drawdown Metrics */}
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 font-mono-tabular">
        <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
          <div className="text-[10px] text-[#8FA9A0]">TỔNG TÀI SẢN MÔ PHỎNG</div>
          <div className="mt-1 text-lg font-bold text-[#E6F2ED]">
            ${guard.totalPortfolioEquityUsd.toFixed(2)}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8FA9A0]">
            Đã chốt ${guard.realizedBalanceUsd.toFixed(2)} · Mở{' '}
            <span className={guard.unrealizedPnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'}>
              {guard.unrealizedPnlUsd >= 0 ? '+' : '-'}${Math.abs(guard.unrealizedPnlUsd).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
          <div className="text-[10px] text-[#8FA9A0]">ĐỈNH TÀI SẢN TRONG NGÀY</div>
          <div className="mt-1 text-lg font-bold text-[#43D7B1]">
            ${guard.dailyPeakEquityUsd.toFixed(2)}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8FA9A0]">
            Đầu ngày: ${guard.dailyStartEquityUsd.toFixed(2)}
          </div>
        </div>

        <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
          <div className="text-[10px] text-[#8FA9A0]">SỤT GIẢM NGÀY HIỆN TẠI</div>
          <div
            className={`mt-1 text-lg font-bold ${
              guard.isHalted || drawdownRatio >= 85
                ? 'text-[#EF6682]'
                : drawdownRatio >= 55
                ? 'text-[#EAC64D]'
                : 'text-[#39DEA2]'
            }`}
          >
            -{guard.currentDailyDrawdownPct.toFixed(1)}%
          </div>
          <div className="mt-0.5 text-[10px] text-[#8FA9A0]">
            Giới hạn tối đa: -{guard.maxDailyDrawdownPct}%
          </div>
        </div>

        <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
          <div className="text-[10px] text-[#8FA9A0]">NGƯỠNG TỰ ĐỘNG NGẮT (FLOOR)</div>
          <div className="mt-1 text-lg font-bold text-[#FF9B45]">
            ${guard.effectiveHaltThresholdUsd.toFixed(2)}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8FA9A0]">
            {guard.minEquityThresholdUsd !== null
              ? `Sàn tùy chỉnh $${guard.minEquityThresholdUsd.toFixed(2)} / -${guard.maxDailyDrawdownPct}%`
              : `Tính theo -${guard.maxDailyDrawdownPct}% từ đỉnh ngày`}
          </div>
        </div>
      </div>

      {/* Drawdown Proximity Bar */}
      <div className="space-y-1 font-mono-tabular">
        <div className="flex items-center justify-between text-[10px] text-[#8FA9A0]">
          <span>Mức tiêu hao biên độ rủi ro trong ngày</span>
          <span>
            -{guard.currentDailyDrawdownPct.toFixed(1)}% / -{guard.maxDailyDrawdownPct}% (
            {drawdownRatio.toFixed(0)}%)
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full border border-[#145B4B]/70 bg-[#031713]">
          <div
            className={`h-full transition-all duration-300 ${
              guard.isHalted || drawdownRatio >= 85
                ? 'bg-[#EF6682]'
                : drawdownRatio >= 55
                ? 'bg-[#EAC64D]'
                : 'bg-[#39DEA2]'
            }`}
            style={{ width: `${Math.max(drawdownRatio, 2)}%` }}
          />
        </div>
      </div>

      {/* User-Defined Threshold Configuration Form */}
      <form
        onSubmit={handleSave}
        className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[#145B4B]/60 bg-[#031713] p-2.5 font-mono-tabular text-xs"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="max-dd-pct-input"
              className="block text-[10px] text-[#8FA9A0] mb-1"
            >
              GIỚI HẠN SỤT GIẢM TỐI ĐA (% / NGÀY)
            </label>
            <input
              id="max-dd-pct-input"
              type="number"
              min={1}
              max={95}
              step={0.5}
              value={draftPct}
              onChange={(e) => setDraftPct(e.target.value)}
              className="w-32 rounded border border-[#145B4B] bg-[#06231F] px-2.5 py-1 text-xs font-bold text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="min-eq-floor-input"
              className="block text-[10px] text-[#8FA9A0] mb-1"
            >
              SÀN TÀI SẢN TỐI THIỂU ($ USD · TÙY CHỌN)
            </label>
            <input
              id="min-eq-floor-input"
              type="number"
              min={0}
              max={1000000}
              step={0.5}
              value={draftMinUsd}
              onChange={(e) => setDraftMinUsd(e.target.value)}
              placeholder="Tự tính theo %"
              className="w-40 rounded border border-[#145B4B] bg-[#06231F] px-2.5 py-1 text-xs font-bold text-[#E6F2ED] placeholder-[#8FA9A0]/50 focus:border-[#43D7B1] focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-[#43D7B1] bg-[#092D27] px-3 py-1.5 text-xs font-bold text-[#43D7B1] hover:bg-[#145B4B]/60 disabled:opacity-40 cursor-pointer"
        >
          <Save className="h-3.5 w-3.5" />
          {busy ? 'Đang lưu...' : 'Lưu ngưỡng bảo vệ'}
        </button>
      </form>

      {formErr && (
        <div className="font-mono-tabular text-[11px] text-[#EF6682]">{formErr}</div>
      )}
    </section>
  );
};
