import React from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import type { AgentId, TerminalSnapshot } from '../types/terminal';

interface AgentInspectorModalProps {
  snapshot: TerminalSnapshot;
  selectedId: AgentId | 'YOU' | null;
  onClose: () => void;
  onMarkNotificationsRead: () => void;
}

export const AgentInspectorModal: React.FC<AgentInspectorModalProps> = ({
  snapshot,
  selectedId,
  onClose,
  onMarkNotificationsRead,
}) => {
  if (!selectedId) return null;

  if (selectedId === 'YOU') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
        <div className="w-full max-w-xl rounded-2xl border border-[#43D7B1]/60 bg-[#06231F] p-5 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-[#145B4B]/60 pb-3">
            <div className="flex items-center gap-2.5">
              <Bell className="h-5 w-5 text-[#43D7B1]" />
              <div>
                <h2 className="text-sm font-bold text-[#E6F2ED]">YOU — Trợ lý thông tin & Cảnh báo</h2>
                <p className="text-[11px] text-[#8FA9A0]">Không phải Agent thứ 11 · Tổng hợp sự kiện hệ thống</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onMarkNotificationsRead}
                className="inline-flex items-center gap-1 rounded border border-[#145B4B] bg-[#092D27] px-2.5 py-1 text-xs text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Đánh dấu đã đọc
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-[#145B4B] p-1 text-[#8FA9A0] hover:text-[#E6F2ED] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
            {snapshot.notifications.map((nf) => (
              <div
                key={nf.id}
                className={`rounded-lg border p-3 ${
                  nf.isRead
                    ? 'border-[#145B4B]/50 bg-[#031713]/60'
                    : 'border-[#43D7B1]/60 bg-[#092D27]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#E6F2ED]">{nf.title}</span>
                  <span className="font-mono-tabular text-[10px] text-[#43D7B1]">
                    {nf.isRead ? 'ĐÃ ĐỌC' : 'CHƯA ĐỌC'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#8FA9A0]">{nf.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const agent = snapshot.agents.find((a) => a.id === selectedId);
  if (!agent) return null;

  const agentLogs = snapshot.logs.filter((l) => l.agentId === agent.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-2xl border border-[#145B4B] bg-[#06231F] p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-[#145B4B]/60 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-xs text-[#8FA9A0]">AGENT {agent.code}</span>
              <h2 className="text-base font-bold" style={{ color: agent.color }}>
                {agent.name}
              </h2>
              <span
                className="rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-semibold"
                style={{ borderColor: agent.color, color: agent.color }}
              >
                {agent.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#E6F2ED]">{agent.viName}</p>
            <p className="text-xs text-[#8FA9A0]">{agent.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[#145B4B] p-1.5 text-[#8FA9A0] hover:text-[#E6F2ED] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 font-mono-tabular">
          <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
            <div className="text-[10px] text-[#8FA9A0]">Chỉ số gần nhất</div>
            <div className="mt-1 text-xs font-semibold text-[#E6F2ED]">{agent.metricPrimary}</div>
          </div>
          <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
            <div className="text-[10px] text-[#8FA9A0]">Trạng thái chi tiết</div>
            <div className="mt-1 text-xs font-semibold text-[#43D7B1]">{agent.metricSecondary}</div>
          </div>
          <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3">
            <div className="text-[10px] text-[#8FA9A0]">Sự kiện đã xử lý</div>
            <div className="mt-1 text-xs font-semibold text-[#E6F2ED]">{agent.eventsProcessed}</div>
          </div>
        </div>

        {agent.lastError && (
          <div className="rounded-lg border border-[#EF6682]/60 bg-[#EF6682]/10 p-3 font-mono-tabular text-xs text-[#EF6682]">
            Lỗi gần nhất: {agent.lastError}
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold tracking-wider text-[#8FA9A0]">
            NHẬT KÝ HOẠT ĐỘNG CỦA AGENT ({agentLogs.length})
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-[#145B4B]/70 bg-[#031713] p-3 font-mono-tabular text-xs">
            {agentLogs.length === 0 ? (
              <div className="py-4 text-center text-[#8FA9A0]">
                Chưa có bản ghi nhật ký riêng cho Agent này. Nhấn "Quét DEX Solana trực tiếp" để tạo sự kiện mới.
              </div>
            ) : (
              agentLogs.map((lg) => (
                <div key={lg.id} className="flex items-start justify-between gap-3 border-b border-[#145B4B]/30 pb-1.5">
                  <div>
                    <span className="text-[#8FA9A0] mr-2">{lg.timeShort}</span>
                    <span className="text-[#E6F2ED]">{lg.message}</span>
                    <div className="text-[11px] text-[#8FA9A0]">{lg.reason}</div>
                  </div>
                  <span className="shrink-0 text-[#43D7B1]">{lg.resultBadge}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
