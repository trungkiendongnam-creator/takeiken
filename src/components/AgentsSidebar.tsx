import React from 'react';
import {
  AlertTriangle,
  BellRing,
  BookOpen,
  CheckCheck,
  Crosshair,
  Flame,
  Layers,
  Network,
  Radar,
  Scale,
  ShieldAlert,
  TrendingUp,
  User,
  Waves,
} from 'lucide-react';
import type { AgentId, AgentRecord, VolatilityAlertRule } from '../types/terminal';

interface AgentsSidebarProps {
  agents: AgentRecord[];
  selectedAgentId: AgentId | 'YOU' | null;
  unreadNotifications: number;
  volatilityAlerts: VolatilityAlertRule[];
  onSelectAgent: (id: AgentId | 'YOU') => void;
  onAcknowledgeAllAlerts: () => void;
}

const AGENT_ICON_MAP: Record<AgentId, React.ReactNode> = {
  launch_radar: <Radar className="h-4 w-4" />,
  whale_watch: <Waves className="h-4 w-4" />,
  sentiment: <Flame className="h-4 w-4" />,
  lp_auditor: <AlertTriangle className="h-4 w-4" />,
  holder_map: <Network className="h-4 w-4" />,
  risk_sizer: <Scale className="h-4 w-4" />,
  sniper: <Crosshair className="h-4 w-4" />,
  profit_taker: <TrendingUp className="h-4 w-4" />,
  stop_guard: <ShieldAlert className="h-4 w-4" />,
  journal: <BookOpen className="h-4 w-4" />,
};

