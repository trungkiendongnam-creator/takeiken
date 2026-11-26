import React, { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { PaperTradeRecord } from '../types/terminal';

interface TradeHistoryChartProps {
  trades: PaperTradeRecord[];
  startBalanceUsd: number;
}

type ChartMode = 'combined' | 'cumulative' | 'multiplier';
type OutcomeFilter = 'ALL' | 'PROFIT_TAKER' | 'STOP_GUARD';

interface TradeHistoryPoint {
  index: number;
  timeLabel: string;
  fullTime: string;
  symbol: string;
  agentLabel: string;
  tradePnlUsd: number;
  cumulativePnlUsd: number;
  equityUsd: number;
  multiplier: number;
  exitReason: string;
  isWin: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TradeHistoryPoint }>;
}

const DarkNeonTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="rounded-lg border border-[#43D7B1]/60 bg-[#041A16]/95 p-3 shadow-xl font-mono-tabular text-xs space-y-1.5 min-w-[220px]">
      <div className="flex items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-1.5">
        <span className="font-bold text-[#E6F2ED]">{pt.symbol}</span>
        <span
          className={`text-[10px] font-semibold ${
            pt.isWin ? 'text-[#39DEA2]' : 'text-[#EF6682]'
          }`}
        >
          {pt.agentLabel}
        </span>
      </div>

      <div className="flex justify-between gap-4">
        <span className="text-[#8FA9A0]">Thời gian</span>
        <span className="text-[#E6F2ED]">{pt.fullTime}</span>
      </div>

      <div className="flex justify-between gap-4">
        <span className="text-[#8FA9A0]">Lãi/Lỗ lệnh (mô phỏng)</span>
        <span className={pt.tradePnlUsd >= 0 ? 'text-[#39DEA2] font-semibold' : 'text-[#EF6682] font-semibold'}>
          {pt.tradePnlUsd >= 0 ? '+' : '-'}${Math.abs(pt.tradePnlUsd).toFixed(2)} ({pt.multiplier.toFixed(2)}×)
        </span>
      </div>

      <div className="flex justify-between gap-4">
        <span className="text-[#8FA9A0]">Lãi/Lỗ lũy kế</span>
        <span className={pt.cumulativePnlUsd >= 0 ? 'text-[#43D7B1] font-semibold' : 'text-[#EF6682] font-semibold'}>
          {pt.cumulativePnlUsd >= 0 ? '+' : '-'}${Math.abs(pt.cumulativePnlUsd).toFixed(2)}
        </span>
      </div>

      <div className="flex justify-between gap-4">
        <span className="text-[#8FA9A0]">Vốn Paper</span>
        <span className="text-[#EAC64D]">${pt.equityUsd.toFixed(2)}</span>
      </div>

      <div className="pt-1 border-t border-[#145B4B]/40 text-[10px] text-[#8FA9A0] max-w-[240px] truncate">
        {pt.exitReason}
      </div>
    </div>
  );
};

