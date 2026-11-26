import { useCallback, useEffect, useState } from 'react';
import { AgentInspectorModal } from './components/AgentInspectorModal';
import { AgentsSidebar } from './components/AgentsSidebar';
import { BacktestPanel } from './components/BacktestPanel';
import { HeaderBar, type WorkspaceTab } from './components/HeaderBar';
import { LiveFlowWorkspace } from './components/LiveFlowWorkspace';
import { OvernightPromptPanel } from './components/OvernightPromptPanel';
import { PhantomPairMobilePage } from './components/PhantomPairMobilePage';
import { QaArchitecturePanel } from './components/QaArchitecturePanel';
import {
  UnifiedPhantomDexWorkspace,
  type PhantomDexSubTab,
} from './components/UnifiedPhantomDexWorkspace';
import type {
  AgentId,
  TerminalSnapshot,
  VolatilityDirection,
  VolatilityWindow,
} from './types/terminal';

export default function App() {
  // Check if opened via Phantom Mobile QR Companion link (?phantomPair=CODE)
  const pairCode = new URLSearchParams(window.location.search).get('phantomPair');
  if (pairCode) {
    return <PhantomPairMobilePage pairCode={pairCode} />;
  }

  return <TerminalShell />;
}

function TerminalShell() {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('simulation');
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | 'YOU' | null>(null);
  const [sidebarHighlightId, setSidebarHighlightId] = useState<AgentId | 'YOU' | null>('journal');
  const [selectedMint, setSelectedMint] = useState<string>('CLAUDIAmint11111111111111111111111111111111');
  const [isScanning, setIsScanning] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);
  const [overnightBusy, setOvernightBusy] = useState(false);
  const [liveTradeOutputMint, setLiveTradeOutputMint] = useState<string | null>(null);
  const [phantomDexSubTab, setPhantomDexSubTab] = useState<PhantomDexSubTab>('swap');

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TerminalSnapshot;
      setSnapshot(data);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load terminal state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    // Refresh live Solana RPC health & SOL/USD price on startup
    fetch('/api/health')
      .then(() => fetchState())
      .catch(() => {});
  }, [fetchState]);

  const handleToggleRun = async () => {
    try {
      const res = await fetch('/api/pipeline/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setSnapshot((await res.json()) as TerminalSnapshot);
      }
    } catch {
      showToast('Không thể chuyển trạng thái hệ thống.');
    }
  };

  const handleScanLive = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/pipeline/scan-live', { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        result?: { scannedCount: number; blockedCount: number };
        snapshot?: TerminalSnapshot;
      };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Quét dữ liệu DEX trực tiếp thất bại');
      }
      setSnapshot(data.snapshot);
      if (data.snapshot.tokens[0]) {
        setSelectedMint(data.snapshot.tokens[0].mintAddress);
      }
      showToast(
        `Đã quét ${data.result?.scannedCount ?? 0} cặp token Solana (${data.result?.blockedCount ?? 0} token bị LP Auditor lọc).`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi quét DEX trực tiếp');
    } finally {
      setIsScanning(false);
    }
  };

  const handleSimulatePaper = async (
    mintAddress: string,
    action: 'OPEN_SIM' | 'CLOSE_SIM',
    simulatedMultiplier?: number
  ) => {
    setSimBusy(true);
    try {
      const res = await fetch('/api/paper/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAddress, action, equityPct: 4, simulatedMultiplier }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        snapshot?: TerminalSnapshot;
      };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Mô phỏng giao dịch thất bại');
      }
      setSnapshot(data.snapshot);
      showToast(data.message ?? 'Đã ghi nhận lệnh mô phỏng Paper Trading.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi mô phỏng lệnh');
    } finally {
      setSimBusy(false);
    }
  };

  const handleResetPaper = async () => {
    setSimBusy(true);
    try {
      const res = await fetch('/api/paper/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startBalanceUsd: 50 }),
      });
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
      if (res.ok && data.snapshot) {
        setSnapshot(data.snapshot);
        showToast('Đã đặt lại số dư mô phỏng Paper Trading về $50.00.');
      }
    } finally {
      setSimBusy(false);
    }
  };

  const handleMarkNotificationsRead = async () => {
    const res = await fetch('/api/notifications/read', { method: 'POST' });
    const data = (await res.json()) as { snapshot?: TerminalSnapshot };
    if (res.ok && data.snapshot) {
      setSnapshot(data.snapshot);
    }
  };

  const handleCreateAlertRule = async (payload: {
    agentId: AgentId;
    window: VolatilityWindow;
    direction: VolatilityDirection;
    thresholdPct: number;
  }) => {
    setAlertBusy(true);
    try {
      const res = await fetch('/api/alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; snapshot?: TerminalSnapshot };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Không thể thêm quy tắc cảnh báo biến động');
      }
      setSnapshot(data.snapshot);
      showToast(`Đã thêm cảnh báo biến động (${payload.thresholdPct}% / ${payload.window}).`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tạo cảnh báo');
    } finally {
      setAlertBusy(false);
    }
  };

  const handleToggleAlertRule = async (id: number, enabled: boolean) => {
    setAlertBusy(true);
    try {
      const res = await fetch(`/api/alerts/rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
      if (res.ok && data.snapshot) setSnapshot(data.snapshot);
    } finally {
      setAlertBusy(false);
    }
  };

  const handleAcknowledgeAlertRule = async (id: number) => {
    setAlertBusy(true);
    try {
      const res = await fetch(`/api/alerts/rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: true }),
      });
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
      if (res.ok && data.snapshot) setSnapshot(data.snapshot);
    } finally {
      setAlertBusy(false);
    }
  };

  const handleDeleteAlertRule = async (id: number) => {
    setAlertBusy(true);
    try {
      const res = await fetch(`/api/alerts/rules/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
      if (res.ok && data.snapshot) setSnapshot(data.snapshot);
    } finally {
      setAlertBusy(false);
    }
  };

  const handleAcknowledgeAllAlerts = async () => {
    const res = await fetch('/api/alerts/acknowledge-all', { method: 'POST' });
    const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
    if (res.ok && data.snapshot) setSnapshot(data.snapshot);
  };

  const handleRunOvernight = async (resetStart70: boolean) => {
    setOvernightBusy(true);
    try {
      const res = await fetch('/api/overnight/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetStart70 }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        result?: { summary?: string };
        snapshot?: TerminalSnapshot;
      };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Chạy kịch bản Phiên Đêm thất bại');
      }
      setSnapshot(data.snapshot);
      if (data.snapshot.tokens[0]) {
        setSelectedMint(data.snapshot.tokens[0].mintAddress);
      }
      showToast(data.result?.summary ?? 'Đã chạy xong chu kỳ Phiên Đêm (23:00 → 07:00).');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi chạy Kịch bản Phiên Đêm');
    } finally {
      setOvernightBusy(false);
    }
  };

  const handleUpdateOvernightConfig = async (payload: {
    enabled?: boolean;
    startTime?: string;
    endTime?: string;
    startBalanceUsd?: number;
  }) => {
    try {
      const res = await fetch('/api/overnight/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        config?: { enabled: boolean; sessionWindow: string };
        snapshot?: TerminalSnapshot;
      };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Không cập nhật được cấu hình Phiên Đêm');
      }
      setSnapshot(data.snapshot);
      showToast(
        `Đã cập nhật Phiên Đêm: ${data.config?.enabled ? 'BẬT' : 'TẮT'} (${data.config?.sessionWindow ?? ''}).`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật Phiên Đêm');
    }
  };

  if (loading || !snapshot) {
    return (
      <div className="min-h-screen bg-[#031713] flex items-center justify-center p-6 font-mono-tabular text-sm text-[#43D7B1]">
        {errorMsg ? (
          <div className="rounded-xl border border-[#EF6682] bg-[#06231F] p-5 text-[#EF6682]">
            Lỗi khởi chạy Grok Bot Terminal: {errorMsg}
          </div>
        ) : (
          <div>Đang khởi tạo Grok Bot Terminal & Cơ sở dữ liệu SQLite...</div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#031713] text-[#E6F2ED] flex flex-col">
      <HeaderBar
        snapshot={snapshot}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenPhantomConnect={() => {
          setPhantomDexSubTab(snapshot.wallet.connected ? 'transfer' : 'wallet');
          setActiveTab('livetrade');
        }}
        onToggleRun={handleToggleRun}
        onScanLive={handleScanLive}
        isScanning={isScanning}
      />

      {toastMsg && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-[#43D7B1] bg-[#06231F] px-4 py-2.5 font-mono-tabular text-xs text-[#43D7B1] shadow-xl">
          {toastMsg}
        </div>
      )}

      <div className="flex flex-1 flex-col lg:flex-row min-h-0">
        <AgentsSidebar
          agents={snapshot.agents}
          selectedAgentId={sidebarHighlightId}
          unreadNotifications={snapshot.unreadNotifications}
          volatilityAlerts={snapshot.volatilityAlerts}
          onSelectAgent={(id) => {
            setSidebarHighlightId(id);
            setSelectedAgentId(id);
          }}
          onAcknowledgeAllAlerts={handleAcknowledgeAllAlerts}
        />

        <main className="flex-1 min-w-0 overflow-y-auto bg-[#031713]">
          {activeTab === 'simulation' && (
            <LiveFlowWorkspace
              snapshot={snapshot}
              selectedMint={selectedMint}
              onSelectMint={setSelectedMint}
              onSimulatePaper={handleSimulatePaper}
              onResetPaper={handleResetPaper}
              simBusy={simBusy}
              onCreateAlertRule={handleCreateAlertRule}
              onToggleAlertRule={handleToggleAlertRule}
              onAcknowledgeAlertRule={handleAcknowledgeAlertRule}
              onDeleteAlertRule={handleDeleteAlertRule}
              alertBusy={alertBusy}
              onOpenOvernightTab={() => setActiveTab('overnight')}
              onRunOvernight={handleRunOvernight}
              overnightBusy={overnightBusy}
              onOpenLiveTradeForMint={(mint) => {
                setLiveTradeOutputMint(mint);
                setPhantomDexSubTab('swap');
                setActiveTab('livetrade');
              }}
              onToggleOvernightEnabled={(enabled) => handleUpdateOvernightConfig({ enabled })}
            />
          )}

          {activeTab === 'livetrade' && (
            <UnifiedPhantomDexWorkspace
              snapshot={snapshot}
              initialOutputMint={liveTradeOutputMint}
              requestedSubTab={phantomDexSubTab}
              onRefreshState={setSnapshot}
              onToast={showToast}
            />
          )}

          {activeTab === 'overnight' && (
            <OvernightPromptPanel
              snapshot={snapshot}
              busy={overnightBusy}
              onRunOvernight={handleRunOvernight}
              onUpdateConfig={handleUpdateOvernightConfig}
            />
          )}

          {activeTab === 'backtest' && (
            <BacktestPanel snapshot={snapshot} onRefreshState={setSnapshot} />
          )}

          {activeTab === 'qa' && (
            <QaArchitecturePanel snapshot={snapshot} onRefreshState={setSnapshot} />
          )}
        </main>
      </div>

      <AgentInspectorModal
        snapshot={snapshot}
        selectedId={selectedAgentId}
        onClose={() => setSelectedAgentId(null)}
        onMarkNotificationsRead={handleMarkNotificationsRead}
      />
    </div>
  );
}
