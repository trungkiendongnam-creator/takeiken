import React, { useMemo } from 'react';
import { Activity, BarChart3, CheckCircle2, Percent, XCircle } from 'lucide-react';
import type {
  AgentId,
  PaperTradeRecord,
  TerminalSnapshot,
} from '../types/terminal';

interface DailyTradingSummaryCardProps {
  snapshot: TerminalSnapshot;
}

function isSameLocalDay(isoDate: string | null | undefined, refDate: Date): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === refDate.getFullYear() &&
    d.getMonth() === refDate.getMonth() &&
    d.getDate() === refDate.getDate()
  );
}

export const DailyTradingSummaryCard: React.FC<DailyTradingSummaryCardProps> = ({
  snapshot,
}) => {
  const summary = useMemo(() => {
    const now = new Date();
    const allTrades = snapshot.trades;
    const todayTrades = allTrades.filter(
      (t) => isSameLocalDay(t.openedAt, now) || isSameLocalDay(t.closedAt, now)
    );
    const activeSet = todayTrades.length > 0 ? todayTrades : allTrades;
    const isTodayScoped = todayTrades.length > 0 || allTrades.length === 0;

    let totalVolumeUsd = 0;
    let totalAllocatedUsd = 0;
    let successfulTrades = 0;
    let failedTrades = 0;
    let openTrades = 0;
    let netPnlUsd = 0;

    for (const tr of activeSet) {
      totalAllocatedUsd += tr.equityAllocatedUsd;
      if (tr.status === 'CLOSED') {
        const exitValue = Math.max(0, tr.equityAllocatedUsd + tr.pnlUsd);
        totalVolumeUsd += tr.equityAllocatedUsd + exitValue;
        netPnlUsd += tr.pnlUsd;
        if (tr.pnlUsd > 0) {
          successfulTrades += 1;
        } else {
          failedTrades += 1;
        }
      } else {
        totalVolumeUsd += tr.equityAllocatedUsd;
        openTrades += 1;
      }
    }

    const closedCount = successfulTrades + failedTrades;
    const winRatePct = closedCount > 0 ? Math.round((successfulTrades / closedCount) * 100) : 0;

    // Compute average ROI across all 10 agents using consistent per-agent trade attribution
    const closedSet = activeSet.filter((t) => t.status === 'CLOSED');
    const tokenMap = new Map(snapshot.tokens.map((t) => [t.mintAddress, t]));
    const loggedMints = new Set(
      snapshot.logs.filter((l) => l.mintAddress).map((l) => l.mintAddress as string)
    );

    const agentRois = snapshot.agents.map((agent) => {
      let matched: PaperTradeRecord[] = [];
      switch (agent.id as AgentId) {
        case 'profit_taker':
          matched = closedSet.filter((t) => t.pnlUsd > 0);
          break;
        case 'stop_guard':
          matched = closedSet.filter((t) => t.pnlUsd <= 0);
          break;
        case 'sniper':
          matched = closedSet;
          break;
        case 'risk_sizer':
          matched = closedSet.filter((t) => t.equityPct > 0);
          break;
        case 'journal':
          matched = closedSet.filter((t) => loggedMints.has(t.mintAddress) || t.status === 'CLOSED');
          break;
        case 'lp_auditor':
          matched = closedSet.filter((t) => t.liquidityUsd >= 30000);
          break;
        case 'holder_map':
          matched = closedSet.filter((t) => t.holdersCount >= 500);
          break;
        case 'whale_watch':
          matched = closedSet.filter((t) => {
            const tok = tokenMap.get(t.mintAddress);
            return (
              (tok && tok.whaleInflowUsd > 15000) ||
              t.reason.toLowerCase().includes('whale') ||
              t.reason.toLowerCase().includes('flow')
            );
          });
          break;
        case 'sentiment':
          matched = closedSet.filter((t) => {
            const tok = tokenMap.get(t.mintAddress);
            return (
              (tok && tok.priceChange1h >= 30) ||
              t.reason.toLowerCase().includes('momentum') ||
              t.reason.toLowerCase().includes('flow')
            );
          });
          break;
        case 'launch_radar':
          matched = closedSet.filter((t) => t.bondingCurvePct >= 80);
          break;
      }

      const allocated = matched.reduce((s, t) => s + t.equityAllocatedUsd, 0);
      const pnl = matched.reduce((s, t) => s + t.pnlUsd, 0);
      const roiPct = allocated > 0 ? (pnl / allocated) * 100 : 0;
      return {
        agentId: agent.id,
        roiPct,
        hasTrades: matched.length > 0,
        isPositive: pnl > 0,
      };
    });

    const totalAgentCount = Math.max(1, snapshot.agents.length);
    const avgAgentRoiPct =
      agentRois.reduce((sum, item) => sum + item.roiPct, 0) / totalAgentCount;
    const activePositiveAgents = agentRois.filter((item) => item.hasTrades && item.isPositive).length;

    return {
      isTodayScoped,
      tradeCount: activeSet.length,
      totalVolumeUsd: Number(totalVolumeUsd.toFixed(2)),
      totalAllocatedUsd: Number(totalAllocatedUsd.toFixed(2)),
      successfulTrades,
      failedTrades,
      openTrades,
      closedCount,
      winRatePct,
      netPnlUsd: Number(netPnlUsd.toFixed(2)),
      avgAgentRoiPct: Number(avgAgentRoiPct.toFixed(1)),
      activePositiveAgents,
      totalAgentCount,
    };
  }, [snapshot.trades, snapshot.agents, snapshot.tokens, snapshot.logs]);

  const dateLabel = new Date().toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5 space-y-3">
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#145B4B]/60 pb-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#43D7B1]" />
          <span className="text-xs font-bold tracking-wider text-[#E6F2ED]">
            TỔNG KẾT GIAO DỊCH TRONG NGÀY (DAILY TRADING SUMMARY)
          </span>
          <span className="rounded border border-[#145B4B] bg-[#031713] px-2 py-0.5 font-mono-tabular text-[10px] text-[#43D7B1]">
            {summary.isTodayScoped ? `Hôm nay · ${dateLabel}` : `Phiên gần nhất · ${dateLabel}`}
          </span>
        </div>

        <div className="font-mono-tabular text-[11px] text-[#8FA9A0]">
          Lãi/Lỗ ròng:{' '}
          <strong className={summary.netPnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'}>
            {summary.netPnlUsd >= 0 ? '+' : '-'}${Math.abs(summary.netPnlUsd).toFixed(2)}
          </strong>
          {summary.openTrades > 0 && (
            <span className="ml-2 text-[#EAC64D]">· {summary.openTrades} lệnh đang mở</span>
          )}
        </div>
      </div>

      {/* 3 High-Level KPI Pillars */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 font-mono-tabular">
        {/* 1. Day's Total Volume */}
        <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-[#8FA9A0]">
            <span>TỔNG KHỐI LƯỢNG GIAO DỊCH</span>
            <Activity className="h-3.5 w-3.5 text-[#49A9ED]" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-[#E6F2ED]">
              ${summary.totalVolumeUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#49A9ED]">{summary.tradeCount} lệnh</span>
          </div>
          <div className="mt-1.5 text-[10px] text-[#8FA9A0]">
            Vốn phân bổ vào lệnh: <strong className="text-[#E6F2ED]">${summary.totalAllocatedUsd.toFixed(2)}</strong>
          </div>
        </div>

        {/* 2. Successful vs Failed Trades */}
        <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-[#8FA9A0]">
            <span>LỆNH THÀNH CÔNG VS THẤT BẠI</span>
            <span className="font-bold text-[#43D7B1]">Win Rate {summary.winRatePct}%</span>
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-[#39DEA2]" />
              <span className="text-xl font-bold text-[#39DEA2]">{summary.successfulTrades}</span>
              <span className="text-[11px] text-[#8FA9A0]">Thành công</span>
            </div>
            <span className="text-[#145B4B]">/</span>
            <div className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-[#EF6682]" />
              <span className="text-xl font-bold text-[#EF6682]">{summary.failedTrades}</span>
              <span className="text-[11px] text-[#8FA9A0]">Thất bại</span>
            </div>
          </div>

          {/* Win/Loss Ratio Bar */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#06231F] border border-[#145B4B]/50 flex">
            {summary.closedCount > 0 ? (
              <>
                <div
                  className="h-full bg-[#39DEA2] transition-all duration-300"
                  style={{ width: `${summary.winRatePct}%` }}
                />
                <div
                  className="h-full bg-[#EF6682] transition-all duration-300"
                  style={{ width: `${100 - summary.winRatePct}%` }}
                />
              </>
            ) : (
              <div className="h-full w-full bg-[#145B4B]/40" />
            )}
          </div>
        </div>

        {/* 3. Average ROI of 10 Agents */}
        <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-[#8FA9A0]">
            <span>ROI TRUNG BÌNH (10 AGENT)</span>
            <Percent className="h-3.5 w-3.5 text-[#EAC64D]" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl font-bold ${
                summary.avgAgentRoiPct > 0
                  ? 'text-[#39DEA2]'
                  : summary.avgAgentRoiPct < 0
                  ? 'text-[#EF6682]'
                  : 'text-[#E6F2ED]'
              }`}
            >
              {summary.avgAgentRoiPct >= 0 ? '+' : ''}
              {summary.avgAgentRoiPct}%
            </span>
            <span className="text-[11px] text-[#EAC64D]">
              {summary.activePositiveAgents}/{summary.totalAgentCount} Agent lãi
            </span>
          </div>
          <div className="mt-1.5 text-[10px] text-[#8FA9A0]">
            Tính trên tỷ suất lợi nhuận trung bình của {summary.totalAgentCount} Agent mô phỏng
          </div>
        </div>
      </div>
    </section>
  );
};
