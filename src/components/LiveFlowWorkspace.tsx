import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Crosshair,
  Download,
  Moon,
  PlayCircle,
  Power,
  RotateCcw,
  Search,
  ShieldAlert,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type {
  AgentId,
  PaperTradeRecord,
  TerminalSnapshot,
  TokenFlowItem,
  VolatilityDirection,
  VolatilityWindow,
} from '../types/terminal';
import { AgentLeaderboardTable } from './AgentLeaderboardTable';
import { DailyTradingSummaryCard } from './DailyTradingSummaryCard';
import { GrokLogo } from './GrokLogo';
import { PerformanceHeatmap } from './PerformanceHeatmap';
import { RiskAssessmentRadar } from './RiskAssessmentRadar';
import { TradeActivityLog } from './TradeActivityLog';
import { TradeHistoryChart } from './TradeHistoryChart';
import { VolatilityAlertsPanel } from './VolatilityAlertsPanel';

interface LiveFlowWorkspaceProps {
  snapshot: TerminalSnapshot;
  selectedMint: string;
  onSelectMint: (mint: string) => void;
  onSimulatePaper: (mint: string, action: 'OPEN_SIM' | 'CLOSE_SIM', mult?: number) => void;
  onResetPaper: () => void;
  simBusy: boolean;
  onCreateAlertRule: (payload: {
    agentId: AgentId;
    window: VolatilityWindow;
    direction: VolatilityDirection;
    thresholdPct: number;
  }) => Promise<void>;
  onToggleAlertRule: (id: number, enabled: boolean) => Promise<void>;
  onAcknowledgeAlertRule: (id: number) => Promise<void>;
  onDeleteAlertRule: (id: number) => Promise<void>;
  alertBusy: boolean;
  onOpenOvernightTab: () => void;
  onRunOvernight: (resetStart70: boolean) => Promise<void>;
  overnightBusy: boolean;
  onOpenLiveTradeForMint: (mintAddress: string) => void;
  onToggleOvernightEnabled: (enabled: boolean) => Promise<void>;
}

