import React, { useMemo, useState } from 'react';
import { Flame, ShieldCheck, Sparkles, Target } from 'lucide-react';
import type {
  AgentId,
  AgentRecord,
  PaperTradeRecord,
  SystemLogEntry,
  TokenFlowItem,
  VolatilityAlertRule,
} from '../types/terminal';

interface PerformanceHeatmapProps {
  agents: AgentRecord[];
  trades: PaperTradeRecord[];
  logs: SystemLogEntry[];
  tokens: TokenFlowItem[];
  volatilityAlerts: VolatilityAlertRule[];
  selectedToken?: TokenFlowItem;
}

interface AgentHeatmapMetric {
  agent: AgentRecord;
  shortCode: string;
  pnlUsd: number;
  winRatePct: number;
  totalTrades: number;
  volatilityRisk: number; // 0 - 100
  drawdownPct: number;
  triggeredAlerts: number;
  efficiencyScore: number; // Higher = better PnL per unit of risk
  pnlRowIdx: number; // 0 (top, highest PnL) -> 4 (bottom, lowest PnL)
  riskColIdx: number; // 0 (left, lowest risk) -> 4 (right, highest risk)
  isSweetSpot: boolean;
}

const SHORT_CODES: Record<AgentId, string> = {
  launch_radar: 'RADAR',
  whale_watch: 'WHALE',
  sentiment: 'SENT',
  lp_auditor: 'AUDIT',
  holder_map: 'HOLD',
  risk_sizer: 'SIZER',
  sniper: 'SNIPER',
  profit_taker: 'PROFIT',
  stop_guard: 'STOP',
  journal: 'LOG',
};

const PNL_ROWS = [
  { label: 'Lãi rất cao', sub: '≥ +$8.00' },
  { label: 'Lãi dương', sub: '+$0.50 → +$7.99' },
  { label: 'Hòa vốn', sub: '-$0.49 → +$0.49' },
  { label: 'Lỗ nhẹ', sub: '-$4.99 → -$0.50' },
  { label: 'Lỗ sâu', sub: '≤ -$5.00' },
];