export const AgentsSidebar: React.FC<AgentsSidebarProps> = ({
  agents,
  selectedAgentId,
  unreadNotifications,
  volatilityAlerts,
  onSelectAgent,
  onAcknowledgeAllAlerts,
}) => {
  const activeUnackedAlerts = volatilityAlerts.filter(
    (a) => a.enabled && a.isTriggered && !a.acknowledged
  );

  return (
    <aside className="flex flex-col border-b border-[#145B4B] bg-[#041A16] lg:w-[30%] lg:min-w-[300px] lg:max-w-[380px] lg:border-b-0 lg:border-r">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between border-b border-[#145B4B]/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
          <span>AGENTS</span>
        </div>
        <div className="flex items-center gap-2 font-mono-tabular text-xs font-medium">
          {activeUnackedAlerts.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-[#FF9B45]/60 bg-[#FF9B45]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#FF9B45]">
              <BellRing className="h-3 w-3" />
              {activeUnackedAlerts.length}
            </span>
          )}
          <span className="text-[#43D7B1]">{agents.length} agent</span>
        </div>
      </div>

      {/* Triggered Volatility Alert Summary Banner */}
      {activeUnackedAlerts.length > 0 && (
        <div className="mx-3 mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-[#FF9B45]/70 bg-[#FF9B45]/12 px-3 py-2 font-mono-tabular text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing className="h-3.5 w-3.5 shrink-0 text-[#FF9B45]" />
            <span className="font-semibold text-[#FF9B45] truncate">
              {activeUnackedAlerts.length} ngưỡng biến động vượt mức
            </span>
          </div>
          <button
            type="button"
            onClick={onAcknowledgeAllAlerts}
            className="inline-flex items-center gap-1 rounded border border-[#FF9B45]/50 bg-[#041A16] px-2 py-0.5 text-[10px] text-[#FF9B45] hover:bg-[#FF9B45]/20 shrink-0 cursor-pointer"
          >
            <CheckCheck className="h-3 w-3" />
            Đã xem
          </button>
        </div>
      )}

      {/* Scrollable 10 Agents List */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {agents.map((agent) => {
          const isSelected = selectedAgentId === agent.id;
          const agentAlerts = volatilityAlerts.filter((a) => a.agentId === agent.id && a.enabled);
          const triggeredAlert = agentAlerts.find((a) => a.isTriggered);
          const unackedTrigger = agentAlerts.find((a) => a.isTriggered && !a.acknowledged);

          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelectAgent(agent.id)}
              className={`w-full rounded-xl border p-3 text-left transition-all cursor-pointer ${
                unackedTrigger
                  ? 'border-[#FF9B45] bg-[#211A0E]/60 shadow-[0_0_16px_rgba(255,155,69,0.24)]'
                  : isSelected
                  ? 'border-[#49A9ED] bg-[#092D27] shadow-[0_0_16px_rgba(73,169,237,0.2)]'
                  : 'border-[#145B4B]/80 bg-[#06231F] hover:border-[#43D7B1]/60 hover:bg-[#092D27]/70'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${agent.color}22`,
                      color: agent.color,
                    }}
                  >
                    {AGENT_ICON_MAP[agent.id] ?? <Layers className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div
                      className="text-xs font-bold tracking-wide truncate"
                      style={{ color: agent.color }}
                    >
                      {agent.name}
                    </div>
                    <div className="text-[11px] text-[#8FA9A0] truncate">
                      {agent.viName}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {triggeredAlert && (
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono-tabular text-[10px] font-bold ${
                        unackedTrigger
                          ? 'border-[#FF9B45] bg-[#FF9B45]/20 text-[#FF9B45]'
                          : 'border-[#EAC64D]/50 bg-[#EAC64D]/10 text-[#EAC64D]'
                      }`}
                    >
                      <BellRing className="h-2.5 w-2.5" />
                      CẢNH BÁO
                    </span>
                  )}
                  <span
                    className="rounded border px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold"
                    style={{
                      borderColor: `${agent.color}66`,
                      color: agent.color,
                      backgroundColor: `${agent.color}12`,
                    }}
                  >
                    {agent.status}
                  </span>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#145B4B]/40 pt-1.5 font-mono-tabular text-[11px]">
                <span className="text-[#E6F2ED] truncate">{agent.metricPrimary}</span>
                <span className="shrink-0 text-[#8FA9A0]">
                  #{agent.eventsProcessed}
                </span>
              </div>

              {triggeredAlert ? (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded bg-[#FF9B45]/12 px-2 py-1 font-mono-tabular text-[10px] text-[#FF9B45]">
                  <span className="truncate">
                    Biến động: {triggeredAlert.triggeredSymbol}{' '}
                    {(triggeredAlert.triggeredChangePct ?? 0) >= 0 ? '+' : ''}
                    {triggeredAlert.triggeredChangePct}% ({triggeredAlert.window})
                  </span>
                  <span className="shrink-0 font-semibold">≥{triggeredAlert.thresholdPct}%</span>
                </div>
              ) : agentAlerts.length > 0 ? (
                <div className="mt-1 font-mono-tabular text-[10px] text-[#8FA9A0]">
                  Cảnh báo chờ: {agentAlerts[0].direction === 'UP' ? 'Tăng' : agentAlerts[0].direction === 'DOWN' ? 'Giảm' : '±'}{' '}
                  {agentAlerts[0].thresholdPct}% ({agentAlerts[0].window})
                </div>
              ) : null}
            </button>
          );
        })}

        {/* YOU Zone (NOT Agent #11) */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => onSelectAgent('YOU')}
            className={`w-full rounded-xl border p-3 text-left transition-all cursor-pointer ${
              selectedAgentId === 'YOU'
                ? 'border-[#43D7B1] bg-[#092D27] shadow-[0_0_14px_rgba(67,215,177,0.2)]'
                : 'border-[#145B4B]/80 bg-[#06231F] hover:border-[#43D7B1]/60'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#8FA9A0]/15 text-[#E6F2ED]">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#E6F2ED]">YOU</div>
                  <div className="text-[11px] text-[#8FA9A0]">
                    Trợ lý thông tin & cảnh báo
                  </div>
                </div>
              </div>

              <span
                className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-semibold ${
                  unreadNotifications > 0
                    ? 'border-[#FF9B45]/60 bg-[#FF9B45]/15 text-[#FF9B45]'
                    : 'border-[#145B4B] bg-[#092D27] text-[#8FA9A0]'
                }`}
              >
                {unreadNotifications > 0 ? `${unreadNotifications} CHƯA ĐỌC` : 'SẴN SÀNG'}
              </span>
            </div>
          </button>
        </div>
      </div>
    </aside>
  );
};