export const TradeHistoryChart: React.FC<TradeHistoryChartProps> = ({
  trades,
  startBalanceUsd,
}) => {
  const [mode, setMode] = useState<ChartMode>('combined');
  const [filter, setFilter] = useState<OutcomeFilter>('ALL');

  const chartData = useMemo<TradeHistoryPoint[]>(() => {
    const closedChronological = [...trades]
      .filter((t) => t.status === 'CLOSED')
      .sort((a, b) => {
        const ta = new Date(a.closedAt ?? a.openedAt).getTime();
        const tb = new Date(b.closedAt ?? b.openedAt).getTime();
        return ta - tb;
      });

    let runningPnl = 0;
    const allPoints = closedChronological.map((t, idx) => {
      runningPnl = Number((runningPnl + t.pnlUsd).toFixed(2));
      const iso = t.closedAt ?? t.openedAt;
      const timeLabel = iso.slice(11, 16);
      const fullTime = iso.replace('T', ' ').slice(0, 19);
      const isWin = t.pnlUsd > 0;

      return {
        index: idx + 1,
        timeLabel: `${timeLabel} ${t.symbol}`,
        fullTime,
        symbol: t.symbol,
        agentLabel: isWin ? 'PROFIT TAKER' : 'STOP GUARD',
        tradePnlUsd: Number(t.pnlUsd.toFixed(2)),
        cumulativePnlUsd: runningPnl,
        equityUsd: Number((startBalanceUsd + runningPnl).toFixed(2)),
        multiplier: Number(t.multiplier.toFixed(2)),
        exitReason: t.exitReason ?? t.reason,
        isWin,
      };
    });

    if (filter === 'PROFIT_TAKER') {
      return allPoints.filter((p) => p.isWin);
    }
    if (filter === 'STOP_GUARD') {
      return allPoints.filter((p) => !p.isWin);
    }
    return allPoints;
  }, [trades, startBalanceUsd, filter]);

  const totalRealizedPnl = useMemo(() => {
    return chartData.reduce((acc, item) => acc + item.tradePnlUsd, 0);
  }, [chartData]);

  return (
    <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
          <BarChart3 className="h-3.5 w-3.5 text-[#43D7B1]" />
          <span className="text-[#E6F2ED]">LỊCH SỬ GIAO DỊCH</span>
          <span>·</span>
          <span className="font-mono-tabular text-[11px] text-[#43D7B1]">
            DIỄN BIẾN LÃI/LỖ MÔ PHỎNG ({chartData.length} lệnh)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Agent Outcome Filter */}
          <div className="flex items-center gap-1 rounded-md border border-[#145B4B] bg-[#031713] p-0.5 font-mono-tabular text-[11px]">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                filter === 'ALL'
                  ? 'bg-[#092D27] text-[#E6F2ED]'
                  : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              Tất cả Agent
            </button>
            <button
              type="button"
              onClick={() => setFilter('PROFIT_TAKER')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                filter === 'PROFIT_TAKER'
                  ? 'bg-[#39DEA2]/15 text-[#39DEA2]'
                  : 'text-[#8FA9A0] hover:text-[#39DEA2]'
              }`}
            >
              Profit Taker (Chốt lời)
            </button>
            <button
              type="button"
              onClick={() => setFilter('STOP_GUARD')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                filter === 'STOP_GUARD'
                  ? 'bg-[#EF6682]/15 text-[#EF6682]'
                  : 'text-[#8FA9A0] hover:text-[#EF6682]'
              }`}
            >
              Stop Guard (Cắt lỗ)
            </button>
          </div>

          {/* Series Display Mode */}
          <div className="flex items-center gap-1 rounded-md border border-[#145B4B] bg-[#031713] p-0.5 font-mono-tabular text-[11px]">
            <button
              type="button"
              onClick={() => setMode('combined')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'combined'
                  ? 'bg-[#092D27] text-[#43D7B1]'
                  : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              Lãi/Lỗ + Lệnh
            </button>
            <button
              type="button"
              onClick={() => setMode('cumulative')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'cumulative'
                  ? 'bg-[#092D27] text-[#43D7B1]'
                  : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              Lũy kế
            </button>
            <button
              type="button"
              onClick={() => setMode('multiplier')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'multiplier'
                  ? 'bg-[#092D27] text-[#EAC64D]'
                  : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              Hệ số (×)
            </button>
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 font-mono-tabular text-[11px] text-[#8FA9A0]">
        <div className="flex flex-wrap items-center gap-4">
          <span>
            Tổng Lãi/Lỗ đang lọc:{' '}
            <strong className={totalRealizedPnl >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'}>
              {totalRealizedPnl >= 0 ? '+' : '-'}${Math.abs(totalRealizedPnl).toFixed(2)}
            </strong>
          </span>
          <span>
            <span className="text-[#39DEA2]">■</span> Profit Taker (Dương)
          </span>
          <span>
            <span className="text-[#EF6682]">■</span> Stop Guard (Cắt lỗ)
          </span>
        </div>
        <span>Nguồn: SQLite PaperTrades</span>
      </div>

      {/* Recharts Container */}
      <div className="mt-2.5 h-60 w-full rounded-lg border border-[#145B4B]/60 bg-[#031713] p-2">
        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono-tabular text-xs text-[#8FA9A0]">
            Chưa có lệnh Paper Trade đã đóng phù hợp bộ lọc. Hãy thực hiện MUA/BÁN mô phỏng ở mục Chi tiết lệnh.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 14, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="tradeHistoryPnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#43D7B1" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#43D7B1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#145B4B" strokeDasharray="3 3" opacity={0.35} vertical={false} />
              <XAxis
                dataKey="timeLabel"
                stroke="#8FA9A0"
                tick={{ fill: '#8FA9A0', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#145B4B' }}
              />
              <YAxis
                stroke="#8FA9A0"
                tick={{ fill: '#8FA9A0', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#145B4B' }}
                tickFormatter={(val: number) =>
                  mode === 'multiplier' ? `${val.toFixed(1)}×` : `$${val}`
                }
                width={52}
              />
              <Tooltip content={<DarkNeonTooltip />} cursor={{ fill: '#092D27', opacity: 0.45 }} />
              <ReferenceLine
                y={mode === 'multiplier' ? 1 : 0}
                stroke="#145B4B"
                strokeDasharray="4 4"
              />

              {mode !== 'multiplier' && (
                <Area
                  type="monotone"
                  dataKey="cumulativePnlUsd"
                  name="Lãi/Lỗ lũy kế"
                  stroke="#43D7B1"
                  strokeWidth={2.2}
                  fill="url(#tradeHistoryPnlGrad)"
                  dot={{ r: 3.5, fill: '#43D7B1', stroke: '#031713', strokeWidth: 1.5 }}
                  activeDot={{ r: 5, fill: '#39DEA2', stroke: '#E6F2ED', strokeWidth: 1.5 }}
                />
              )}

              {mode === 'combined' && (
                <Bar dataKey="tradePnlUsd" name="Lãi/Lỗ từng lệnh" barSize={20} radius={[3, 3, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      key={`cell-${entry.index}`}
                      fill={entry.isWin ? '#39DEA2' : '#EF6682'}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              )}

              {mode === 'multiplier' && (
                <Bar dataKey="multiplier" name="Hệ số (×)" barSize={24} radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      key={`mult-${entry.index}`}
                      fill={entry.isWin ? '#EAC64D' : '#EF6682'}
                      fillOpacity={0.9}
                    />
                  ))}
                </Bar>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
};
