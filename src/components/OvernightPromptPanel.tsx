import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowUpRight,
  Award,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Moon,
  Play,
  Power,
  Save,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { TerminalSnapshot } from '../types/terminal';
import { GrokLogo } from './GrokLogo';

interface OvernightPromptPanelProps {
  snapshot: TerminalSnapshot;
  busy: boolean;
  onRunOvernight: (resetStart70: boolean) => Promise<void>;
  onUpdateConfig: (payload: {
    enabled?: boolean;
    startTime?: string;
    endTime?: string;
    startBalanceUsd?: number;
  }) => Promise<void>;
}

const OVERNIGHT_STAGES = [
  '1/5 · Khởi tạo phiên & Kiểm tra giới hạn sụt giảm ngày',
  '2/5 · SCANNER: Quét pump.fun, Raydium, Meteora (<6h)',
  '3/5 · RUG CHECK: Kiểm định Mint/Freeze & Thanh khoản $40k',
  '4/5 · SIZER & EXECUTOR: Tính vốn kép & Khớp mô phỏng',
  '5/5 · LOGGER & EQUITY: Cập nhật SQLite & Tổng kết 07:00',
];

function formatDurationHm(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}g ${String(m).padStart(2, '0')}p ${String(sec).padStart(2, '0')}s`;
}

function parseTimeToSec(hhmm: string, fallbackHours: number): number {
  const parts = hhmm.split(':');
  if (parts.length !== 2) return fallbackHours * 3600;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallbackHours * 3600;
  return h * 3600 + m * 60;
}

export const OvernightPromptPanel: React.FC<OvernightPromptPanelProps> = ({
  snapshot,
  busy,
  onRunOvernight,
  onUpdateConfig,
}) => {
  const { overnightConfig: cfg, overnightRecap: recap } = snapshot;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cycleProgressPct, setCycleProgressPct] = useState<number>(0);
  const [cycleDone, setCycleDone] = useState<boolean>(false);
  const [draftStartTime, setDraftStartTime] = useState<string>(cfg.startTime || '23:00');
  const [draftEndTime, setDraftEndTime] = useState<string>(cfg.endTime || '07:00');
  const [draftStartBalance, setDraftStartBalance] = useState<string>(String(cfg.startBalanceUsd || 70));
  const [scheduleErr, setScheduleErr] = useState<string | null>(null);
  const [savingCfg, setSavingCfg] = useState<boolean>(false);

  useEffect(() => {
    setDraftStartTime(cfg.startTime || '23:00');
    setDraftEndTime(cfg.endTime || '07:00');
    setDraftStartBalance(String(cfg.startBalanceUsd || 70));
  }, [cfg.startTime, cfg.endTime, cfg.startBalanceUsd]);

  // Live 1-second clock for dynamic startTime -> endTime progress calculation
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Live execution progress bar when running an Overnight cycle
  useEffect(() => {
    if (!busy) {
      setCycleProgressPct((prev) => (prev > 0 ? 100 : 0));
      return;
    }
    setCycleDone(false);
    setCycleProgressPct(12);
    const timer = setInterval(() => {
      setCycleProgressPct((prev) => {
        if (prev >= 92) return 92;
        const step = prev < 45 ? 14 : prev < 75 ? 9 : 4;
        return Math.min(92, prev + step);
      });
    }, 350);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!busy && cycleProgressPct === 100) {
      setCycleDone(true);
    }
  }, [busy, cycleProgressPct]);

  const windowStatus = useMemo(() => {
    const d = new Date(nowMs);
    const secOfDay = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    const startSec = parseTimeToSec(cfg.startTime || '23:00', 23);
    const endSec = parseTimeToSec(cfg.endTime || '07:00', 7);

    const wrapsMidnight = startSec > endSec;
    const totalWindowSec = wrapsMidnight ? 24 * 3600 - startSec + endSec : Math.max(60, endSec - startSec);
    const inNightWindow = wrapsMidnight
      ? secOfDay >= startSec || secOfDay < endSec
      : secOfDay >= startSec && secOfDay < endSec;

    if (!cfg.enabled) {
      return {
        inNightWindow: false,
        pct: 0,
        elapsedLabel: '00g 00p 00s',
        remainingLabel: '—',
        statusText: `KỊCH BẢN QUA ĐÊM ĐANG TẮT (KHUNG GIỜ ${cfg.sessionWindow})`,
      };
    }

    if (inNightWindow) {
      const elapsedSec =
        wrapsMidnight && secOfDay < startSec ? 24 * 3600 - startSec + secOfDay : secOfDay - startSec;
      const remainingSec = Math.max(0, totalWindowSec - elapsedSec);
      const pct = Number(Math.min(100, Math.max(0, (elapsedSec / totalWindowSec) * 100)).toFixed(1));
      return {
        inNightWindow: true,
        pct,
        elapsedLabel: formatDurationHm(elapsedSec),
        remainingLabel: formatDurationHm(remainingSec),
        statusText: `ĐANG TRONG KHUNG GIỜ PHIÊN ĐÊM (${cfg.sessionWindow})`,
      };
    }

    const secondsUntilStart =
      secOfDay < startSec ? startSec - secOfDay : 24 * 3600 - secOfDay + startSec;
    return {
      inNightWindow: false,
      pct: 0,
      elapsedLabel: '00g 00p 00s',
      remainingLabel: formatDurationHm(secondsUntilStart),
      statusText: `NGOÀI KHUNG GIỜ · ĐANG CHỜ PHIÊN ${cfg.startTime} (CÓ THỂ CHẠY THỬ NGAY)`,
    };
  }, [nowMs, cfg.enabled, cfg.startTime, cfg.endTime, cfg.sessionWindow]);

  const activeStageIndex = Math.min(
    OVERNIGHT_STAGES.length - 1,
    Math.floor((cycleProgressPct / 100) * OVERNIGHT_STAGES.length)
  );
  const estCycleSecLeft = busy ? Math.max(1, Math.ceil(((100 - cycleProgressPct) / 100) * 4)) : 0;

  // Overall displayed bar: when executing a live cycle show cycle progress; otherwise show overnight session timeline progress (or 100% if cycle just completed)
  const isCycleRunning = busy;
  const barPct = !cfg.enabled
    ? 0
    : isCycleRunning
    ? cycleProgressPct
    : windowStatus.inNightWindow
    ? windowStatus.pct
    : cycleDone
    ? 100
    : 0;

  const handleToggleEnabled = async () => {
    setSavingCfg(true);
    try {
      await onUpdateConfig({ enabled: !cfg.enabled });
    } finally {
      setSavingCfg(false);
    }
  };

  const handleSaveSchedule = async (
    start = draftStartTime,
    end = draftEndTime,
    balanceVal = Number(draftStartBalance)
  ) => {
    setScheduleErr(null);
    if (start === end) {
      setScheduleErr('Giờ bắt đầu và giờ kết thúc không được trùng nhau.');
      return;
    }
    if (!Number.isFinite(balanceVal) || balanceVal < 10 || balanceVal > 100000) {
      setScheduleErr('Vốn đầu phiên phải nằm trong khoảng $10 – $100,000.');
      return;
    }
    setSavingCfg(true);
    try {
      await onUpdateConfig({
        startTime: start,
        endTime: end,
        startBalanceUsd: Number(balanceVal.toFixed(2)),
      });
    } finally {
      setSavingCfg(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Top Banner matching uploaded grok-bot-overnight.prompt header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#145B4B] bg-[#06231F] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#43D7B1]/50 bg-[#031713]">
            <GrokLogo className="h-8 w-8" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-bold text-[#E6F2ED]">
                <span className="text-[#FF9B45]">Grok Bot</span> · Kịch bản Giao dịch Qua đêm
              </h2>
              <span className="rounded border border-[#43D7B1]/40 bg-[#092D27] px-2 py-0.5 font-mono-tabular text-[10px] text-[#43D7B1]">
                {cfg.promptName}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[#8FA9A0]">
              Phiên mới · Tự động quét meme Solana mới ({cfg.dexAllowlist.join(' · ')}) · Khung giờ {cfg.sessionWindow} · Chế độ mô phỏng an toàn (Paper Trading)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
          <button
            type="button"
            disabled={savingCfg}
            onClick={handleToggleEnabled}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-bold transition-colors cursor-pointer disabled:opacity-50 ${
              cfg.enabled
                ? 'border-[#39DEA2] bg-[#39DEA2]/15 text-[#39DEA2] hover:bg-[#39DEA2]/25'
                : 'border-[#EF6682] bg-[#EF6682]/15 text-[#EF6682] hover:bg-[#EF6682]/25'
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {cfg.enabled ? 'ĐANG BẬT (ON)' : 'ĐANG TẮT (OFF)'}
          </button>

          <span className="inline-flex items-center gap-1 rounded border border-[#A986F5]/50 bg-[#A986F5]/10 px-2.5 py-1 text-[#A986F5]">
            <Moon className="h-3.5 w-3.5" />
            {cfg.sessionWindow}
          </span>
        </div>
      </div>

      {/* Overnight Schedule & ON/OFF Control Panel */}
      <div className="space-y-2 rounded-xl border border-[#145B4B] bg-[#06231F] px-4 py-3 font-mono-tabular text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-[#E6F2ED]">CÀI ĐẶT THỜI GIAN & VỐN PHIÊN ĐÊM:</span>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[#8FA9A0]">Bắt đầu:</label>
              <input
                type="time"
                value={draftStartTime}
                onChange={(e) => {
                  setDraftStartTime(e.target.value);
                  setScheduleErr(null);
                }}
                className="rounded border border-[#145B4B] bg-[#031713] px-2 py-1 text-xs font-bold text-[#43D7B1] focus:border-[#43D7B1] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[#8FA9A0]">Kết thúc:</label>
              <input
                type="time"
                value={draftEndTime}
                onChange={(e) => {
                  setDraftEndTime(e.target.value);
                  setScheduleErr(null);
                }}
                className="rounded border border-[#145B4B] bg-[#031713] px-2 py-1 text-xs font-bold text-[#43D7B1] focus:border-[#43D7B1] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[#8FA9A0]">Vốn đầu ($):</label>
              <input
                type="number"
                min="10"
                max="100000"
                step="1"
                value={draftStartBalance}
                onChange={(e) => {
                  setDraftStartBalance(e.target.value);
                  setScheduleErr(null);
                }}
                className="w-20 rounded border border-[#145B4B] bg-[#031713] px-2 py-1 text-right text-xs font-bold text-[#EAC64D] focus:border-[#43D7B1] focus:outline-none"
              />
            </div>
            <button
              type="button"
              disabled={savingCfg}
              onClick={() => handleSaveSchedule()}
              className="inline-flex items-center gap-1 rounded border border-[#43D7B1]/60 bg-[#092D27] px-2.5 py-1 text-[11px] font-semibold text-[#43D7B1] hover:bg-[#145B4B]/60 disabled:opacity-50 cursor-pointer"
            >
              <Save className="h-3 w-3" />
              Lưu cấu hình
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="text-[#8FA9A0]">Mẫu nhanh:</span>
            {[
              ['23:00', '07:00'],
              ['22:00', '06:00'],
              ['00:00', '08:00'],
              ['20:00', '04:00'],
            ].map(([s, e]) => (
              <button
                key={`${s}-${e}`}
                type="button"
                disabled={savingCfg}
                onClick={() => {
                  setDraftStartTime(s);
                  setDraftEndTime(e);
                  void handleSaveSchedule(s, e, Number(draftStartBalance));
                }}
                className={`rounded border px-2 py-0.5 cursor-pointer ${
                  cfg.startTime === s && cfg.endTime === e
                    ? 'border-[#FF9B45] bg-[#FF9B45]/15 text-[#FF9B45] font-bold'
                    : 'border-[#145B4B] bg-[#031713] text-[#8FA9A0] hover:border-[#43D7B1]'
                }`}
              >
                {s} → {e}
              </button>
            ))}
          </div>
        </div>
        {scheduleErr && (
          <div className="rounded border border-[#EF6682]/60 bg-[#EF6682]/10 px-2.5 py-1 text-[11px] text-[#EF6682]">
            {scheduleErr}
          </div>
        )}
      </div>

      {/* Progress Bar: Overnight Session Completion & Estimated Time Remaining */}
      <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tabular text-xs">
          <div className="flex items-center gap-2">
            {isCycleRunning ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#FF9B45]" />
            ) : cycleDone && !windowStatus.inNightWindow && cfg.enabled ? (
              <CheckCircle2 className="h-4 w-4 text-[#39DEA2]" />
            ) : (
              <Clock className="h-4 w-4 text-[#43D7B1]" />
            )}
            <span className="font-bold text-[#E6F2ED]">
              {isCycleRunning
                ? OVERNIGHT_STAGES[activeStageIndex]
                : cycleDone && !windowStatus.inNightWindow && cfg.enabled
                ? 'CHU KỲ QUÉT PHIÊN ĐÊM ĐÃ HOÀN TẤT (100%)'
                : windowStatus.statusText}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="text-[#8FA9A0]">
              {!cfg.enabled ? (
                <strong className="text-[#EF6682]">Kịch bản đang TẮT</strong>
              ) : isCycleRunning ? (
                <>
                  Còn lại dự kiến:{' '}
                  <strong className="text-[#FF9B45]">~{estCycleSecLeft} giây</strong>
                </>
              ) : windowStatus.inNightWindow ? (
                <>
                  Đã chạy <strong className="text-[#E6F2ED]">{windowStatus.elapsedLabel}</strong> · Còn lại đến {cfg.endTime}:{' '}
                  <strong className="text-[#43D7B1]">{windowStatus.remainingLabel}</strong>
                </>
              ) : (
                <>
                  Còn lại đến phiên {cfg.startTime}:{' '}
                  <strong className="text-[#43D7B1]">{windowStatus.remainingLabel}</strong>
                </>
              )}
            </span>
            <span className="rounded border border-[#145B4B] bg-[#031713] px-2 py-0.5 font-bold text-[#39DEA2]">
              {barPct}%
            </span>
          </div>
        </div>

        {/* Visual Progress Track */}
        <div className="relative h-3 w-full overflow-hidden rounded-full border border-[#145B4B]/80 bg-[#031713]">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              !cfg.enabled
                ? 'bg-[#8FA9A0]/40'
                : recap.drawdownPaused
                ? 'bg-[#EF6682]'
                : isCycleRunning
                ? 'bg-gradient-to-r from-[#FF9B45] via-[#EAC64D] to-[#39DEA2]'
                : 'bg-gradient-to-r from-[#43D7B1] to-[#39DEA2]'
            }`}
            style={{ width: `${Math.max(barPct, isCycleRunning ? 6 : 0)}%` }}
          />
        </div>

        {/* Timeline & Stage Sub-indicators */}
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tabular text-[10px] text-[#8FA9A0]">
          <span>Mốc bắt đầu: {cfg.startTime} (${cfg.startBalanceUsd})</span>
          <span>
            {!cfg.enabled
              ? 'Trạng thái: Đang tắt bởi người dùng'
              : snapshot.isRunning && !recap.drawdownPaused
              ? `Pipeline đang hoạt động · ${recap.totalTrades} lệnh đã khớp`
              : recap.drawdownPaused
              ? `Đã tạm dừng do chạm giới hạn sụt giảm -${cfg.dailyDrawdownLimitPct}%`
              : 'Pipeline đang tạm dừng'}
          </span>
          <span>Mốc tổng kết: {cfg.endTime}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* LEFT: Prompt Card modeled directly after image_6544088e.png */}
        <div className="xl:col-span-7 rounded-xl border border-[#145B4B] bg-[#06231F] overflow-hidden flex flex-col justify-between">
          <div>
            {/* Prompt Editor Title Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#145B4B]/60 bg-[#041A16] px-4 py-2.5 font-mono-tabular text-xs">
              <span className="font-semibold text-[#E6F2ED]">{cfg.promptName}</span>
              <span className="text-[11px] text-[#8FA9A0]">6 tác nhân · vốn đầu ${cfg.startBalanceUsd} · {cfg.sessionWindow}</span>
            </div>

            {/* Prompt Body */}
            <div className="p-4 space-y-4 font-mono-tabular text-xs leading-relaxed text-[#E6F2ED]">
              <p className="text-[#43D7B1]">
                Bạn là Grok Bot, hệ thống giao dịch meme-coin qua đêm trên Solana. Chạy từ {cfg.startTime} đến {cfg.endTime} với số dư khởi đầu ${cfg.startBalanceUsd} (mô phỏng Paper). Ghi lại toàn bộ quyết định để tổng kết vào {cfg.endTime}.
              </p>

              {/* UNIVERSE */}
              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 space-y-1.5">
                <div className="text-[11px] font-bold tracking-wider text-[#FF9B45]">
                  PHẠM VI QUÉT (UNIVERSE)
                </div>
                <ul className="space-y-1 text-[11px] text-[#E6F2ED]/90 list-disc pl-4">
                  <li>Chỉ chọn cặp DEX mới ra mắt hoặc chuyển sàn trong <strong>6 giờ</strong> qua (pump.fun, Raydium, Meteora).</li>
                  <li>Thanh khoản tối thiểu <strong>$40k</strong>, khối lượng 5 phút tối thiểu <strong>$25k</strong>, tối thiểu <strong>300 ví nắm giữ</strong>.</li>
                  <li>Bỏ qua mọi token có <strong>frozen mint</strong>, <strong>open mint authority</strong> hoặc <strong>LP chưa khóa</strong>.</li>
                </ul>
              </div>

              {/* 6 AGENTS */}
              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 space-y-1.5">
                <div className="text-[11px] font-bold tracking-wider text-[#43D7B1]">
                  6 TÁC NHÂN CHUYÊN TRÁCH (AGENTS)
                </div>
                <div className="space-y-1.5 text-[11px] text-[#E6F2ED]/90">
                  <div>
                    <span className="font-bold text-[#FF9B45]">1. SCANNER</span> — Quét cặp mới, đột biến khối lượng (&gt;5× TB 1h), tỷ lệ mua/bán &gt;70%, tăng trưởng ví giữ, ví smart-money (3+ / 40 ví theo dõi mua trong 10p) và ví KOL đã mua thật. Chỉ gắn cờ, không tự giao dịch.
                  </div>
                  <div>
                    <span className="font-bold text-[#EF6682]">2. RUG CHECK</span> — Ví dev &lt;5%, top 10 ví &lt;35%, không gom hàng launch, LP đốt hoặc khóa 30d+, không honeypot khi mô phỏng bán. Bắt buộc PASS trước khi vào lệnh.
                  </div>
                  <div>
                    <span className="font-bold text-[#A986F5]">3. SIZER</span> — Tính quy mô theo vốn hiện tại (không cố định): 20–40% mỗi lệnh, tối đa 2 vị thế mở, tự động giảm 50% size sau 2 lệnh thua liên tiếp.
                  </div>
                  <div>
                    <span className="font-bold text-[#39DEA2]">4. EXECUTOR</span> — Trượt giá tối đa 2.5%, chia lệnh vào 2 phần. Bậc chốt lời: 40% @ 2×, 30% @ 4×, giữ 30% trailing stop 25%. Cắt lỗ cứng -12%, time stop 25 phút, thoát ngay nếu dev bán hoặc rút LP.
                  </div>
                  <div>
                    <span className="font-bold text-[#49A9ED]">5. LOGGER</span> — Ghi từng dòng ENTER / EXIT / FILTERED kèm lý do, quy mô, giá khớp và lãi/lỗ.
                  </div>
                  <div>
                    <span className="font-bold text-[#EAC64D]">6. EQUITY</span> — Cập nhật số dư và đường cong tài sản sau mỗi lần đóng lệnh.
                  </div>
                </div>
              </div>

              {/* RULES */}
              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 space-y-1.5">
                <div className="text-[11px] font-bold tracking-wider text-[#EAC64D]">
                  QUY TẮC BẮT BUỘC (RULES)
                </div>
                <ul className="space-y-1 text-[11px] text-[#E6F2ED]/90 list-disc pl-4">
                  <li>Chỉ vào lệnh khi <strong>SCANNER</strong> báo tối thiểu <strong>2 tín hiệu</strong> và <strong>RUG CHECK</strong> PASS.</li>
                  <li><strong>Không đuổi giá (No chasing):</strong> bỏ qua nếu đồng coin đã tăng <strong>+300%</strong> trong 1h qua mà chưa điều chỉnh.</li>
                  <li><strong>Giới hạn sụt giảm ngày -{cfg.dailyDrawdownLimitPct}% từ đỉnh:</strong> tạm dừng toàn phiên và ghi rõ lý do.</li>
                  <li><strong>Lãi kép:</strong> cộng dồn lợi nhuận vào quy mô lệnh tiếp theo.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Prompt Footer Chips + Run Buttons (matching image_6544088e.png footer) */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#145B4B]/60 bg-[#041A16] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-[11px]">
              <span className="rounded border border-[#145B4B] bg-[#06231F] px-2.5 py-1 text-[#E6F2ED]">
                6 tác nhân
              </span>
              <span className="rounded border border-[#EAC64D]/50 bg-[#EAC64D]/10 px-2.5 py-1 text-[#EAC64D]">
                vốn đầu ${cfg.startBalanceUsd}
              </span>
              <span className="rounded border border-[#43D7B1]/50 bg-[#092D27] px-2.5 py-1 text-[#43D7B1]">
                {cfg.sessionWindow}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || !cfg.enabled}
                onClick={() => onRunOvernight(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#43D7B1]/60 bg-[#092D27] px-3 py-1.5 font-mono-tabular text-xs font-semibold text-[#43D7B1] hover:bg-[#145B4B]/60 disabled:opacity-40 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5" />
                Quét 1 chu kỳ đêm
              </button>

              <button
                type="button"
                disabled={busy || !cfg.enabled}
                onClick={() => onRunOvernight(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#FF9B45] bg-[#FF9B45] px-3.5 py-1.5 font-mono-tabular text-xs font-bold text-[#031713] shadow-[0_0_16px_rgba(255,155,69,0.35)] hover:bg-[#ffae66] disabled:opacity-40 cursor-pointer"
              >
                <span>{busy ? 'Đang chạy...' : `Áp dụng $${cfg.startBalanceUsd} & Chạy ngay`}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Live Guardrails + 07:00 Morning Recap */}
        <div className="xl:col-span-5 space-y-4">
          {/* Live Overnight Sizer & Drawdown Guardrails */}
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#145B4B]/60 pb-2">
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#E6F2ED]">
                <Layers className="h-4 w-4 text-[#A986F5]" />
                TRẠNG THÁI SIZER & BẢO VỆ VỐN ĐÊM
              </span>
              <span
                className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-bold ${
                  recap.drawdownPaused
                    ? 'border-[#EF6682] bg-[#EF6682]/15 text-[#EF6682]'
                    : 'border-[#39DEA2]/60 bg-[#39DEA2]/10 text-[#39DEA2]'
                }`}
              >
                {recap.drawdownPaused ? `ĐÃ TẠM DỪNG (-${cfg.dailyDrawdownLimitPct}%)` : 'ĐANG BẢO VỆ'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 font-mono-tabular text-xs">
              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                <div className="text-[10px] text-[#8FA9A0]">Quy mô lệnh kép hiện tại</div>
                <div className="mt-1 text-base font-bold text-[#A986F5]">
                  {recap.effectivePositionPct}% vốn
                </div>
                <div className="mt-0.5 text-[10px] text-[#8FA9A0]">
                  {recap.sizeScaledDownHalf
                    ? `Đã giảm 50% (thua ${recap.consecutiveLosses} lệnh liên tiếp)`
                    : 'Dải chuẩn 20–40% · Lãi kép bật'}
                </div>
              </div>

              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                <div className="text-[10px] text-[#8FA9A0]">Vị thế đang mở</div>
                <div className="mt-1 text-base font-bold text-[#43D7B1]">
                  {recap.openPositionsCount} / {cfg.maxOpenPositions}
                </div>
                <div className="mt-0.5 text-[10px] text-[#8FA9A0]">
                  Trượt tối đa {cfg.maxSlippagePct}% · Chia {cfg.splitEntryParts} phần
                </div>
              </div>

              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                <div className="text-[10px] text-[#8FA9A0]">Sụt giảm từ đỉnh (Đỉnh ${recap.peakEquityUsd.toFixed(2)})</div>
                <div
                  className={`mt-1 text-base font-bold ${
                    recap.drawdownFromPeakPct >= 20 ? 'text-[#EF6682]' : 'text-[#39DEA2]'
                  }`}
                >
                  -{recap.drawdownFromPeakPct}% / -{cfg.dailyDrawdownLimitPct}%
                </div>
                <div className="mt-0.5 text-[10px] text-[#8FA9A0]">
                  Giới hạn dừng ngày: -{cfg.dailyDrawdownLimitPct}%
                </div>
              </div>

              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                <div className="text-[10px] text-[#8FA9A0]">Thoát lệnh & Cắt lỗ</div>
                <div className="mt-1 text-xs font-bold text-[#EAC64D]">
                  Cứng -{cfg.hardStopPct}% · Thời gian {cfg.timeStopMinutes}p
                </div>
                <div className="mt-0.5 text-[10px] text-[#8FA9A0] truncate" title={cfg.tpLadderDesc}>
                  {cfg.tpLadderDesc}
                </div>
              </div>
            </div>

            {recap.drawdownPaused && (
              <div className="flex items-center gap-2 rounded-lg border border-[#EF6682] bg-[#EF6682]/10 p-2.5 text-xs text-[#EF6682]">
                <AlertOctagon className="h-4 w-4 shrink-0" />
                <span>
                  Hệ thống đã kích hoạt ngắt mạch do sụt giảm từ đỉnh đạt ngưỡng -{cfg.dailyDrawdownLimitPct}%. Nhấn &quot;Áp dụng ${cfg.startBalanceUsd} &amp; Chạy ngay&quot; để khởi tạo phiên mới.
                </span>
              </div>
            )}
          </div>

          {/* End-of-Session Morning Recap Panel */}
          <div className="rounded-xl border border-[#EAC64D]/50 bg-[#06231F] p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#145B4B]/60 pb-2">
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#EAC64D]">
                <Clock className="h-4 w-4" />
                BÁO CÁO TỔNG KẾT {cfg.endTime} (OUTPUT)
              </span>
              <span className="font-mono-tabular text-[11px] text-[#8FA9A0]">
                {recap.totalTrades} lệnh ({recap.wins}T / {recap.losses}B)
              </span>
            </div>

            {/* Start vs End Balance */}
            <div className="grid grid-cols-2 gap-2.5 font-mono-tabular">
              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
                <div className="text-[10px] text-[#8FA9A0]">Vốn đầu phiên</div>
                <div className="mt-1 text-lg font-bold text-[#E6F2ED]">
                  ${recap.startBalanceUsd.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
                <div className="text-[10px] text-[#8FA9A0]">Vốn hiện tại / Cuối phiên</div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    recap.netPnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'
                  }`}
                >
                  ${recap.endBalanceUsd.toFixed(2)}{' '}
                  <span className="text-xs">
                    ({recap.netPnlUsd >= 0 ? '+' : ''}
                    {recap.netPnlPct}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Best & Worst Trade */}
            <div className="grid grid-cols-2 gap-2.5 font-mono-tabular text-xs">
              <div className="rounded-lg border border-[#39DEA2]/40 bg-[#39DEA2]/5 p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-[#39DEA2]">
                  <TrendingUp className="h-3 w-3" />
                  Lệnh tốt nhất
                </div>
                {recap.bestTrade ? (
                  <div className="mt-1 font-bold text-[#E6F2ED]">
                    {recap.bestTrade.symbol} · +${recap.bestTrade.pnlUsd.toFixed(2)} ({recap.bestTrade.multiplier}×)
                  </div>
                ) : (
                  <div className="mt-1 text-[#8FA9A0]">Chưa có dữ liệu</div>
                )}
              </div>

              <div className="rounded-lg border border-[#EF6682]/40 bg-[#EF6682]/5 p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-[#EF6682]">
                  <TrendingDown className="h-3 w-3" />
                  Lệnh tệ nhất
                </div>
                {recap.worstTrade ? (
                  <div className="mt-1 font-bold text-[#E6F2ED]">
                    {recap.worstTrade.symbol} · {recap.worstTrade.pnlUsd >= 0 ? '+' : '-'}$
                    {Math.abs(recap.worstTrade.pnlUsd).toFixed(2)} ({recap.worstTrade.multiplier}×)
                  </div>
                ) : (
                  <div className="mt-1 text-[#8FA9A0]">Chưa có dữ liệu</div>
                )}
              </div>
            </div>

            {/* Top 3 Coins that made the most */}
            <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 space-y-2">
              <div className="flex items-center gap-1.5 font-mono-tabular text-[11px] font-bold text-[#EAC64D]">
                <Award className="h-3.5 w-3.5" />
                TOP 3 ĐỒNG COIN SINH LỜI NHIỀU NHẤT
              </div>
              {recap.topThreeCoins.length === 0 ? (
                <div className="text-xs text-[#8FA9A0] font-mono-tabular">
                  Chưa có lệnh đóng nào trong phiên hiện tại.
                </div>
              ) : (
                <div className="space-y-1.5 font-mono-tabular text-xs">
                  {recap.topThreeCoins.map((coin, idx) => (
                    <div
                      key={coin.symbol}
                      className="flex items-center justify-between rounded border border-[#145B4B]/40 bg-[#06231F] px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#EAC64D]">#{idx + 1}</span>
                        <span className="font-bold text-[#E6F2ED]">{coin.symbol}</span>
                        <span className="text-[10px] text-[#8FA9A0]">({coin.tradesCount} lệnh · đỉnh {coin.bestMultiplier}×)</span>
                      </div>
                      <span
                        className={`font-bold ${
                          coin.pnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'
                        }`}
                      >
                        {coin.pnlUsd >= 0 ? '+' : '-'}${Math.abs(coin.pnlUsd).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[#8FA9A0]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#43D7B1] shrink-0" />
              <span>Toàn bộ lệnh trong kịch bản qua đêm chạy mô phỏng Paper Trading trên SQLite, tách biệt hoàn toàn ví Phantom.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
