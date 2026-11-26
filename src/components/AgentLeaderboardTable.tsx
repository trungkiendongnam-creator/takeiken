import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Trophy } from 'lucide-react';
import type {
  AgentId,
  AgentRecord,
  PaperTradeRecord,
  SystemLogEntry,
  TokenFlowItem,
} from '../types/terminal';

interface AgentLeaderboardTableProps {
  agents: AgentRecord[];
  trades: PaperTradeRecord[];
  logs: SystemLogEntry[];
  tokens: TokenFlowItem[];
}

type SortKey = 'pnlPercentile' | 'pnl' | 'totalTrades' | 'drawdown' | 'winRate' | 'name';
type DrawdownFilter = 'ALL' | 'ACTIVE_DD' | 'LOW_DD' | 'HIGH_DD';

interface AgentRankRow {
  agent: AgentRecord;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  currentPnlUsd: number;
  avgPnlUsd: number;
  pnlPercentile: number;
  activeDrawdownPct: number;
  drawdownStatus: 'AN TOÀN' | 'BIẾN ĐỘNG' | 'CẢNH BÁO';
  attributionNote: string;
}

function computeAgentMaxDrawdownPct(closedMatched: PaperTradeRecord[], openExposureUsd: number): number {
  const chronological = [...closedMatched].sort((a, b) => {
    const ta = new Date(a.closedAt ?? a.openedAt).getTime();
    const tb = new Date(b.closedAt ?? b.openedAt).getTime();
    return ta - tb;
  });

  const baseCapital = 50;
  let equity = baseCapital;
  let peak = baseCapital;
  let maxDd = 0;

  for (const tr of chronological) {
    equity = Math.max(1, equity + tr.pnlUsd);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  // Factor in current active drawdown from peak or unrealized open allocation risk
  const currentDd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  const openRiskContribution = openExposureUsd > 0 ? (openExposureUsd / Math.max(1, equity)) * 25 : 0;
  return Number(Math.min(100, Math.max(currentDd, maxDd * 0.65 + openRiskContribution)).toFixed(1));
}

export const AgentLeaderboardTable: React.FC<AgentLeaderboardTableProps> = ({
  agents,
  trades,
  logs,
  tokens,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('pnlPercentile');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [drawdownFilter, setDrawdownFilter] = useState<DrawdownFilter>('ALL');

  const rows = useMemo<AgentRankRow[]>(() => {
    const closedTrades = trades.filter((t) => t.status === 'CLOSED');
    const tokenMap = new Map(tokens.map((t) => [t.mintAddress, t]));

    const baseRows = agents.map((agent) => {
      let matched: PaperTradeRecord[] = [];
      let attributionNote = '';

      switch (agent.id as AgentId) {
        case 'profit_taker':
          matched = closedTrades.filter((t) => t.pnlUsd > 0);
          attributionNote = 'Lệnh chốt lời dương';
          break;
        case 'stop_guard':
          matched = closedTrades.filter((t) => t.pnlUsd <= 0);
          attributionNote = 'Lệnh cắt lỗ / trailing stop';
          break;
        case 'sniper':
          matched = trades;
          attributionNote = 'Toàn bộ lệnh vào mô phỏng';
          break;
        case 'risk_sizer':
          matched = trades.filter((t) => t.equityPct > 0);
          attributionNote = 'Phân bổ quy mô vốn kép';
          break;
        case 'journal': {
          const loggedMints = new Set(
            logs.filter((l) => l.mintAddress).map((l) => l.mintAddress as string)
          );
          matched = closedTrades.filter((t) => loggedMints.has(t.mintAddress) || t.status === 'CLOSED');
          attributionNote = 'Ghi nhận đầy đủ vào SQLite';
          break;
        }
        case 'lp_auditor':
          matched = closedTrades.filter((t) => t.liquidityUsd >= 30000);
          attributionNote = 'Đạt kiểm toán LP & Authority';
          break;
        case 'holder_map':
          matched = closedTrades.filter((t) => t.holdersCount >= 500);
          attributionNote = 'Phân bổ ví nắm giữ an toàn';
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
          attributionNote = 'Có dòng tiền ví lớn công khai';
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
          attributionNote = 'Động lượng tâm lý thị trường';
          break;
        case 'launch_radar':
          matched = closedTrades.filter((t) => t.bondingCurvePct >= 80);
          attributionNote = 'Phát hiện token mới sớm';
          break;
      }

      const closedMatched = matched.filter((t) => t.status === 'CLOSED');
      const openExposureUsd = matched
        .filter((t) => t.status === 'OPEN')
        .reduce((sum, t) => sum + t.equityAllocatedUsd, 0);

      const totalTrades = matched.length;
      const wins = closedMatched.filter((t) => t.pnlUsd > 0).length;
      const losses = closedMatched.filter((t) => t.pnlUsd <= 0).length;
      const winRatePct =
        closedMatched.length > 0 ? Math.round((wins / closedMatched.length) * 100) : 0;
      const currentPnlUsd = Number(
        closedMatched.reduce((sum, t) => sum + t.pnlUsd, 0).toFixed(2)
      );
      const avgPnlUsd =
        closedMatched.length > 0 ? Number((currentPnlUsd / closedMatched.length).toFixed(2)) : 0;

      const activeDrawdownPct = computeAgentMaxDrawdownPct(closedMatched, openExposureUsd);
      const drawdownStatus: AgentRankRow['drawdownStatus'] =
        activeDrawdownPct >= 10
          ? 'CẢNH BÁO'
          : activeDrawdownPct > 2
          ? 'BIẾN ĐỘNG'
          : 'AN TOÀN';

      return {
        agent,
        totalTrades,
        wins,
        losses,
        winRatePct,
        currentPnlUsd,
        avgPnlUsd,
        pnlPercentile: 0,
        activeDrawdownPct,
        drawdownStatus,
        attributionNote,
      };
    });

    // Compute PnL percentile across the 10 agents
    const pnlsSorted = [...baseRows].map((r) => r.currentPnlUsd).sort((a, b) => a - b);
    const denom = Math.max(1, pnlsSorted.length - 1);
    const withPercentile = baseRows.map((r) => {
      const belowCount = pnlsSorted.filter((v) => v < r.currentPnlUsd).length;
      const equalCount = pnlsSorted.filter((v) => v === r.currentPnlUsd).length;
      const rankIdx = belowCount + Math.max(0, equalCount - 1) * 0.5;
      const pnlPercentile = Math.round((rankIdx / denom) * 100);
      return { ...r, pnlPercentile };
    });

    const filtered = withPercentile.filter((r) => {
      if (drawdownFilter === 'ACTIVE_DD') return r.activeDrawdownPct > 0;
      if (drawdownFilter === 'LOW_DD') return r.activeDrawdownPct <= 5;
      if (drawdownFilter === 'HIGH_DD') return r.activeDrawdownPct > 5;
      return true;
    });

    return filtered.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'pnlPercentile') {
        diff = a.pnlPercentile - b.pnlPercentile;
        if (diff === 0) diff = a.currentPnlUsd - b.currentPnlUsd;
      } else if (sortKey === 'pnl') {
        diff = a.currentPnlUsd - b.currentPnlUsd;
        if (diff === 0) diff = a.winRatePct - b.winRatePct;
      } else if (sortKey === 'winRate') {
        diff = a.winRatePct - b.winRatePct;
        if (diff === 0) diff = a.currentPnlUsd - b.currentPnlUsd;
      } else if (sortKey === 'totalTrades') {
        diff = a.totalTrades - b.totalTrades;
        if (diff === 0) diff = a.currentPnlUsd - b.currentPnlUsd;
      } else if (sortKey === 'drawdown') {
        diff = a.activeDrawdownPct - b.activeDrawdownPct;
        if (diff === 0) diff = b.currentPnlUsd - a.currentPnlUsd;
      } else {
        diff = a.agent.name.localeCompare(b.agent.name);
      }
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [agents, trades, logs, tokens, sortKey, sortDir, drawdownFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortDir === 'desc' ? (
      <ArrowDown className="h-3 w-3 text-[#43D7B1]" />
    ) : (
      <ArrowUp className="h-3 w-3 text-[#43D7B1]" />
    );
  };

  return (
    <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
      {/* Header + Filter & Sort Dropdown Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
          <Trophy className="h-3.5 w-3.5 text-[#EAC64D]" />
          <span className="text-[#E6F2ED]">XẾP HẠNG HIỆU SUẤT AGENT</span>
          <span>·</span>
          <span className="font-mono-tabular text-[11px] text-[#43D7B1]">
            {rows.length}/10 AGENT
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
          {/* Active Drawdown Status Filter Dropdown */}
          <div className="flex items-center gap-1.5 rounded-md border border-[#145B4B] bg-[#031713] px-2 py-1">
            <Filter className="h-3 w-3 text-[#8FA9A0]" />
            <select
              aria-label="Lọc theo trạng thái sụt giảm"
              value={drawdownFilter}
              onChange={(e) => setDrawdownFilter(e.target.value as DrawdownFilter)}
              className="bg-transparent text-[11px] text-[#E6F2ED] focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-[#031713]">
                Sụt giảm: Tất cả trạng thái
              </option>
              <option value="ACTIVE_DD" className="bg-[#031713]">
                Đang có sụt giảm (&gt; 0%)
              </option>
              <option value="LOW_DD" className="bg-[#031713]">
                An toàn (Sụt giảm ≤ 5%)
              </option>
              <option value="HIGH_DD" className="bg-[#031713]">
                Rủi ro cao (Sụt giảm &gt; 5%)
              </option>
            </select>
          </div>

          {/* Sort Criteria Dropdown */}
          <div className="flex items-center gap-1.5 rounded-md border border-[#43D7B1]/50 bg-[#031713] px-2 py-1">
            <span className="text-[11px] text-[#8FA9A0]">Sắp xếp:</span>
            <select
              aria-label="Chọn tiêu chí sắp xếp Agent"
              value={sortKey}
              onChange={(e) => {
                const next = e.target.value as SortKey;
                setSortKey(next);
                setSortDir(next === 'name' ? 'asc' : 'desc');
              }}
              className="bg-transparent text-[11px] font-semibold text-[#43D7B1] focus:outline-none cursor-pointer"
            >
              <option value="pnlPercentile" className="bg-[#031713]">
                Phân vị Lãi/Lỗ (PnL Percentile)
              </option>
              <option value="pnl" className="bg-[#031713]">
                Lãi/Lỗ hiện tại ($)
              </option>
              <option value="totalTrades" className="bg-[#031713]">
                Tổng số lệnh
              </option>
              <option value="drawdown" className="bg-[#031713]">
                Trạng thái sụt giảm (Drawdown)
              </option>
              <option value="winRate" className="bg-[#031713]">
                Tỷ lệ thắng (%)
              </option>
              <option value="name" className="bg-[#031713]">
                Tên Agent (A–Z)
              </option>
            </select>
          </div>

          {/* Direction Toggle */}
          <button
            type="button"
            onClick={() => setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            className="inline-flex items-center gap-1 rounded-md border border-[#145B4B] bg-[#092D27] px-2 py-1 text-[11px] text-[#E6F2ED] hover:border-[#43D7B1] cursor-pointer"
            title="Đảo chiều sắp xếp"
          >
            {sortDir === 'desc' ? (
              <>
                <ArrowDown className="h-3 w-3 text-[#43D7B1]" />
                <span>Giảm dần</span>
              </>
            ) : (
              <>
                <ArrowUp className="h-3 w-3 text-[#43D7B1]" />
                <span>Tăng dần</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Responsive Leaderboard Table */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-[#145B4B]/70 bg-[#031713]">
        <table className="w-full text-left font-mono-tabular text-xs">
          <thead className="border-b border-[#145B4B]/70 bg-[#092D27] text-[11px] text-[#8FA9A0]">
            <tr>
              <th className="px-3 py-2.5 w-14">Hạng</th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => handleSort('name')}
                  className="inline-flex items-center gap-1.5 hover:text-[#E6F2ED] cursor-pointer"
                >
                  <span>Agent</span>
                  {renderSortIcon('name')}
                </button>
              </th>
              <th className="px-3 py-2.5">Trạng thái</th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => handleSort('totalTrades')}
                  className="inline-flex items-center justify-end gap-1.5 hover:text-[#E6F2ED] cursor-pointer ml-auto"
                >
                  <span>Tổng lệnh</span>
                  {renderSortIcon('totalTrades')}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">Thắng / Thua</th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => handleSort('winRate')}
                  className="inline-flex items-center justify-end gap-1.5 hover:text-[#E6F2ED] cursor-pointer ml-auto"
                >
                  <span>Tỷ lệ thắng</span>
                  {renderSortIcon('winRate')}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => handleSort('pnlPercentile')}
                  className="inline-flex items-center justify-end gap-1.5 hover:text-[#E6F2ED] cursor-pointer ml-auto"
                >
                  <span>Phân vị PnL</span>
                  {renderSortIcon('pnlPercentile')}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => handleSort('drawdown')}
                  className="inline-flex items-center justify-end gap-1.5 hover:text-[#E6F2ED] cursor-pointer ml-auto"
                >
                  <span>Sụt giảm</span>
                  {renderSortIcon('drawdown')}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => handleSort('pnl')}
                  className="inline-flex items-center justify-end gap-1.5 hover:text-[#E6F2ED] cursor-pointer ml-auto"
                >
                  <span>Lãi/Lỗ hiện tại</span>
                  {renderSortIcon('pnl')}
                </button>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#145B4B]/40">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[#8FA9A0]">
                  Không có Agent nào khớp với bộ lọc sụt giảm đã chọn.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const rank = idx + 1;
                const isLeader = rank === 1 && row.currentPnlUsd > 0;
                return (
                  <tr
                    key={row.agent.id}
                    className={`transition-colors hover:bg-[#092D27]/60 ${
                      isLeader ? 'bg-[#092D27]/35' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex h-5 min-w-6 items-center justify-center rounded px-1.5 text-[11px] font-bold ${
                          rank === 1
                            ? 'bg-[#EAC64D]/20 text-[#EAC64D] border border-[#EAC64D]/50'
                            : rank === 2
                            ? 'bg-[#43D7B1]/15 text-[#43D7B1] border border-[#43D7B1]/40'
                            : rank === 3
                            ? 'bg-[#49A9ED]/15 text-[#49A9ED] border border-[#49A9ED]/40'
                            : 'text-[#8FA9A0]'
                        }`}
                      >
                        #{rank}
                      </span>
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#8FA9A0]">{row.agent.code}</span>
                        <span className="font-bold" style={{ color: row.agent.color }}>
                          {row.agent.name}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#8FA9A0]">{row.attributionNote}</div>
                    </td>

                    <td className="px-3 py-2.5">
                      <span
                        className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          borderColor: `${row.agent.color}55`,
                          color: row.agent.color,
                          backgroundColor: `${row.agent.color}12`,
                        }}
                      >
                        {row.agent.status}
                      </span>
                    </td>

                    <td className="px-3 py-2.5 text-right font-semibold text-[#E6F2ED]">
                      {row.totalTrades}
                    </td>

                    <td className="px-3 py-2.5 text-right text-[#8FA9A0]">
                      <span className="text-[#39DEA2]">{row.wins}T</span> /{' '}
                      <span className="text-[#EF6682]">{row.losses}B</span>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-2 justify-end">
                        <div className="hidden sm:block h-1.5 w-14 overflow-hidden rounded-full bg-[#092D27]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${row.winRatePct}%`,
                              backgroundColor:
                                row.winRatePct >= 60
                                  ? '#39DEA2'
                                  : row.winRatePct >= 40
                                  ? '#EAC64D'
                                  : '#EF6682',
                            }}
                          />
                        </div>
                        <span className="font-semibold text-[#E6F2ED] w-9 text-right">
                          {row.winRatePct}%
                        </span>
                      </div>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                          row.pnlPercentile >= 75
                            ? 'border-[#39DEA2]/50 bg-[#39DEA2]/10 text-[#39DEA2]'
                            : row.pnlPercentile >= 40
                            ? 'border-[#EAC64D]/50 bg-[#EAC64D]/10 text-[#EAC64D]'
                            : 'border-[#145B4B] bg-[#06231F] text-[#8FA9A0]'
                        }`}
                      >
                        P{row.pnlPercentile}
                      </span>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span
                          className={`text-[11px] font-semibold ${
                            row.activeDrawdownPct >= 10
                              ? 'text-[#EF6682]'
                              : row.activeDrawdownPct > 2
                              ? 'text-[#EAC64D]'
                              : 'text-[#39DEA2]'
                          }`}
                        >
                          -{row.activeDrawdownPct}%
                        </span>
                        <span
                          className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                            row.drawdownStatus === 'CẢNH BÁO'
                              ? 'bg-[#EF6682]/15 text-[#EF6682]'
                              : row.drawdownStatus === 'BIẾN ĐỘNG'
                              ? 'bg-[#EAC64D]/15 text-[#EAC64D]'
                              : 'bg-[#39DEA2]/15 text-[#39DEA2]'
                          }`}
                        >
                          {row.drawdownStatus}
                        </span>
                      </div>
                    </td>

                    <td
                      className={`px-3 py-2.5 text-right font-bold ${
                        row.currentPnlUsd > 0
                          ? 'text-[#39DEA2]'
                          : row.currentPnlUsd < 0
                          ? 'text-[#EF6682]'
                          : 'text-[#8FA9A0]'
                      }`}
                    >
                      {row.currentPnlUsd > 0 ? '+' : row.currentPnlUsd < 0 ? '-' : ''}$
                      {Math.abs(row.currentPnlUsd).toFixed(2)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