const RISK_COLS = [
  { label: 'Rất thấp', sub: '0–20' },
  { label: 'Thấp', sub: '21–40' },
  { label: 'Trung bình', sub: '41–60' },
  { label: 'Cao', sub: '61–80' },
  { label: 'Rất cao', sub: '81–100' },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getPnlBucketIdx(pnlUsd: number): number {
  if (pnlUsd >= 8) return 0;
  if (pnlUsd >= 0.5) return 1;
  if (pnlUsd > -0.5) return 2;
  if (pnlUsd > -5) return 3;
  return 4;
}

function getRiskBucketIdx(risk: number): number {
  if (risk <= 20) return 0;
  if (risk <= 40) return 1;
  if (risk <= 60) return 2;
  if (risk <= 80) return 3;
  return 4;
}

function getCellHeatStyle(rowIdx: number, colIdx: number, count: number): string {
  // Top-left (row 0-1, col 0-1) = High PnL, Low Risk (Ideal emerald zone)
  // Bottom-right (row 3-4, col 3-4) = Negative PnL, High Risk (Danger crimson zone)
  const favorability = (4 - rowIdx) * 1.15 + (4 - colIdx) * 0.85; // 0 (worst) -> 8 (best)
  const hasItems = count > 0;

  if (rowIdx <= 1 && colIdx <= 1) {
    return hasItems
      ? 'border-[#39DEA2]/80 bg-[#39DEA2]/22 shadow-[inset_0_0_16px_rgba(57,222,162,0.18)]'
      : 'border-[#39DEA2]/35 bg-[#39DEA2]/8';
  }
  if (favorability >= 5.2) {
    return hasItems
      ? 'border-[#43D7B1]/70 bg-[#43D7B1]/16'
      : 'border-[#145B4B]/80 bg-[#04231D]';
  }
  if (favorability >= 3.6) {
    return hasItems
      ? 'border-[#EAC64D]/65 bg-[#EAC64D]/15'
      : 'border-[#145B4B]/70 bg-[#031B16]';
  }
  if (favorability >= 2.0) {
    return hasItems
      ? 'border-[#FF9B45]/65 bg-[#FF9B45]/16'
      : 'border-[#145B4B]/60 bg-[#091815]';
  }
  return hasItems
    ? 'border-[#EF6682]/75 bg-[#EF6682]/20'
    : 'border-[#EF6682]/25 bg-[#190B10]/55';
}

export const PerformanceHeatmap: React.FC<PerformanceHeatmapProps> = ({
  agents,
  trades,
  logs,
  tokens,
  volatilityAlerts,
  selectedToken,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [onlySweetSpot, setOnlySweetSpot] = useState(false);

  const metrics = useMemo<AgentHeatmapMetric[]>(() => {
    const closedTrades = trades.filter((t) => t.status === 'CLOSED');
    const tokenMap = new Map(tokens.map((t) => [t.mintAddress, t]));

    const openTrades = trades.filter((t) => t.status === 'OPEN');
    const openAllocatedUsd = openTrades.reduce((sum, t) => sum + t.equityAllocatedUsd, 0);
    const avgTokenVol1h =
      tokens.length > 0
        ? tokens.reduce((s, t) => s + Math.abs(t.priceChange1h), 0) / tokens.length
        : 22;

    return agents.map((agent) => {
      let matched: PaperTradeRecord[] = [];

      switch (agent.id) {
        case 'profit_taker':
          matched = closedTrades.filter((t) => t.pnlUsd > 0);
          break;
        case 'stop_guard':
          matched = closedTrades.filter((t) => t.pnlUsd <= 0);
          break;
        case 'sniper':
          matched = trades;
          break;
        case 'risk_sizer':
          matched = trades.filter((t) => t.equityPct > 0);
          break;
        case 'journal': {
          const loggedMints = new Set(
            logs.filter((l) => l.mintAddress).map((l) => l.mintAddress as string)
          );
          matched = closedTrades.filter((t) => loggedMints.has(t.mintAddress) || t.status === 'CLOSED');
          break;
        }
        case 'lp_auditor':
          matched = closedTrades.filter((t) => t.liquidityUsd >= 30000);
          break;
        case 'holder_map':
          matched = closedTrades.filter((t) => t.holdersCount >= 500);
          break;
        case 'whale_watch':
          matched = closedTrades.filter((t) => {
            const tok = tokenMap.get(t.mintAddress);
            return (
              (tok && tok.whaleInflowUsd > 15000) ||
              t.reason.toLowerCase().includes('whale') ||
              t.reason.toLowerCase().includes('flow')
            );
          });
          break;
        case 'sentiment':
          matched = closedTrades.filter((t) => {
            const tok = tokenMap.get(t.mintAddress);
            return (
              (tok && tok.priceChange1h >= 30) ||
              t.reason.toLowerCase().includes('momentum') ||
              t.reason.toLowerCase().includes('flow')
            );
          });
          break;
        case 'launch_radar':
          matched = closedTrades.filter((t) => t.bondingCurvePct >= 80);
          break;
      }

      const closedMatched = matched.filter((t) => t.status === 'CLOSED');
      const totalTrades = matched.length;
      const wins = closedMatched.filter((t) => t.pnlUsd > 0).length;
      const winRatePct =
        closedMatched.length > 0 ? Math.round((wins / closedMatched.length) * 100) : 0;
      const pnlUsd = Number(closedMatched.reduce((sum, t) => sum + t.pnlUsd, 0).toFixed(2));

      // Compute agent drawdown from chronological equity curve
      let equity = 50;
      let peak = 50;
      let maxDd = 0;
      const chronological = [...closedMatched].sort(
        (a, b) =>
          new Date(a.closedAt ?? a.openedAt).getTime() -
          new Date(b.closedAt ?? b.openedAt).getTime()
      );
      for (const tr of chronological) {
        equity = Math.max(1, equity + tr.pnlUsd);
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
      }
      const drawdownPct = Number(maxDd.toFixed(1));

      // Compute Volatility Risk score (0-100) from matched trades' token volatility, drawdown, and alerts
      const agentAlerts = volatilityAlerts.filter((r) => r.agentId === agent.id);
      const triggeredAlerts = agentAlerts.filter((r) => r.isTriggered).length;

      const avgMatchedVol =
        matched.length > 0
          ? matched.reduce((sum, tr) => {
              const tok = tokenMap.get(tr.mintAddress);
              return sum + Math.abs(tok?.priceChange1h ?? 24);
            }, 0) / matched.length
          : avgTokenVol1h;

      let baseRisk = 25;
      switch (agent.id) {
        case 'journal':
          baseRisk = 10 + triggeredAlerts * 18;
          break;
        case 'lp_auditor':
          baseRisk = 16 + (selectedToken?.status === 'FILTERED' ? 28 : 0) + triggeredAlerts * 16;
          break;
        case 'holder_map':
          baseRisk = 22 + triggeredAlerts * 15;
          break;
        case 'profit_taker':
          baseRisk = 24 + drawdownPct * 0.8 + triggeredAlerts * 14;
          break;
        case 'risk_sizer':
          baseRisk =
            20 +
            clamp((openAllocatedUsd / 50) * 65, 0, 45) +
            drawdownPct * 0.9 +
            triggeredAlerts * 12;
          break;
        case 'whale_watch':
          baseRisk = 28 + clamp(avgMatchedVol * 0.25, 0, 35) + triggeredAlerts * 14;
          break;
        case 'launch_radar':
          baseRisk = 36 + clamp(avgMatchedVol * 0.35, 0, 40) + triggeredAlerts * 14;
          break;
        case 'sentiment':
          baseRisk = 34 + clamp(avgMatchedVol * 0.38, 0, 42) + triggeredAlerts * 14;
          break;
        case 'sniper':
          baseRisk =
            38 +
            clamp(avgMatchedVol * 0.32, 0, 35) +
            drawdownPct * 1.1 +
            triggeredAlerts * 15;
          break;
        case 'stop_guard':
          baseRisk = 32 + drawdownPct * 1.8 + triggeredAlerts * 16;
          break;
      }

      const volatilityRisk = Math.round(clamp(baseRisk, 6, 98));
      const pnlRowIdx = getPnlBucketIdx(pnlUsd);
      const riskColIdx = getRiskBucketIdx(volatilityRisk);
      const isSweetSpot = pnlUsd > 0 && volatilityRisk <= 40;
      const efficiencyScore = Number(((pnlUsd + 10) / Math.max(10, volatilityRisk)).toFixed(2));

      return {
        agent,
        shortCode: SHORT_CODES[agent.id],
        pnlUsd,
        winRatePct,
        totalTrades,
        volatilityRisk,
        drawdownPct,
        triggeredAlerts,
        efficiencyScore,
        pnlRowIdx,
        riskColIdx,
        isSweetSpot,
      };
    });
  }, [agents, trades, logs, tokens, volatilityAlerts, selectedToken]);

  const visibleMetrics = useMemo(
    () => (onlySweetSpot ? metrics.filter((m) => m.isSweetSpot) : metrics),
    [metrics, onlySweetSpot]
  );

  const sweetSpotAgents = useMemo(
    () =>
      [...metrics]
        .filter((m) => m.isSweetSpot)
        .sort((a, b) => b.efficiencyScore - a.efficiencyScore),
    [metrics]
  );

  const bestEfficiency = useMemo(
    () => [...metrics].sort((a, b) => b.efficiencyScore - a.efficiencyScore).slice(0, 3),
    [metrics]
  );

  const activeMetric = useMemo(() => {
    if (selectedAgentId) {
      return metrics.find((m) => m.agent.id === selectedAgentId) ?? metrics[0];
    }
    return bestEfficiency[0] ?? metrics[0];
  }, [selectedAgentId, metrics, bestEfficiency]);

  return (
    <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5 space-y-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-2.5">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-[#FF9B45]" />
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wider text-[#E6F2ED]">
              <span>BẢN ĐỒ NHIỆT HIỆU SUẤT (PERFORMANCE HEATMAP)</span>
              <span className="rounded border border-[#39DEA2]/60 bg-[#39DEA2]/10 px-1.5 py-0.5 font-mono-tabular text-[10px] font-bold text-[#39DEA2]">
                {sweetSpotAgents.length} AGENT LÃI CAO · RỦI RO THẤP
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-[#8FA9A0]">
              Ma trận phân bổ 10 Agent theo trục Lãi/Lỗ thực tế (PnL) và Mức độ Rủi ro Biến động (Volatility Risk 0–100).
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
          <button
            type="button"
            onClick={() => setOnlySweetSpot((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
              onlySweetSpot
                ? 'border-[#39DEA2] bg-[#39DEA2]/20 text-[#39DEA2]'
                : 'border-[#145B4B] bg-[#031713] text-[#8FA9A0] hover:border-[#43D7B1] hover:text-[#E6F2ED]'
            }`}
          >
            <Target className="h-3.5 w-3.5" />
            {onlySweetSpot ? 'Đang lọc: Vùng Lãi cao · Rủi ro thấp' : 'Chỉ hiện Vùng Vàng (Low Risk · High PnL)'}
          </button>
        </div>
      </div>

      {/* Main 12-Col Grid: 5x5 Matrix + Inspector */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
        {/* Left: 5x5 Color-Coded Matrix */}
        <div className="lg:col-span-8 space-y-2">
          <div className="overflow-x-auto rounded-xl border border-[#145B4B]/70 bg-[#031713] p-3">
            <div className="min-w-[620px]">
              {/* Column Headers (Volatility Risk) */}
              <div className="grid grid-cols-[120px_repeat(5,minmax(0,1fr))] gap-1.5 pb-2">
                <div className="flex flex-col justify-end text-[10px] font-mono-tabular text-[#8FA9A0] pr-2">
                  <span className="text-[#39DEA2] font-bold">↑ LÃI / LỖ (PnL)</span>
                  <span>RỦI RO →</span>
                </div>
                {RISK_COLS.map((col, idx) => (
                  <div
                    key={col.label}
                    className={`rounded-md border px-2 py-1 text-center font-mono-tabular ${
                      idx <= 1
                        ? 'border-[#39DEA2]/40 bg-[#39DEA2]/10 text-[#39DEA2]'
                        : idx === 2
                        ? 'border-[#EAC64D]/35 bg-[#EAC64D]/8 text-[#EAC64D]'
                        : 'border-[#EF6682]/35 bg-[#EF6682]/8 text-[#EF6682]'
                    }`}
                  >
                    <div className="text-[11px] font-bold">{col.label}</div>
                    <div className="text-[9px] opacity-80">Risk {col.sub}</div>
                  </div>
                ))}
              </div>

              {/* Matrix Rows */}
              <div className="space-y-1.5">
                {PNL_ROWS.map((row, rowIdx) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[120px_repeat(5,minmax(0,1fr))] gap-1.5 items-stretch"
                  >
                    {/* Y-Axis Label */}
                    <div className="flex flex-col justify-center rounded-md border border-[#145B4B]/50 bg-[#06231F] px-2.5 py-2 font-mono-tabular">
                      <span
                        className={`text-[11px] font-bold ${
                          rowIdx <= 1
                            ? 'text-[#39DEA2]'
                            : rowIdx === 2
                            ? 'text-[#E6F2ED]'
                            : 'text-[#EF6682]'
                        }`}
                      >
                        {row.label}
                      </span>
                      <span className="text-[9px] text-[#8FA9A0]">{row.sub}</span>
                    </div>

                    {/* 5 Risk Cells */}
                    {RISK_COLS.map((col, colIdx) => {
                      const cellAgents = visibleMetrics.filter(
                        (m) => m.pnlRowIdx === rowIdx && m.riskColIdx === colIdx
                      );
                      const isIdealZone = rowIdx <= 1 && colIdx <= 1;

                      return (
                        <div
                          key={`${row.label}-${col.label}`}
                          className={`relative min-h-[66px] rounded-lg border p-1.5 transition-all flex flex-col justify-between ${getCellHeatStyle(
                            rowIdx,
                            colIdx,
                            cellAgents.length
                          )}`}
                        >
                          {isIdealZone && rowIdx === 0 && colIdx === 0 && (
                            <span className="mb-1 inline-flex items-center gap-0.5 text-[9px] font-mono-tabular font-bold text-[#39DEA2]">
                              <Sparkles className="h-2.5 w-2.5" />
                              TỐI ƯU
                            </span>
                          )}

                          <div className="flex flex-wrap gap-1">
                            {cellAgents.map((item) => {
                              const isSelected = activeMetric?.agent.id === item.agent.id;
                              return (
                                <button
                                  key={item.agent.id}
                                  type="button"
                                  onClick={() => setSelectedAgentId(item.agent.id)}
                                  onMouseEnter={() => setSelectedAgentId(item.agent.id)}
                                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono-tabular text-[10px] font-bold transition-transform hover:scale-105 cursor-pointer ${
                                    isSelected
                                      ? 'border-[#E6F2ED] bg-[#031713] text-[#E6F2ED] ring-1 ring-[#43D7B1]'
                                      : 'border-[#145B4B] bg-[#06231F]/95 text-[#E6F2ED]'
                                  }`}
                                  title={`${item.agent.name} · PnL: ${
                                    item.pnlUsd >= 0 ? '+' : '-'
                                  }$${Math.abs(item.pnlUsd).toFixed(2)} · Risk: ${item.volatilityRisk}/100`}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: item.agent.color }}
                                  />
                                  <span>{item.shortCode}</span>
                                  <span
                                    className={
                                      item.pnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'
                                    }
                                  >
                                    {item.pnlUsd >= 0 ? '+' : '-'}$
                                    {Math.abs(item.pnlUsd).toFixed(1)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          {cellAgents.length === 0 && (
                            <span className="self-end font-mono-tabular text-[9px] text-[#8FA9A0]/30">
                              —
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Color Scale Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 font-mono-tabular text-[10px] text-[#8FA9A0]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded border border-[#39DEA2] bg-[#39DEA2]/30" />
                Lãi cao · Rủi ro thấp (Mục tiêu)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded border border-[#EAC64D] bg-[#EAC64D]/25" />
                Cân bằng / Trung tính
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded border border-[#EF6682] bg-[#EF6682]/30" />
                Lỗ / Biến động rủi ro cao
              </span>
            </div>
            <span>Bấm hoặc di chuột vào thẻ Agent để xem chi tiết</span>
          </div>
        </div>

        {/* Right: Selected Agent Inspector & Top Efficiency Ranking */}
        <div className="lg:col-span-4 space-y-3">
          {activeMetric && (
            <div className="rounded-xl border border-[#145B4B] bg-[#031713] p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-2 border-b border-[#145B4B]/60 pb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: activeMetric.agent.color }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#E6F2ED] truncate">
                      {activeMetric.agent.name}
                    </div>
                    <div className="font-mono-tabular text-[10px] text-[#8FA9A0] truncate">
                      {activeMetric.agent.viName}
                    </div>
                  </div>
                </div>
                <span
                  className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-bold shrink-0 ${
                    activeMetric.isSweetSpot
                      ? 'border-[#39DEA2]/60 bg-[#39DEA2]/15 text-[#39DEA2]'
                      : activeMetric.volatilityRisk > 60
                      ? 'border-[#EF6682]/60 bg-[#EF6682]/15 text-[#EF6682]'
                      : 'border-[#EAC64D]/60 bg-[#EAC64D]/15 text-[#EAC64D]'
                  }`}
                >
                  {activeMetric.isSweetSpot
                    ? 'TỐI ƯU'
                    : activeMetric.volatilityRisk > 60
                    ? 'RỦI RO CAO'
                    : 'THEO DÕI'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono-tabular text-xs">
                <div className="rounded-lg border border-[#145B4B]/60 bg-[#06231F] p-2.5">
                  <div className="text-[10px] text-[#8FA9A0]">Lãi / Lỗ (PnL)</div>
                  <div
                    className={`mt-0.5 text-base font-bold ${
                      activeMetric.pnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'
                    }`}
                  >
                    {activeMetric.pnlUsd >= 0 ? '+' : '-'}$
                    {Math.abs(activeMetric.pnlUsd).toFixed(2)}
                  </div>
                </div>

                <div className="rounded-lg border border-[#145B4B]/60 bg-[#06231F] p-2.5">
                  <div className="text-[10px] text-[#8FA9A0]">Rủi ro Biến động</div>
                  <div
                    className={`mt-0.5 text-base font-bold ${
                      activeMetric.volatilityRisk <= 40
                        ? 'text-[#39DEA2]'
                        : activeMetric.volatilityRisk <= 60
                        ? 'text-[#EAC64D]'
                        : 'text-[#EF6682]'
                    }`}
                  >
                    {activeMetric.volatilityRisk} / 100
                  </div>
                </div>

                <div className="rounded-lg border border-[#145B4B]/60 bg-[#06231F] p-2.5">
                  <div className="text-[10px] text-[#8FA9A0]">Tỷ lệ thắng · Số lệnh</div>
                  <div className="mt-0.5 font-semibold text-[#E6F2ED]">
                    {activeMetric.winRatePct}% · {activeMetric.totalTrades} lệnh
                  </div>
                </div>

                <div className="rounded-lg border border-[#145B4B]/60 bg-[#06231F] p-2.5">
                  <div className="text-[10px] text-[#8FA9A0]">Drawdown · Cảnh báo</div>
                  <div className="mt-0.5 font-semibold text-[#EAC64D]">
                    -{activeMetric.drawdownPct}% · {activeMetric.triggeredAlerts} alert
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Top 3 Low-Risk / High-PnL Agents */}
          <div className="rounded-xl border border-[#145B4B] bg-[#031713] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#E6F2ED]">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[#39DEA2]" />
                TOP HIỆU SUẤT / RỦI RO TỐI ƯU
              </span>
              <span className="font-mono-tabular text-[10px] text-[#8FA9A0]">PnL ÷ Risk</span>
            </div>

            <div className="space-y-1.5">
              {bestEfficiency.map((item, idx) => (
                <button
                  key={item.agent.id}
                  type="button"
                  onClick={() => setSelectedAgentId(item.agent.id)}
                  className={`w-full flex items-center justify-between rounded-lg border px-2.5 py-2 text-left font-mono-tabular text-xs transition-colors cursor-pointer ${
                    activeMetric?.agent.id === item.agent.id
                      ? 'border-[#43D7B1] bg-[#092D27]'
                      : 'border-[#145B4B]/60 bg-[#06231F] hover:border-[#43D7B1]/60'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-bold text-[#EAC64D]">#{idx + 1}</span>
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.agent.color }}
                    />
                    <span className="font-semibold text-[#E6F2ED] truncate">
                      {item.agent.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px]">
                    <span className={item.pnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'}>
                      {item.pnlUsd >= 0 ? '+' : '-'}${Math.abs(item.pnlUsd).toFixed(2)}
                    </span>
                    <span className="text-[#8FA9A0]">·</span>
                    <span className="text-[#43D7B1]">R:{item.volatilityRisk}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
