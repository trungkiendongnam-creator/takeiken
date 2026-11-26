import React, { useState } from 'react';
import {
  BellRing,
  Check,
  Plus,
  Power,
  Trash2,
} from 'lucide-react';
import type {
  AgentId,
  AgentRecord,
  VolatilityAlertRule,
  VolatilityDirection,
  VolatilityWindow,
} from '../types/terminal';

interface VolatilityAlertsPanelProps {
  agents: AgentRecord[];
  rules: VolatilityAlertRule[];
  onCreateRule: (payload: {
    agentId: AgentId;
    window: VolatilityWindow;
    direction: VolatilityDirection;
    thresholdPct: number;
  }) => Promise<void>;
  onToggleRule: (id: number, enabled: boolean) => Promise<void>;
  onAcknowledgeRule: (id: number) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
  busy: boolean;
}

const PRESET_THRESHOLDS = [10, 25, 35, 75];

export const VolatilityAlertsPanel: React.FC<VolatilityAlertsPanelProps> = ({
  agents,
  rules,
  onCreateRule,
  onToggleRule,
  onAcknowledgeRule,
  onDeleteRule,
  busy,
}) => {
  const [agentId, setAgentId] = useState<AgentId>('launch_radar');
  const [windowVal, setWindowVal] = useState<VolatilityWindow>('1h');
  const [direction, setDirection] = useState<VolatilityDirection>('ANY');
  const [thresholdPct, setThresholdPct] = useState<string>('25');

  const triggeredCount = rules.filter((r) => r.enabled && r.isTriggered).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(thresholdPct);
    if (!Number.isFinite(num) || num < 0.5 || num > 5000) return;
    await onCreateRule({
      agentId,
      window: windowVal,
      direction,
      thresholdPct: num,
    });
  };

  return (
    <section className="rounded-xl border border-[#145B4B] bg-[#06231F] p-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
          <BellRing className="h-3.5 w-3.5 text-[#FF9B45]" />
          <span className="text-[#E6F2ED]">CẢNH BÁO BIẾN ĐỘNG</span>
          <span>·</span>
          <span className="font-mono-tabular text-[11px] text-[#43D7B1]">
            NGƯỠNG TÙY CHỈNH THEO AGENT ({rules.length} quy tắc)
          </span>
        </div>

        <div className="font-mono-tabular text-xs">
          {triggeredCount > 0 ? (
            <span className="rounded border border-[#FF9B45]/60 bg-[#FF9B45]/15 px-2 py-0.5 text-[11px] font-bold text-[#FF9B45]">
              {triggeredCount} ĐANG CẢNH BÁO Ở SIDEBAR
            </span>
          ) : (
            <span className="text-[11px] text-[#39DEA2]">TẤT CẢ NGƯỠNG BÌNH THƯỜNG</span>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Configuration Form */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 space-y-3"
        >
          <div className="text-[11px] font-semibold tracking-wider text-[#8FA9A0]">
            THIẾT LẬP NGƯỠNG CẢNH BÁO CHO AGENT
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="space-y-1 text-[11px] text-[#8FA9A0]">
              <span>Agent theo dõi</span>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value as AgentId)}
                className="w-full rounded-md border border-[#145B4B] bg-[#06231F] px-2.5 py-1.5 font-mono-tabular text-xs text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              >
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.code}. {ag.name} ({ag.viName})
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-[11px] text-[#8FA9A0]">
              <span>Khung thời gian</span>
              <select
                value={windowVal}
                onChange={(e) => setWindowVal(e.target.value as VolatilityWindow)}
                className="w-full rounded-md border border-[#145B4B] bg-[#06231F] px-2.5 py-1.5 font-mono-tabular text-xs text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              >
                <option value="5m">Biến động 5 phút (5m)</option>
                <option value="1h">Biến động 1 giờ (1h)</option>
                <option value="24h">Biến động 24 giờ (24h)</option>
              </select>
            </label>

            <label className="space-y-1 text-[11px] text-[#8FA9A0]">
              <span>Chiều biến động</span>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as VolatilityDirection)}
                className="w-full rounded-md border border-[#145B4B] bg-[#06231F] px-2.5 py-1.5 font-mono-tabular text-xs text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              >
                <option value="ANY">Bất kỳ (±%)</option>
                <option value="UP">Tăng đột biến (+%)</option>
                <option value="DOWN">Giảm mạnh (-%)</option>
              </select>
            </label>

            <label className="space-y-1 text-[11px] text-[#8FA9A0]">
              <span>Ngưỡng (%)</span>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="5000"
                value={thresholdPct}
                onChange={(e) => setThresholdPct(e.target.value)}
                className="w-full rounded-md border border-[#145B4B] bg-[#06231F] px-2.5 py-1.5 font-mono-tabular text-xs text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5">
              {PRESET_THRESHOLDS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setThresholdPct(String(preset))}
                  className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] transition-colors cursor-pointer ${
                    Number(thresholdPct) === preset
                      ? 'border-[#43D7B1] bg-[#092D27] text-[#43D7B1]'
                      : 'border-[#145B4B] bg-[#06231F] text-[#8FA9A0] hover:text-[#E6F2ED]'
                  }`}
                >
                  {preset}%
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#FF9B45]/60 bg-[#FF9B45]/15 px-3 py-1.5 font-mono-tabular text-xs font-semibold text-[#FF9B45] transition-colors hover:bg-[#FF9B45]/25 disabled:opacity-40 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm cảnh báo
            </button>
          </div>
        </form>

        {/* Active Rules Table */}
        <div className="lg:col-span-7 rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 flex flex-col">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wider text-[#8FA9A0]">
            <span>DANH SÁCH CẢNH BÁO ĐANG HOẠT ĐỘNG</span>
            <span className="font-mono-tabular text-[#43D7B1]">Đánh giá theo token thực tế</span>
          </div>

          <div className="max-h-48 overflow-y-auto divide-y divide-[#145B4B]/40">
            {rules.length === 0 ? (
              <div className="py-8 text-center font-mono-tabular text-xs text-[#8FA9A0]">
                Chưa có quy tắc cảnh báo nào. Hãy thêm quy tắc ở bên trái để theo dõi biến động cho từng Agent.
              </div>
            ) : (
              rules.map((rule) => {
                const isTrig = rule.enabled && rule.isTriggered;
                const dirSymbol =
                  rule.direction === 'UP' ? '≥ +' : rule.direction === 'DOWN' ? '≤ -' : '±';
                return (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 px-1 font-mono-tabular text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[#E6F2ED]">{rule.agentName}</span>
                        <span className="text-[#43D7B1]">
                          {dirSymbol}
                          {rule.thresholdPct}% ({rule.window})
                        </span>
                        {!rule.enabled ? (
                          <span className="rounded border border-[#8FA9A0]/40 px-1.5 py-0.5 text-[10px] text-[#8FA9A0]">
                            TẠM DỪNG
                          </span>
                        ) : isTrig ? (
                          <span className="rounded border border-[#FF9B45]/60 bg-[#FF9B45]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#FF9B45]">
                            ĐÃ KÍCH HOẠT{rule.acknowledged ? ' (ĐÃ XEM)' : ''}
                          </span>
                        ) : (
                          <span className="rounded border border-[#39DEA2]/40 bg-[#39DEA2]/10 px-1.5 py-0.5 text-[10px] text-[#39DEA2]">
                            ĐANG CHỜ
                          </span>
                        )}
                      </div>

                      {isTrig && rule.triggeredSymbol && (
                        <div className="text-[11px] text-[#FF9B45]">
                          Vượt ngưỡng bởi {rule.triggeredSymbol}:{' '}
                          {(rule.triggeredChangePct ?? 0) >= 0 ? '+' : ''}
                          {rule.triggeredChangePct}% trong {rule.window}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isTrig && !rule.acknowledged && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAcknowledgeRule(rule.id)}
                          title="Đánh dấu đã xem cảnh báo ở Sidebar"
                          className="inline-flex items-center gap-1 rounded border border-[#43D7B1]/50 bg-[#092D27] px-2 py-1 text-[10px] text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
                        >
                          <Check className="h-3 w-3" />
                          Đã xem
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onToggleRule(rule.id, !rule.enabled)}
                        title={rule.enabled ? 'Tạm dừng quy tắc' : 'Bật lại quy tắc'}
                        className={`rounded border p-1 cursor-pointer ${
                          rule.enabled
                            ? 'border-[#39DEA2]/50 text-[#39DEA2] hover:bg-[#39DEA2]/10'
                            : 'border-[#145B4B] text-[#8FA9A0] hover:text-[#E6F2ED]'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDeleteRule(rule.id)}
                        title="Xóa quy tắc cảnh báo"
                        className="rounded border border-[#EF6682]/40 p-1 text-[#EF6682] hover:bg-[#EF6682]/15 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