function formatPrice(price: number): string {
  if (price === 0) return '0.00';
  if (price < 0.0001) return price.toFixed(8).replace(/0+$/, '');
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

function formatCompactUsd(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatTokenStatusVi(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'ĐANG MỞ';
    case 'PASSED':
      return 'ĐẠT CHUẨN';
    case 'FILTERED':
      return 'ĐÃ LỌC';
    case 'CLOSED':
      return 'ĐÃ ĐÓNG';
    case 'WATCHING':
      return 'THEO DÕI';
    default:
      return status;
  }
}

function formatRiskLevelVi(risk?: string): string {
  switch (risk) {
    case 'HIGH RISK':
      return 'RỦI RO CAO';
    case 'MEDIUM RISK':
      return 'RỦI RO TRUNG BÌNH';
    case 'LOW RISK':
      return 'RỦI RO THẤP';
    case 'FILTERED':
      return 'ĐÃ CHẶN';
    default:
      return 'RỦI RO TRUNG BÌNH';
  }
}

export const LiveFlowWorkspace: React.FC<LiveFlowWorkspaceProps> = ({
  snapshot,
  selectedMint,
  onSelectMint,
  onSimulatePaper,
  onResetPaper,
  simBusy,
  onCreateAlertRule,
  onToggleAlertRule,
  onAcknowledgeAlertRule,
  onDeleteAlertRule,
  alertBusy,
  onOpenOvernightTab,
  onRunOvernight,
  overnightBusy,
  onOpenLiveTradeForMint,
  onToggleOvernightEnabled,
}) => {
  const [logSearch, setLogSearch] = useState('');
  const [logFilter, setLogFilter] = useState<string>('ALL');
  const [hoveredEquityIdx, setHoveredEquityIdx] = useState<number | null>(null);

  const selectedToken: TokenFlowItem = useMemo(() => {
    return (
      snapshot.tokens.find((t) => t.mintAddress === selectedMint) ??
      snapshot.tokens.find((t) => t.symbol === '$CLAUDIA') ??
      snapshot.tokens[0]
    );
  }, [snapshot.tokens, selectedMint]);

  const activeTrade: PaperTradeRecord | undefined = useMemo(() => {
    if (!selectedToken) return snapshot.trades[0];
    return (
      snapshot.trades.find((tr) => tr.mintAddress === selectedToken.mintAddress) ??
      snapshot.trades[0]
    );
  }, [snapshot.trades, selectedToken]);

  const openTradeForSelected = useMemo(() => {
    if (!selectedToken) return undefined;
    return snapshot.trades.find(
      (tr) => tr.mintAddress === selectedToken.mintAddress && tr.status === 'OPEN'
    );
  }, [snapshot.trades, selectedToken]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return snapshot.logs.filter((lg) => {
      if (logFilter !== 'ALL' && lg.eventType !== logFilter) return false;
      if (!q) return true;
      return (
        lg.agentName.toLowerCase().includes(q) ||
        (lg.tokenSymbol ?? '').toLowerCase().includes(q) ||
        lg.message.toLowerCase().includes(q) ||
        lg.reason.toLowerCase().includes(q)
      );
    });
  }, [snapshot.logs, logSearch, logFilter]);

  const handleExportLogsCsv = () => {
    const headers = ['Timestamp', 'Agent', 'Token', 'EventType', 'Message', 'Reason', 'Result'];
    const rows = filteredLogs.map((l) => [
      l.timestamp,
      l.agentName,
      l.tokenSymbol ?? '',
      l.eventType,
      `"${l.message.replace(/"/g, '""')}"`,
      `"${l.reason.replace(/"/g, '""')}"`,
      `"${l.resultBadge.replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grok_bot_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Equity chart coordinates
  const eqPoints = snapshot.equityHistory;
  const eqMin = Math.min(...eqPoints.map((p) => p.balanceUsd), snapshot.stats.paperStartBalanceUsd * 0.9);
  const eqMax = Math.max(...eqPoints.map((p) => p.balanceUsd), snapshot.stats.paperStartBalanceUsd * 1.1);
  const eqRange = Math.max(1, eqMax - eqMin);

  const chartW = 600;
  const chartH = 96;
  const svgCoords = eqPoints.map((pt, idx) => {
    const x = eqPoints.length > 1 ? (idx / (eqPoints.length - 1)) * (chartW - 24) + 12 : chartW / 2;
    const y = chartH - 12 - ((pt.balanceUsd - eqMin) / eqRange) * (chartH - 26);
    return { x, y, pt };
  });
  const linePath = svgCoords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaPath =
    svgCoords.length > 0
      ? `${linePath} L ${svgCoords[svgCoords.length - 1].x} ${chartH} L ${svgCoords[0].x} ${chartH} Z`
      : '';

  const { stats } = snapshot;
  const hoveredEq = hoveredEquityIdx !== null ? svgCoords[hoveredEquityIdx] : null;

  // Sparkline for Trade Detail
  const spark = activeTrade?.sparkline ?? [1, 1.15, 1.32, 1.54, 1.78];
  const sMin = Math.min(...spark) * 0.95;
  const sMax = Math.max(...spark) * 1.05;
  const sRange = Math.max(0.01, sMax - sMin);
  const sparkPath = spark
    .map((v, idx) => {
      const sx = spark.length > 1 ? (idx / (spark.length - 1)) * 150 + 6 : 80;
      const sy = 56 - ((v - sMin) / sRange) * 44;
      return `${idx === 0 ? 'M' : 'L'} ${sx} ${sy}`;
    })
    .join(' ');

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* SIMULATION MODE BANNER (STRICTLY PAPER TRADING — ISOLATED FROM REAL TRADING) */}
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EAC64D]/45 bg-[#06231F] px-3.5 py-2 font-mono-tabular text-xs">
        <div className="flex items-center gap-2">
          <span className="rounded border border-[#EAC64D]/60 bg-[#EAC64D]/15 px-2 py-0.5 text-[11px] font-bold text-[#EAC64D]">
            MỤC CHẠY MÔ PHỎNG (PAPER TRADING)
          </span>
          <span className="text-[#8FA9A0]">
            Toàn bộ lệnh mua/bán, lãi/lỗ và vốn tại đây là dữ liệu ảo mô phỏng — tách biệt hoàn toàn với Ví Phantom & Giao dịch thật.
          </span>
        </div>
      </section>

      {/* OVERNIGHT PROMPT QUICK STRIP (grok-bot-overnight.prompt · start $70 · 23:00 → 07:00) */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#FF9B45]/45 bg-[#06231F] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5 font-mono-tabular text-xs">
          <span className="inline-flex items-center gap-1.5 rounded border border-[#FF9B45]/50 bg-[#FF9B45]/10 px-2 py-0.5 font-bold text-[#FF9B45]">
            <Moon className="h-3.5 w-3.5" />
            PHIÊN ĐÊM · {snapshot.overnightConfig.sessionWindow}
          </span>
          <span className="text-[#E6F2ED]">
            Vốn chuẩn <strong>${snapshot.overnightConfig.startBalanceUsd}</strong> · Sizer{' '}
            <strong className="text-[#A986F5]">{snapshot.overnightRecap.effectivePositionPct}%</strong>
            {snapshot.overnightRecap.sizeScaledDownHalf ? ' (giảm 50%)' : ' (20–40% kép)'}
          </span>
          <span className="hidden md:inline text-[#8FA9A0]">
            · Vị thế {snapshot.overnightRecap.openPositionsCount}/{snapshot.overnightConfig.maxOpenPositions} · DD -{snapshot.overnightRecap.drawdownFromPeakPct}% / -{snapshot.overnightConfig.dailyDrawdownLimitPct}% · Chống FOMO +{snapshot.overnightConfig.noChase1hPct}%
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
          <button
            type="button"
            onClick={() => onToggleOvernightEnabled(!snapshot.overnightConfig.enabled)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-bold cursor-pointer ${
              snapshot.overnightConfig.enabled
                ? 'border-[#39DEA2]/70 bg-[#39DEA2]/15 text-[#39DEA2]'
                : 'border-[#EF6682]/70 bg-[#EF6682]/15 text-[#EF6682]'
            }`}
            title="Bật / Tắt Kịch bản Qua đêm"
          >
            <Power className="h-3 w-3" />
            {snapshot.overnightConfig.enabled ? 'ĐANG BẬT' : 'ĐANG TẮT'}
          </button>
          <button
            type="button"
            onClick={onOpenOvernightTab}
            className="rounded border border-[#145B4B] bg-[#031713] px-2.5 py-1 text-[11px] text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
          >
            Cài đặt giờ & Tổng kết
          </button>
          <button
            type="button"
            disabled={overnightBusy || !snapshot.overnightConfig.enabled}
            onClick={() => onRunOvernight(true)}
            className="inline-flex items-center gap-1 rounded border border-[#FF9B45] bg-[#FF9B45] px-2.5 py-1 text-[11px] font-bold text-[#031713] hover:bg-[#ffae66] disabled:opacity-40 cursor-pointer"
          >
            <span>{overnightBusy ? 'Đang chạy...' : `Chạy $${snapshot.overnightConfig.startBalanceUsd} Phiên Đêm`}</span>
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </section>

      {/* DAILY TRADING SUMMARY CARD */}
      <DailyTradingSummaryCard snapshot={snapshot} />

      {/* 1 + 2 + 3: LIVE FLOW + TOKEN FLOW STRIP + CENTRAL FLOW DIAGRAM */}
      <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5 shadow-[0_0_24px_rgba(3,23,19,0.8)]">
        {/* LIVE FLOW Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
            <span className="text-[#43D7B1]">LUỒNG TRỰC TIẾP</span>
            <span>·</span>
            <span className="font-mono-tabular text-[11px] text-[#E6F2ED]/80">
              RADAR → KIỂM TOÁN → QUY MÔ → SNIPER → CHỐT LỜI
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono-tabular text-xs text-[#8FA9A0]">
            <span>đã kiểm tra {stats.tokensChecked}</span>
            <span>·</span>
            <span className="text-[#43D7B1]">{snapshot.isRunning ? 'ĐANG STREAM' : 'TẠM DỪNG'}</span>
          </div>
        </div>

        {/* TOKEN FLOW Horizontal Strip */}
        <div className="flex gap-2.5 overflow-x-auto pb-2">
          {snapshot.tokens.map((tok) => {
            const isSel = selectedToken?.mintAddress === tok.mintAddress;
            const chg = tok.priceChange1h;
            return (
              <button
                key={tok.mintAddress}
                type="button"
                onClick={() => onSelectMint(tok.mintAddress)}
                className={`min-w-[175px] shrink-0 rounded-lg border px-3 py-2 text-left transition-all cursor-pointer ${
                  isSel
                    ? 'border-[#FF9B45] bg-[#092D27] shadow-[0_0_12px_rgba(255,155,69,0.22)]'
                    : 'border-[#145B4B] bg-[#041A16] hover:border-[#43D7B1]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#E6F2ED] truncate">{tok.symbol}</span>
                  <span
                    className={`font-mono-tabular text-[10px] font-semibold ${
                      tok.status === 'FILTERED'
                        ? 'text-[#EF6682]'
                        : tok.status === 'OPEN'
                        ? 'text-[#39DEA2]'
                        : 'text-[#43D7B1]'
                    }`}
                  >
                    {formatTokenStatusVi(tok.status)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2 font-mono-tabular text-xs">
                  <span className="text-[#8FA9A0]">{formatPrice(tok.priceUsd)}</span>
                  <span className={chg >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'}>
                    {chg >= 0 ? '+' : ''}
                    {chg.toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between font-mono-tabular text-[10px] text-[#8FA9A0]">
                  <span>{tok.mintAddress.slice(0, 4)}..{tok.mintAddress.slice(-3)}</span>
                  <span>{tok.dexId}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* CENTRAL FLOW DIAGRAM */}
        <div className="relative mt-2 rounded-xl border border-[#145B4B]/60 bg-[#031713]/70 px-4 py-5 overflow-hidden">
          {/* Subtle animated SVG connector line */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full hidden md:block"
            preserveAspectRatio="none"
            viewBox="0 0 800 140"
          >
            <line
              x1="160"
              y1="66"
              x2="375"
              y2="66"
              stroke="#43D7B1"
              strokeWidth="2"
              strokeDasharray="4 6"
              className="animate-flow-line"
              opacity="0.55"
            />
            <line
              x1="425"
              y1="66"
              x2="640"
              y2="66"
              stroke="#39DEA2"
              strokeWidth="2"
              strokeDasharray="4 6"
              className="animate-flow-line"
              opacity="0.65"
            />
          </svg>

          <div className="relative z-10 grid grid-cols-1 items-center gap-6 md:grid-cols-3">
            {/* LEFT NODE: LP AUDIT */}
            <div className="flex flex-col items-center text-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full border-2 ${
                  selectedToken?.status === 'FILTERED'
                    ? 'border-[#EF6682] bg-[#EF6682]/20 shadow-[0_0_24px_rgba(239,102,130,0.4)]'
                    : 'border-[#EF6682]/80 bg-[#EF6682]/10 shadow-[0_0_18px_rgba(239,102,130,0.22)]'
                }`}
              >
                <AlertTriangle className="h-7 w-7 text-[#EF6682]" />
              </div>
              <div className="mt-2 font-mono-tabular text-xs font-bold tracking-wider text-[#EF6682]">
                KIỂM TOÁN LP
              </div>
              <div className="mt-0.5 font-mono-tabular text-[11px] text-[#E6F2ED]">
                {selectedToken?.status === 'FILTERED'
                  ? `ĐÃ LỌC ${selectedToken.symbol}`
                  : `ĐẠT ${selectedToken?.symbol ?? '$CLAUDIA'}`}
              </div>
              <div className="text-[10px] text-[#8FA9A0] max-w-[200px] truncate">
                {selectedToken?.reason ?? 'Đã kiểm tra Mint & Freeze'}
              </div>
            </div>

            {/* CENTER NODE: GROK CORE */}
            <div className="flex flex-col items-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#43D7B1] bg-[#06231F] shadow-[0_0_32px_rgba(67,215,177,0.3)]">
                <GrokLogo className="h-12 w-12" />
              </div>
              <div className="mt-2 font-mono-tabular text-xs font-bold tracking-wider text-[#E6F2ED]">
                LÕI GROK · <span className="text-[#43D7B1]">{snapshot.throughputMsgPerSec} tin/giây</span>
              </div>
              <div className="text-[11px] text-[#8FA9A0]">
                10 Agent đồng bộ · Chỉ chạy Paper Trading
              </div>
            </div>

            {/* RIGHT NODE: PAPER SNIPER */}
            <div className="flex flex-col items-center text-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full border-2 ${
                  openTradeForSelected
                    ? 'border-[#39DEA2] bg-[#39DEA2]/20 shadow-[0_0_24px_rgba(57,222,162,0.4)]'
                    : 'border-[#39DEA2]/80 bg-[#39DEA2]/10 shadow-[0_0_18px_rgba(57,222,162,0.22)]'
                }`}
              >
                <Crosshair className="h-7 w-7 text-[#39DEA2]" />
              </div>
              <div className="mt-2 font-mono-tabular text-xs font-bold tracking-wider text-[#39DEA2]">
                SNIPER MÔ PHỎNG
              </div>
              <div className="mt-0.5 font-mono-tabular text-[11px] text-[#E6F2ED]">
                {openTradeForSelected
                  ? `ĐANG MỞ (MÔ PHỎNG) ${openTradeForSelected.symbol}`
                  : 'ĐANG CHỜ LỆNH (PAPER)'}
              </div>
              <div className="text-[10px] text-[#8FA9A0]">
                Gần nhất: {stats.lastSellSymbol} {stats.lastSellPnlUsd >= 0 ? '+' : ''}$
                {stats.lastSellPnlUsd.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. FOUR STATISTICS CARDS (Computed live from SQLite) */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-[#8FA9A0]">
            <span>ĐÃ LỌC (BLOCKED)</span>
            <span className="text-[#EF6682] font-mono-tabular">{stats.blockedPct}%</span>
          </div>
          <div className="mt-1.5 font-mono-tabular text-2xl font-bold text-[#E6F2ED]">
            {stats.blockedCount}
          </div>
          <div className="mt-0.5 font-mono-tabular text-[11px] text-[#8FA9A0]">
            trên {stats.tokensChecked} đã kiểm tra
          </div>
        </div>

        <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-[#8FA9A0]">
            <span>HỆ SỐ TỐT NHẤT</span>
            <span className="text-[#EAC64D] font-mono-tabular">MÔ PHỎNG</span>
          </div>
          <div className="mt-1.5 font-mono-tabular text-2xl font-bold text-[#EAC64D]">
            {stats.bestMultiplier.toFixed(1)}×
          </div>
          <div className="mt-0.5 font-mono-tabular text-[11px] text-[#8FA9A0]">
            {stats.bestSymbol} · +${stats.bestPnlUsd.toFixed(2)} ảo
          </div>
        </div>

        <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-[#8FA9A0]">
            <span>TỶ LỆ THẮNG</span>
            <span className="text-[#A986F5] font-mono-tabular">MÔ PHỎNG</span>
          </div>
          <div className="mt-1.5 font-mono-tabular text-2xl font-bold text-[#E6F2ED]">
            {stats.winRatePct}%
          </div>
          <div className="mt-0.5 font-mono-tabular text-[11px] text-[#8FA9A0]">
            {stats.wins} Dương / {stats.losses} Âm
          </div>
        </div>

        <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-[#8FA9A0]">
            <span>BÁN GẦN NHẤT</span>
            <span className="text-[#49A9ED] font-mono-tabular">{stats.lastSellSymbol}</span>
          </div>
          <div
            className={`mt-1.5 font-mono-tabular text-2xl font-bold ${
              stats.lastSellPnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'
            }`}
          >
            {stats.lastSellPnlUsd >= 0 ? '+' : '-'}${Math.abs(stats.lastSellPnlUsd).toFixed(2)}
          </div>
          <div className="mt-0.5 font-mono-tabular text-[11px] text-[#8FA9A0] truncate">
            {stats.lastSellReason}
          </div>
        </div>
      </section>

      {/* 5 & 6: TRADE · ENTRY vs EXIT (Left) + SESSION TERMINAL (Right) */}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* TRADE · ENTRY vs EXIT */}
        <div className="flex flex-col justify-between rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-[#145B4B]/60 pb-2">
              <span className="text-xs font-semibold tracking-wider text-[#8FA9A0]">
                CHI TIẾT LỆNH · GIÁ VÀO vs GIÁ THOÁT
              </span>
              <span
                className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-semibold ${
                  openTradeForSelected
                    ? 'border-[#39DEA2]/60 bg-[#39DEA2]/10 text-[#39DEA2]'
                    : 'border-[#145B4B] bg-[#092D27] text-[#8FA9A0]'
                }`}
              >
                {openTradeForSelected ? 'ĐANG MỞ (MÔ PHỎNG)' : activeTrade?.status === 'CLOSED' ? 'ĐÃ ĐÓNG (MÔ PHỎNG)' : activeTrade?.status ?? 'SẴN SÀNG'}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EF6682]/20 font-mono-tabular text-xs font-bold text-[#EF6682]">
                  {(selectedToken?.symbol ?? '$C').replace('$', '').slice(0, 2)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-[#E6F2ED]">
                      {selectedToken?.symbol ?? activeTrade?.symbol ?? '—'}
                    </span>
                    <span className="rounded border border-[#EF6682]/50 bg-[#EF6682]/10 px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold text-[#EF6682]">
                      {formatRiskLevelVi(selectedToken?.riskLevel ?? activeTrade?.riskLevel)}
                    </span>
                  </div>
                  <div className="font-mono-tabular text-[10px] text-[#8FA9A0]">
                    Mint: {selectedToken?.mintAddress ?? activeTrade?.mintAddress}
                  </div>
                </div>
              </div>

              <div className="font-mono-tabular text-xl font-bold text-[#39DEA2]">
                {(activeTrade?.multiplier ?? 1.0).toFixed(2)}×
              </div>
            </div>

            {/* Metrics + Sparkline Curve */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12 items-center">
              <div className="sm:col-span-7 space-y-1.5 font-mono-tabular text-xs">
                <div className="flex justify-between">
                  <span className="text-[#8FA9A0]">giá tham chiếu / vào (mô phỏng)</span>
                  <span className="text-[#E6F2ED]">
                    ${formatPrice(activeTrade?.entryPriceSimUsd ?? selectedToken?.priceUsd ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8FA9A0]">giá thoát (mô phỏng)</span>
                  <span className="text-[#39DEA2]">
                    {activeTrade?.exitPriceSimUsd
                      ? `$${formatPrice(activeTrade.exitPriceSimUsd)}`
                      : 'vị thế đang mở'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8FA9A0]">vốn hóa / thanh khoản</span>
                  <span className="text-[#E6F2ED]">
                    {formatCompactUsd(selectedToken?.fdvUsd ?? activeTrade?.mcapUsd ?? 0)} /{' '}
                    {formatCompactUsd(selectedToken?.liquidityUsd ?? activeTrade?.liquidityUsd ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8FA9A0]">quy mô / trượt giá + phí</span>
                  <span className="text-[#E6F2ED]">
                    {activeTrade?.equityPct ?? 4}% (${activeTrade?.equityAllocatedUsd ?? 0}) · 0.5%
                  </span>
                </div>
                <div className="pt-1 text-[11px] text-[#FF9B45]">
                  lý do: <span className="text-[#E6F2ED]">{selectedToken?.reason ?? activeTrade?.reason}</span>
                </div>
              </div>

              <div className="sm:col-span-5 rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2">
                <svg viewBox="0 0 162 64" className="h-16 w-full">
                  <line x1="6" y1="42" x2="156" y2="42" stroke="#145B4B" strokeDasharray="3 3" />
                  <path d={sparkPath} fill="none" stroke="#39DEA2" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                <div className="mt-1 flex justify-between font-mono-tabular text-[10px] text-[#8FA9A0]">
                  <span>curve {selectedToken?.bondingCurvePct ?? 98}%</span>
                  <span>{(selectedToken?.holdersCount ?? 1599).toLocaleString()} ví giữ</span>
                </div>
              </div>
            </div>
          </div>

          {/* Paper Trading Interactive Execution Controls (Strictly Simulated) */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#145B4B]/60 pt-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {!openTradeForSelected ? (
                <button
                  type="button"
                  disabled={simBusy || !selectedToken || selectedToken.status === 'FILTERED'}
                  onClick={() => selectedToken && onSimulatePaper(selectedToken.mintAddress, 'OPEN_SIM')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#39DEA2]/60 bg-[#39DEA2]/15 px-2.5 py-1.5 font-mono-tabular text-xs font-semibold text-[#39DEA2] transition-colors hover:bg-[#39DEA2]/25 disabled:opacity-40 cursor-pointer"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  MUA MÔ PHỎNG 4%
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={simBusy}
                    onClick={() => onSimulatePaper(selectedToken.mintAddress, 'CLOSE_SIM', 1.78)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#EAC64D]/60 bg-[#EAC64D]/15 px-2.5 py-1.5 font-mono-tabular text-xs font-semibold text-[#EAC64D] transition-colors hover:bg-[#EAC64D]/25 disabled:opacity-40 cursor-pointer"
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    CHỐT LỜI (MÔ PHỎNG) 1.78×
                  </button>
                  <button
                    type="button"
                    disabled={simBusy}
                    onClick={() => onSimulatePaper(selectedToken.mintAddress, 'CLOSE_SIM', 0.88)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#EF6682]/60 bg-[#EF6682]/15 px-2.5 py-1.5 font-mono-tabular text-xs font-semibold text-[#EF6682] transition-colors hover:bg-[#EF6682]/25 disabled:opacity-40 cursor-pointer"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    CẮT LỖ (MÔ PHỎNG) -12%
                  </button>
                </>
              )}
              {selectedToken && (
                <button
                  type="button"
                  onClick={() => onOpenLiveTradeForMint(selectedToken.mintAddress)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#A986F5]/70 bg-[#A986F5]/15 px-2.5 py-1.5 font-mono-tabular text-xs font-semibold text-[#A986F5] transition-colors hover:bg-[#A986F5]/25 cursor-pointer"
                  title="Hoán đổi thật token này qua Jupiter DEX & Ví Phantom"
                >
                  <Zap className="h-3.5 w-3.5" />
                  MUA THẬT (JUPITER)
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onResetPaper}
              className="inline-flex items-center gap-1 rounded border border-[#145B4B] bg-[#092D27] px-2 py-1 font-mono-tabular text-[11px] text-[#8FA9A0] hover:text-[#E6F2ED] cursor-pointer"
              title="Đặt lại số dư Paper Trading ảo về $50.00"
            >
              <RotateCcw className="h-3 w-3" />
              Đặt lại vốn ảo $50
            </button>
          </div>
        </div>

        {/* SESSION TERMINAL */}
        <div className="flex flex-col rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
          <div className="flex items-center justify-between border-b border-[#145B4B]/60 pb-2 font-mono-tabular text-xs">
            <span className="text-[#43D7B1] font-semibold">$ tail -f session.log</span>
            <span className="text-[#8FA9A0]">{snapshot.logs.length} dòng</span>
          </div>

          <div className="mt-2.5 h-[220px] space-y-2 overflow-y-auto pr-1 font-mono-tabular text-xs">
            {snapshot.logs.slice(0, 18).map((lg) => (
              <div key={lg.id} className="leading-relaxed">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[#8FA9A0]">{lg.timeShort}</span>
                  <span
                    className={
                      lg.eventType === 'SELL_SIM'
                        ? 'text-[#39DEA2] font-semibold'
                        : lg.eventType === 'BUY_SIM'
                        ? 'text-[#EAC64D] font-semibold'
                        : lg.eventType === 'STOP_SIM' || lg.eventType === 'ERROR'
                        ? 'text-[#EF6682] font-semibold'
                        : 'text-[#49A9ED] font-semibold'
                    }
                  >
                    {lg.message}
                  </span>
                  <span
                    className={
                      lg.isPositive === true
                        ? 'text-[#39DEA2]'
                        : lg.isPositive === false
                        ? 'text-[#EF6682]'
                        : 'text-[#8FA9A0]'
                    }
                  >
                    {lg.resultBadge}
                  </span>
                </div>
                <div className="pl-11 text-[11px] text-[#8FA9A0]">{lg.reason}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. EQUITY CHART */}
      <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
            <span>TÀI SẢN MÔ PHỎNG (EQUITY)</span>
            <span>·</span>
            <span className="text-[#E6F2ED]">PHIÊN PAPER TRADING</span>
          </div>
          <div className="font-mono-tabular text-xs text-[#8FA9A0]">
            {eqPoints[0]?.label ?? 'BẮT ĐẦU'} → {eqPoints[eqPoints.length - 1]?.label ?? 'HIỆN TẠI'} · Dữ liệu SQLite
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-center">
          <div className="relative lg:col-span-9 rounded-lg border border-[#145B4B]/60 bg-[#031713] p-2">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="h-28 w-full overflow-visible">
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#39DEA2" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#39DEA2" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {areaPath && <path d={areaPath} fill="url(#eqGrad)" />}
              {linePath && (
                <path d={linePath} fill="none" stroke="#39DEA2" strokeWidth="2.5" strokeLinecap="round" />
              )}
              {svgCoords.map((c, idx) => (
                <g key={c.pt.id}>
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={hoveredEquityIdx === idx ? 5 : 3}
                    fill="#39DEA2"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredEquityIdx(idx)}
                    onMouseLeave={() => setHoveredEquityIdx(null)}
                  />
                </g>
              ))}
            </svg>

            {hoveredEq && (
              <div className="mt-1 flex items-center justify-between font-mono-tabular text-[11px] text-[#43D7B1]">
                <span>
                  {hoveredEq.pt.label} · {hoveredEq.pt.note}
                </span>
                <span>
                  ${hoveredEq.pt.balanceUsd.toFixed(2)} ({hoveredEq.pt.pnlDeltaUsd >= 0 ? '+' : ''}
                  ${hoveredEq.pt.pnlDeltaUsd.toFixed(2)})
                </span>
              </div>
            )}
          </div>

          <div className="lg:col-span-3 flex flex-row lg:flex-col justify-between gap-2 font-mono-tabular">
            <div>
              <div className="text-[11px] text-[#8FA9A0]">BẮT ĐẦU</div>
              <div className="text-lg font-bold text-[#E6F2ED]">
                ${stats.paperStartBalanceUsd.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#8FA9A0]">HIỆN TẠI (MÔ PHỎNG)</div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-[#39DEA2]">
                  ${stats.paperBalanceUsd.toFixed(2)}
                </span>
                <span className="text-xs text-[#43D7B1]">
                  {stats.paperStartBalanceUsd > 0
                    ? `${(stats.paperBalanceUsd / stats.paperStartBalanceUsd).toFixed(2)}×`
                    : '—'}
                </span>
              </div>
              <div className="text-[11px] text-[#8FA9A0]">
                Lãi/Lỗ: {stats.totalPnlUsd >= 0 ? '+' : '-'}${Math.abs(stats.totalPnlUsd).toFixed(2)} (
                {stats.totalPnlPct >= 0 ? '+' : ''}
                {stats.totalPnlPct}%)
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7.5 TRADE HISTORY (Recharts Simulated PnL Progression) */}
      <TradeHistoryChart
        trades={snapshot.trades}
        startBalanceUsd={stats.paperStartBalanceUsd}
      />

      {/* 7.6 RISK ASSESSMENT (10-Agent Spider Chart) */}
      <RiskAssessmentRadar
        snapshot={snapshot}
        selectedToken={selectedToken}
      />

      {/* 7.7 AGENT PERFORMANCE RANKING TABLE */}
      <AgentLeaderboardTable
        agents={snapshot.agents}
        trades={snapshot.trades}
        logs={snapshot.logs}
        tokens={snapshot.tokens}
      />

      {/* 7.72 PERFORMANCE HEATMAP (PnL vs Volatility Risk Matrix) */}
      <PerformanceHeatmap
        agents={snapshot.agents}
        trades={snapshot.trades}
        logs={snapshot.logs}
        tokens={snapshot.tokens}
        volatilityAlerts={snapshot.volatilityAlerts}
        selectedToken={selectedToken}
      />

      {/* 7.75 TRADE ACTIVITY LOG (Chronological Simulated Trades Feed) */}
      <TradeActivityLog
        trades={snapshot.trades}
        agents={snapshot.agents}
        logs={snapshot.logs}
        isRunning={snapshot.isRunning}
        onSelectMint={onSelectMint}
      />

      {/* 7.8 VOLATILITY ALERTS CONFIGURATION */}
      <VolatilityAlertsPanel
        agents={snapshot.agents}
        rules={snapshot.volatilityAlerts}
        onCreateRule={onCreateAlertRule}
        onToggleRule={onToggleAlertRule}
        onAcknowledgeRule={onAcknowledgeAlertRule}
        onDeleteRule={onDeleteAlertRule}
        busy={alertBusy}
      />

      {/* 8. SYSTEM LOG (Search, Filter, Export CSV) */}
      <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
            <span>NHẬT KÝ HỆ THỐNG (SYSTEM LOG)</span>
            <span className="font-mono-tabular text-[11px] text-[#43D7B1]">
              {filteredLogs.length} bản ghi
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8FA9A0]" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Tìm agent, token, lý do..."
                className="w-48 rounded-md border border-[#145B4B] bg-[#031713] py-1 pl-8 pr-2.5 font-mono-tabular text-xs text-[#E6F2ED] placeholder-[#8FA9A0]/60 focus:border-[#43D7B1] focus:outline-none"
              />
            </div>

            <select
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              className="rounded-md border border-[#145B4B] bg-[#031713] px-2.5 py-1 font-mono-tabular text-xs text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
            >
              <option value="ALL">Tất cả sự kiện</option>
              <option value="SCAN">QUÉT (SCAN)</option>
              <option value="AUDIT">KIỂM TOÁN (AUDIT)</option>
              <option value="BUY_SIM">MUA MÔ PHỎNG</option>
              <option value="SELL_SIM">BÁN MÔ PHỎNG</option>
              <option value="STOP_SIM">CẮT LỖ MÔ PHỎNG</option>
              <option value="INFO">THÔNG TIN (INFO)</option>
              <option value="WARN">CẢNH BÁO (WARN)</option>
              <option value="ERROR">LỖI (ERROR)</option>
            </select>

            <button
              type="button"
              onClick={handleExportLogsCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#145B4B] bg-[#092D27] px-2.5 py-1 font-mono-tabular text-xs text-[#E6F2ED] hover:border-[#43D7B1] cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#43D7B1]" />
              Xuất CSV
            </button>
          </div>
        </div>

        <div className="mt-2.5 max-h-64 overflow-y-auto divide-y divide-[#145B4B]/40">
          {filteredLogs.length === 0 ? (
            <div className="py-6 text-center font-mono-tabular text-xs text-[#8FA9A0]">
              Không tìm thấy bản ghi nhật ký phù hợp.
            </div>
          ) : (
            filteredLogs.map((lg) => (
              <div
                key={lg.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 font-mono-tabular text-xs hover:bg-[#092D27]/40 px-1.5 rounded"
              >
                <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                  <span className="text-[#8FA9A0] shrink-0">{lg.timeShort}</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                      lg.eventType === 'STOP_SIM' || lg.eventType === 'ERROR'
                        ? 'border-[#EF6682]/60 bg-[#EF6682]/10 text-[#EF6682]'
                        : lg.eventType === 'BUY_SIM'
                        ? 'border-[#EAC64D]/60 bg-[#EAC64D]/10 text-[#EAC64D]'
                        : lg.eventType === 'SELL_SIM'
                        ? 'border-[#39DEA2]/60 bg-[#39DEA2]/10 text-[#39DEA2]'
                        : 'border-[#49A9ED]/60 bg-[#49A9ED]/10 text-[#49A9ED]'
                    }`}
                  >
                    {lg.eventType.replace('_SIM', '')}
                  </span>
                  <span className="font-semibold text-[#E6F2ED] shrink-0">
                    {lg.tokenSymbol ?? lg.agentName}
                  </span>
                  <span className="text-[#8FA9A0] truncate">
                    {lg.message} — {lg.reason}
                  </span>
                </div>

                <span
                  className={`shrink-0 font-semibold ${
                    lg.isPositive === true
                      ? 'text-[#39DEA2]'
                      : lg.isPositive === false
                      ? 'text-[#EF6682]'
                      : 'text-[#EAC64D]'
                  }`}
                >
                  {lg.resultBadge}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
