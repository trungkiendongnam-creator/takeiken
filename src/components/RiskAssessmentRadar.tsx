import React, { useMemo, useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { ShieldAlert } from 'lucide-react';
import type { AgentId, TerminalSnapshot, TokenFlowItem } from '../types/terminal';

interface RiskAssessmentRadarProps {
  snapshot: TerminalSnapshot;
  selectedToken: TokenFlowItem | undefined;
}

interface AgentRiskPoint {
  agentId: AgentId;
  shortLabel: string;
  fullName: string;
  color: string;
  currentExposure: number;
  sessionCap: number;
  driver: string;
}

interface RadarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: AgentRiskPoint }>;
}

const SHORT_LABELS: Record<AgentId, string> = {
  launch_radar: 'RADAR',
  whale_watch: 'WHALE',
  sentiment: 'SENTIMENT',
  lp_auditor: 'LP AUDIT',
  holder_map: 'HOLDERS',
  risk_sizer: 'SIZER',
  sniper: 'SNIPER',
  profit_taker: 'PROFIT',
  stop_guard: 'STOP',
  journal: 'JOURNAL',
};

const RiskTooltip: React.FC<RadarTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  const tier =
    pt.currentExposure >= 70 ? 'CAO' : pt.currentExposure >= 45 ? 'TRUNG BÌNH' : 'THẤP';

  return (
    <div className="rounded-lg border border-[#43D7B1]/60 bg-[#041A16]/95 p-3 shadow-xl font-mono-tabular text-xs space-y-1.5 min-w-[210px]">
      <div className="flex items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-1">
        <span className="font-bold" style={{ color: pt.color }}>
          {pt.fullName}
        </span>
        <span
          className={`text-[10px] font-semibold ${
            tier === 'CAO'
              ? 'text-[#EF6682]'
              : tier === 'TRUNG BÌNH'
              ? 'text-[#EAC64D]'
              : 'text-[#39DEA2]'
          }`}
        >
          {tier}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-[#8FA9A0]">Mức phơi nhiễm</span>
        <span className="font-bold text-[#E6F2ED]">{pt.currentExposure} / 100</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-[#8FA9A0]">Ngưỡng giới hạn</span>
        <span className="text-[#43D7B1]">{pt.sessionCap} / 100</span>
      </div>
      <div className="pt-1 border-t border-[#145B4B]/40 text-[10px] text-[#8FA9A0] max-w-[230px]">
        {pt.driver}
      </div>
    </div>
  );
};

function clampRisk(n: number): number {
  return Math.round(Math.min(100, Math.max(5, n)));
}

export const RiskAssessmentRadar: React.FC<RiskAssessmentRadarProps> = ({
  snapshot,
  selectedToken,
}) => {
  const [scope, setScope] = useState<'token' | 'portfolio'>('token');

  const radarData = useMemo<AgentRiskPoint[]>(() => {
    const tok = selectedToken ?? snapshot.tokens[0];
    const openTrades = snapshot.trades.filter((t) => t.status === 'OPEN');
    const openAllocatedUsd = openTrades.reduce((sum, t) => sum + t.equityAllocatedUsd, 0);
    const warnOrErrCount = snapshot.logs.filter(
      (l) => l.eventType === 'WARN' || l.eventType === 'ERROR' || l.eventType === 'STOP_SIM'
    ).length;

    const avgTokenVol1h =
      snapshot.tokens.length > 0
        ? snapshot.tokens.reduce((s, t) => s + Math.abs(t.priceChange1h), 0) / snapshot.tokens.length
        : 25;
    const filteredTokensCount = snapshot.tokens.filter((t) => t.status === 'FILTERED').length;

    return snapshot.agents.map((agent) => {
      let score = 30;
      let driver = agent.metricPrimary;

      if (scope === 'token' && tok) {
        switch (agent.id) {
          case 'launch_radar':
            score = Math.abs(tok.priceChange1h) * 0.65 + (tok.detectedAgo === 'live' ? 24 : 14);
            driver = `${tok.symbol} biến động 1h ${tok.priceChange1h >= 0 ? '+' : ''}${tok.priceChange1h.toFixed(1)}%`;
            break;
          case 'whale_watch':
            score = (tok.whaleInflowUsd / Math.max(1000, tok.liquidityUsd)) * 105 + 14;
            driver = `Dòng tiền $${Math.round(tok.whaleInflowUsd / 1000)}k / LP $${Math.round(tok.liquidityUsd / 1000)}k`;
            break;
          case 'sentiment':
            score = Math.abs(tok.priceChange5m) * 1.7 + 22;
            driver = `Động lượng ${tok.sentimentVelocity} (${tok.symbol})`;
            break;
          case 'lp_auditor':
            score =
              tok.mintAuthorityRevoked === false || tok.freezeAuthorityRevoked === false
                ? 94
                : tok.mintAuthorityRevoked === null || tok.freezeAuthorityRevoked === null
                ? 86
                : tok.liquidityUsd < 35000
                ? 76
                : tok.liquidityUsd < 85000
                ? 44
                : 22;
            driver =
              tok.status === 'FILTERED'
                ? 'Bị chặn bởi kiểm tra LP / Quyền Mint-Freeze'
                : tok.mintAuthorityRevoked === true && tok.freezeAuthorityRevoked === true
                ? `LP $${Math.round(tok.liquidityUsd).toLocaleString()} · Quyền an toàn`
                : `LP $${Math.round(tok.liquidityUsd).toLocaleString()} · Chưa xác minh Mint/Freeze`;
            break;
          case 'holder_map':
            score = tok.holdersCount < 450 ? 78 : tok.holdersCount < 1100 ? 48 : 26;
            driver = `${tok.holdersCount.toLocaleString()} ví giữ · curve ${tok.bondingCurvePct}%`;
            break;
          case 'risk_sizer':
            score = (openAllocatedUsd / Math.max(1, snapshot.stats.paperBalanceUsd)) * 420 + 20;
            driver = `${openTrades.length} lệnh đang mở (${((openAllocatedUsd / Math.max(1, snapshot.stats.paperBalanceUsd)) * 100).toFixed(1)}% vốn)`;
            break;
          case 'sniper':
            score =
              tok.status === 'FILTERED'
                ? 10
                : tok.status === 'OPEN'
                ? 72
                : tok.riskLevel === 'HIGH RISK'
                ? 64
                : 32;
            driver =
              tok.status === 'OPEN'
                ? `Đang có vị thế mô phỏng ${tok.symbol}`
                : `Sẵn sàng khớp lệnh ảo (${tok.riskLevel === 'HIGH RISK' ? 'RỦI RO CAO' : tok.riskLevel === 'LOW RISK' ? 'RỦI RO THẤP' : 'TRUNG BÌNH'})`;
            break;
          case 'profit_taker':
            score =
              tok.riskLevel === 'HIGH RISK'
                ? 74
                : tok.riskLevel === 'MEDIUM RISK'
                ? 46
                : 24;
            driver = `Bậc chốt lời 2× / 5×: ${tok.riskLevel === 'HIGH RISK' ? 'RỦI RO CAO' : tok.riskLevel === 'LOW RISK' ? 'RỦI RO THẤP' : 'TRUNG BÌNH'}`;
            break;
          case 'stop_guard':
            score =
              (snapshot.stats.losses / Math.max(1, snapshot.stats.totalTrades)) * 125 +
              (tok.priceChange5m < 0 ? 18 : 8);
            driver = `${snapshot.stats.losses} cắt lỗ / ${snapshot.stats.totalTrades} lệnh · trần -12%`;
            break;
          case 'journal':
            score = snapshot.stats.blockedPct + warnOrErrCount * 7 + 12;
            driver = `${warnOrErrCount} cảnh báo / cắt lỗ đã lưu`;
            break;
        }
      } else {
        // Aggregated portfolio-wide scope across all scanned tokens & paper trades
        switch (agent.id) {
          case 'launch_radar':
            score = avgTokenVol1h * 0.6 + 18;
            driver = `Biến động 1h TB trên ${snapshot.tokens.length} cặp: ${avgTokenVol1h.toFixed(1)}%`;
            break;
          case 'whale_watch':
            score = Math.min(90, snapshot.tokens.filter((t) => t.whaleInflowUsd > 30000).length * 24 + 18);
            driver = `${snapshot.tokens.filter((t) => t.whaleInflowUsd > 30000).length} cặp có dòng tiền >$30k`;
            break;
          case 'sentiment':
            score = Math.min(88, avgTokenVol1h * 0.55 + 24);
            driver = `Động lượng phiên trên ${snapshot.tokens.length} nguồn cấp`;
            break;
          case 'lp_auditor':
            score = Math.min(95, filteredTokensCount * 28 + snapshot.stats.blockedPct + 18);
            driver = `Đã chặn ${snapshot.stats.blockedCount} / ${snapshot.stats.tokensChecked} token quét`;
            break;
          case 'holder_map':
            score =
              snapshot.tokens.filter((t) => t.holdersCount < 700).length * 20 + 20;
            driver = `${snapshot.tokens.filter((t) => t.holdersCount < 700).length} cặp có ít ví nắm giữ`;
            break;
          case 'risk_sizer':
            score = (openAllocatedUsd / Math.max(1, snapshot.stats.paperBalanceUsd)) * 450 + 22;
            driver = `Vốn ảo phân bổ: $${openAllocatedUsd.toFixed(2)} / $${snapshot.stats.paperBalanceUsd.toFixed(2)}`;
            break;
          case 'sniper':
            score = openTrades.length * 32 + 20;
            driver = `${openTrades.length} vị thế mô phỏng đang mở`;
            break;
          case 'profit_taker':
            score = snapshot.trades.filter((t) => t.riskLevel === 'HIGH RISK').length * 18 + 24;
            driver = `${snapshot.trades.filter((t) => t.riskLevel === 'HIGH RISK').length} lệnh mô phỏng rủi ro cao`;
            break;
          case 'stop_guard':
            score = (snapshot.stats.losses / Math.max(1, snapshot.stats.totalTrades)) * 135 + 14;
            driver = `${snapshot.stats.losses} lệnh cắt lỗ (tỷ lệ lỗ ${100 - snapshot.stats.winRatePct}%)`;
            break;
          case 'journal':
            score = warnOrErrCount * 8 + snapshot.stats.blockedPct + 14;
            driver = `${snapshot.logs.length} nhật ký kiểm định · ${warnOrErrCount} cảnh báo`;
            break;
        }
      }

      return {
        agentId: agent.id,
        shortLabel: SHORT_LABELS[agent.id],
        fullName: agent.name,
        color: agent.color,
        currentExposure: clampRisk(score),
        sessionCap: 65,
        driver,
      };
    });
  }, [snapshot, selectedToken, scope]);

  const aggregateRiskIndex = useMemo(() => {
    if (radarData.length === 0) return 0;
    const sum = radarData.reduce((acc, item) => acc + item.currentExposure, 0);
    return Math.round(sum / radarData.length);
  }, [radarData]);

  const aggregateTier =
    aggregateRiskIndex >= 65
      ? { label: 'RỦI RO CAO', color: '#EF6682' }
      : aggregateRiskIndex >= 42
      ? { label: 'RỦI RO TRUNG BÌNH', color: '#EAC64D' }
      : { label: 'RỦI RO THẤP', color: '#39DEA2' };

  return (
    <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
          <ShieldAlert className="h-3.5 w-3.5 text-[#FF9B45]" />
          <span className="text-[#E6F2ED]">ĐÁNH GIÁ RỦI RO</span>
          <span>·</span>
          <span className="font-mono-tabular text-[11px] text-[#43D7B1]">
            PHÂN BỔ RỦI RO 10 AGENT ({scope === 'token' ? selectedToken?.symbol ?? 'ĐANG CHỌN' : 'TOÀN PHIÊN'})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-mono-tabular text-xs">
            <span className="text-[#8FA9A0]">Chỉ số:</span>
            <span className="font-bold text-[#E6F2ED]">{aggregateRiskIndex}/100</span>
            <span
              className="rounded border px-1.5 py-0.5 text-[10px] font-bold"
              style={{
                color: aggregateTier.color,
                borderColor: `${aggregateTier.color}66`,
                backgroundColor: `${aggregateTier.color}14`,
              }}
            >
              {aggregateTier.label}
            </span>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-[#145B4B] bg-[#031713] p-0.5 font-mono-tabular text-[11px]">
            <button
              type="button"
              onClick={() => setScope('token')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                scope === 'token'
                  ? 'bg-[#092D27] text-[#FF9B45]'
                  : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              Token đang chọn
            </button>
            <button
              type="button"
              onClick={() => setScope('portfolio')}
              className={`rounded px-2 py-1 transition-colors whitespace-nowrap cursor-pointer ${
                scope === 'portfolio'
                  ? 'bg-[#092D27] text-[#43D7B1]'
                  : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
              }`}
            >
              Toàn danh mục phiên
            </button>
          </div>
        </div>
      </div>

      {/* Body: Spider Chart (Left) + 10-Agent Numeric Breakdown (Right) */}
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-12 items-center">
        <div className="lg:col-span-6 h-72 rounded-lg border border-[#145B4B]/60 bg-[#031713] p-2">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="72%" data={radarData}>
              <PolarGrid stroke="#145B4B" strokeOpacity={0.7} />
              <PolarAngleAxis
                dataKey="shortLabel"
                tick={{
                  fill: '#8FA9A0',
                  fontSize: 10,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 600,
                }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fill: '#8FA9A0', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
                tickCount={5}
                axisLine={false}
              />
              <Tooltip content={<RiskTooltip />} />
              <Radar
                name="Ngưỡng giới hạn (65)"
                dataKey="sessionCap"
                stroke="#43D7B1"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill="#43D7B1"
                fillOpacity={0.07}
              />
              <Radar
                name="Phơi nhiễm rủi ro Agent"
                dataKey="currentExposure"
                stroke="#FF9B45"
                strokeWidth={2.2}
                fill="#EF6682"
                fillOpacity={0.28}
                dot={{ r: 3, fill: '#FF9B45', stroke: '#031713', strokeWidth: 1 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {radarData.map((pt) => {
            const barColor =
              pt.currentExposure >= 70
                ? '#EF6682'
                : pt.currentExposure >= 45
                ? '#EAC64D'
                : '#39DEA2';
            return (
              <div
                key={pt.agentId}
                className="rounded-lg border border-[#145B4B]/60 bg-[#031713] px-3 py-2 font-mono-tabular"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold truncate" style={{ color: pt.color }}>
                    {pt.fullName}
                  </span>
                  <span className="font-bold shrink-0" style={{ color: barColor }}>
                    {pt.currentExposure}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#092D27]">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pt.currentExposure}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-[#8FA9A0] truncate" title={pt.driver}>
                  {pt.driver}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
