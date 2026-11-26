import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownUp,
  Clock,
  Filter,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  AgentId,
  AgentRecord,
  PaperTradeRecord,
  SystemLogEntry,
} from '../types/terminal';

interface TradeActivityLogProps {
  trades: PaperTradeRecord[];
  agents: AgentRecord[];
  logs: SystemLogEntry[];
  isRunning: boolean;
  onSelectMint?: (mintAddress: string) => void;
}

type OutcomeFilter = 'ALL' | 'PROFIT' | 'LOSS' | 'OPEN';
type OrderMode = 'NEWEST' | 'CHRONOLOGICAL';

interface ActivityEvent {
  eventKey: string;
  tradeId: number;
  mintAddress: string;
  symbol: string;
  actionType: 'OPEN' | 'CLOSE' | 'FILTERED';
  timestampIso: string;
  timestampMs: number;
  agentId: AgentId;
  agentName: string;
  agentColor: string;
  priceUsd: number;
  equityAllocatedUsd: number;
  equityPct: number;
  multiplier: number;
  pnlUsd: number | null;
  status: PaperTradeRecord['status'];
  detailNote: string;
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price === 0) return '0.00';
  if (price < 0.0001) return price.toFixed(7).replace(/0+$/, '');
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

export const TradeActivityLog: React.FC<TradeActivityLogProps> = ({
  trades,
  agents,
  logs,
  isRunning,
  onSelectMint,
}) => {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');
  const [orderMode, setOrderMode] = useState<OrderMode>('NEWEST');

  const agentMap = useMemo(() => {
    return new Map(agents.map((a) => [a.id, a]));
  }, [agents]);

  const events = useMemo<ActivityEvent[]>(() => {
    const items: ActivityEvent[] = [];

    const resolveAgent = (id: AgentId) => {
      const found = agentMap.get(id);
      return {
        agentId: id,
        agentName: found?.name ?? id.toUpperCase(),
        agentColor: found?.color ?? '#43D7B1',
      };
    };

    for (const tr of trades) {
      // Find matching log entries if present to attribute exact agent IDs
      const openLog = logs.find(
        (l) =>
          l.mintAddress === tr.mintAddress &&
          l.eventType === 'BUY_SIM' &&
          l.agentId !== 'YOU' &&
          l.agentId !== 'SYSTEM'
      );
      const openAgentId: AgentId =
        openLog && openLog.agentId !== 'YOU' && openLog.agentId !== 'SYSTEM'
          ? openLog.agentId
          : tr.status === 'FILTERED'
          ? 'lp_auditor'
          : 'sniper';
      const openMeta = resolveAgent(openAgentId);

      items.push({
        eventKey: `${tr.id}-open`,
        tradeId: tr.id,
        mintAddress: tr.mintAddress,
        symbol: tr.symbol,
        actionType: tr.status === 'FILTERED' ? 'FILTERED' : 'OPEN',
        timestampIso: tr.openedAt,
        timestampMs: new Date(tr.openedAt).getTime() || 0,
        agentId: openMeta.agentId,
        agentName: openMeta.agentName,
        agentColor: openMeta.agentColor,
        priceUsd: tr.entryPriceSimUsd,
        equityAllocatedUsd: tr.equityAllocatedUsd,
        equityPct: tr.equityPct,
        multiplier: tr.status === 'OPEN' ? tr.multiplier : 1,
        pnlUsd: tr.status === 'OPEN' ? tr.pnlUsd : null,
        status: tr.status,
        detailNote: tr.reason,
      });

      if (tr.status === 'CLOSED' && tr.closedAt) {
        const isStop =
          tr.pnlUsd <= 0 ||
          (tr.exitReason ?? '').toLowerCase().includes('stop') ||
          (tr.exitReason ?? '').toLowerCase().includes('cắt');
        const closeLog = logs.find(
          (l) =>
            l.mintAddress === tr.mintAddress &&
            (l.eventType === 'SELL_SIM' || l.eventType === 'STOP_SIM') &&
            l.agentId !== 'YOU' &&
            l.agentId !== 'SYSTEM'
        );
        const closeAgentId: AgentId =
          closeLog && closeLog.agentId !== 'YOU' && closeLog.agentId !== 'SYSTEM'
            ? closeLog.agentId
            : isStop
            ? 'stop_guard'
            : 'profit_taker';
        const closeMeta = resolveAgent(closeAgentId);

        items.push({
          eventKey: `${tr.id}-close`,
          tradeId: tr.id,
          mintAddress: tr.mintAddress,
          symbol: tr.symbol,
          actionType: 'CLOSE',
          timestampIso: tr.closedAt,
          timestampMs: new Date(tr.closedAt).getTime() || 0,
          agentId: closeMeta.agentId,
          agentName: closeMeta.agentName,
          agentColor: closeMeta.agentColor,
          priceUsd: tr.exitPriceSimUsd ?? tr.referencePriceUsd,
          equityAllocatedUsd: tr.equityAllocatedUsd,
          equityPct: tr.equityPct,
          multiplier: tr.multiplier,
          pnlUsd: tr.pnlUsd,
          status: tr.status,
          detailNote: tr.exitReason ?? 'Đóng vị thế mô phỏng',
        });
      }
    }

    const filtered = items.filter((ev) => {
      if (agentFilter !== 'ALL' && ev.agentId !== agentFilter) return false;
      if (outcomeFilter === 'PROFIT') {
        return ev.actionType === 'CLOSE' && (ev.pnlUsd ?? 0) > 0;
      }
      if (outcomeFilter === 'LOSS') {
        return ev.actionType === 'CLOSE' && (ev.pnlUsd ?? 0) <= 0;
      }
      if (outcomeFilter === 'OPEN') {
        return ev.status === 'OPEN';
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const diff = a.timestampMs - b.timestampMs;
      if (diff !== 0) {
        return orderMode === 'CHRONOLOGICAL' ? diff : -diff;
      }
      return orderMode === 'CHRONOLOGICAL' ? a.tradeId - b.tradeId : b.tradeId - a.tradeId;
    });
  }, [trades, logs, agentMap, outcomeFilter, agentFilter, orderMode]);

  const summary = useMemo(() => {
    const closed = trades.filter((t) => t.status === 'CLOSED');
    const netPnl = closed.reduce((acc, t) => acc + t.pnlUsd, 0);
    const profits = closed.filter((t) => t.pnlUsd > 0).length;
    const losses = closed.filter((t) => t.pnlUsd <= 0).length;
    return {
      totalEvents: events.length,
      netPnl: Number(netPnl.toFixed(2)),
      profits,
      losses,
    };
  }, [trades, events.length]);

  return (
    <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
      {/* Header + Live Feed Status + Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-2.5">
        <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold tracking-wider text-[#8FA9A0]">
          <Activity className="h-3.5 w-3.5 text-[#43D7B1]" />
          <span className="text-[#E6F2ED]">NHẬT KÝ GIAO DỊCH PAPER TRADING (TRADE ACTIVITY LOG)</span>
          <span
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono-tabular text-[10px] ${
              isRunning
                ? 'border-[#39DEA2]/50 bg-[#39DEA2]/10 text-[#39DEA2]'
                : 'border-[#8FA9A0]/40 bg-[#092D27] text-[#8FA9A0]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isRunning ? 'bg-[#39DEA2] animate-pulse' : 'bg-[#8FA9A0]'
              }`}
            />
            {isRunning ? 'LIVE FEED' : 'PAUSED'}
          </span>
          <span className="font-mono-tabular text-[11px] text-[#43D7B1]">
            {summary.totalEvents} giao dịch
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
          {/* Summary Badges */}
          <span
            className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
              summary.netPnl >= 0
                ? 'border-[#39DEA2]/40 bg-[#39DEA2]/10 text-[#39DEA2]'
                : 'border-[#EF6682]/40 bg-[#EF6682]/10 text-[#EF6682]'
            }`}
          >
            Tổng PnL: {summary.netPnl >= 0 ? '+' : '-'}${Math.abs(summary.netPnl).toFixed(2)} (
            {summary.profits}W/{summary.losses}L)
          </span>

          {/* Outcome Filter */}
          <div className="flex items-center gap-1 rounded-md border border-[#145B4B] bg-[#031713] px-2 py-1">
            <Filter className="h-3 w-3 text-[#8FA9A0]" />
            <select
              aria-label="Lọc kết quả giao dịch"
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}
              className="bg-transparent text-[11px] text-[#E6F2ED] focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-[#031713]">
                Tất cả kết quả
              </option>
              <option value="PROFIT" className="bg-[#031713]">
                Chốt lãi (+)
              </option>
              <option value="LOSS" className="bg-[#031713]">
                Cắt lỗ (-)
              </option>
              <option value="OPEN" className="bg-[#031713]">
                Đang mở vị thế
              </option>
            </select>
          </div>

          {/* Agent ID Filter */}
          <select
            aria-label="Lọc theo Agent ID"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded-md border border-[#145B4B] bg-[#031713] px-2 py-1 text-[11px] text-[#E6F2ED] focus:outline-none cursor-pointer"
          >
            <option value="ALL" className="bg-[#031713]">
              Tất cả Agent ID
            </option>
            {agents.map((ag) => (
              <option key={ag.id} value={ag.id} className="bg-[#031713]">
                {ag.id} ({ag.name})
              </option>
            ))}
          </select>

          {/* Chronological Sort Toggle */}
          <button
            type="button"
            onClick={() =>
              setOrderMode((prev) => (prev === 'NEWEST' ? 'CHRONOLOGICAL' : 'NEWEST'))
            }
            className="inline-flex items-center gap-1 rounded-md border border-[#145B4B] bg-[#092D27] px-2 py-1 text-[11px] text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
            title="Chuyển thứ tự thời gian"
          >
            <ArrowDownUp className="h-3 w-3" />
            <span>{orderMode === 'NEWEST' ? 'Mới nhất trước' : 'Cũ → Mới'}</span>
          </button>
        </div>
      </div>

      {/* Chronological Feed Table */}
      <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-[#145B4B]/70 bg-[#031713]">
        {events.length === 0 ? (
          <div className="py-8 text-center font-mono-tabular text-xs text-[#8FA9A0]">
            Chưa có giao dịch mô phỏng nào khớp với bộ lọc hiện tại.
          </div>
        ) : (
          <table className="w-full text-left font-mono-tabular text-xs">
            <thead className="sticky top-0 z-10 border-b border-[#145B4B]/70 bg-[#092D27] text-[10px] text-[#8FA9A0]">
              <tr>
                <th className="px-3 py-2">Thời gian</th>
                <th className="px-3 py-2">Agent ID</th>
                <th className="px-3 py-2">Lệnh / Token</th>
                <th className="px-3 py-2 text-right">Giá khớp (Sim)</th>
                <th className="px-3 py-2 text-right">Vốn phân bổ</th>
                <th className="px-3 py-2">Lý do thực thi</th>
                <th className="px-3 py-2 text-right">Kết quả Lãi/Lỗ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#145B4B]/40">
              {events.map((ev) => {
                const isProfit = ev.pnlUsd !== null && ev.pnlUsd > 0;
                const isLoss = ev.pnlUsd !== null && ev.pnlUsd <= 0;
                return (
                  <tr
                    key={ev.eventKey}
                    onClick={() => onSelectMint?.(ev.mintAddress)}
                    className={`transition-colors hover:bg-[#092D27]/55 ${
                      onSelectMint ? 'cursor-pointer' : ''
                    }`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-[#8FA9A0]">
                      <div className="inline-flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-[#43D7B1]/70" />
                        <span className="text-[#E6F2ED]">{formatTimestamp(ev.timestampIso)}</span>
                        <span className="text-[10px] opacity-70">{formatDateShort(ev.timestampIso)}</span>
                      </div>
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          borderColor: `${ev.agentColor}55`,
                          color: ev.agentColor,
                          backgroundColor: `${ev.agentColor}14`,
                        }}
                      >
                        {ev.agentId}
                      </span>
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            ev.actionType === 'OPEN'
                              ? 'bg-[#EAC64D]/15 text-[#EAC64D]'
                              : ev.actionType === 'FILTERED'
                              ? 'bg-[#8FA9A0]/15 text-[#8FA9A0]'
                              : isProfit
                              ? 'bg-[#39DEA2]/15 text-[#39DEA2]'
                              : 'bg-[#EF6682]/15 text-[#EF6682]'
                          }`}
                        >
                          {ev.actionType === 'OPEN'
                            ? 'MUA SIM'
                            : ev.actionType === 'FILTERED'
                            ? 'ĐÃ LỌC'
                            : isProfit
                            ? 'BÁN SIM'
                            : 'STOP SIM'}
                        </span>
                        <span className="font-bold text-[#E6F2ED]">{ev.symbol}</span>
                      </div>
                    </td>

                    <td className="px-3 py-2 text-right text-[#E6F2ED]">
                      ${formatPrice(ev.priceUsd)}
                    </td>

                    <td className="px-3 py-2 text-right text-[#8FA9A0]">
                      ${ev.equityAllocatedUsd.toFixed(2)}{' '}
                      <span className="text-[10px]">({ev.equityPct}%)</span>
                    </td>

                    <td className="px-3 py-2 max-w-[260px] truncate text-[11px] text-[#8FA9A0]">
                      {ev.detailNote}
                    </td>

                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {ev.actionType === 'OPEN' ? (
                        <span className="rounded border border-[#49A9ED]/40 bg-[#49A9ED]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#49A9ED]">
                          {ev.status === 'OPEN' ? 'ĐANG MỞ' : 'ĐÃ KHỚP VÀO'}
                        </span>
                      ) : ev.actionType === 'FILTERED' ? (
                        <span className="text-[11px] text-[#8FA9A0]">Bị chặn</span>
                      ) : (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {isProfit ? (
                            <TrendingUp className="h-3.5 w-3.5 text-[#39DEA2]" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5 text-[#EF6682]" />
                          )}
                          <span
                            className={`font-bold ${
                              isProfit ? 'text-[#39DEA2]' : isLoss ? 'text-[#EF6682]' : 'text-[#8FA9A0]'
                            }`}
                          >
                            {(ev.pnlUsd ?? 0) >= 0 ? '+' : '-'}$
                            {Math.abs(ev.pnlUsd ?? 0).toFixed(2)}
                          </span>
                          <span className="text-[10px] text-[#8FA9A0]">
                            ({ev.multiplier.toFixed(2)}×)
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
