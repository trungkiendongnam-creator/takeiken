import { useCallback, useEffect, useState } from 'react';
import { AgentInspectorModal } from './components/AgentInspectorModal';
import { AgentsSidebar } from './components/AgentsSidebar';
import { AuthGate } from './components/AuthGate';
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
import { apiFetch, setBearerToken, setUnauthorizedHandler } from './lib/apiClient';
import type {
  AgentId,
  TerminalSnapshot,
  VolatilityDirection,
  VolatilityWindow,
} from './types/terminal';

export default function App() {
  // Check if opened via Phantom Mobile QR Companion link (?phantomPair=CODE)
  const rawPairCode = new URLSearchParams(window.location.search).get('phantomPair')?.trim().toUpperCase() ?? '';
  if (/^[A-F0-9]{32}$/.test(rawPairCode)) {
    return <PhantomPairMobilePage pairCode={rawPairCode} />;
  }

  return <TerminalShell />;
}

function TerminalShell() {
  const [authState, setAuthState] = useState<{
    checked: boolean;
    authenticated: boolean;
    needsSetup: boolean;
    envConfigured: boolean;
  }>({
    checked: false,
    authenticated: false,
    needsSetup: false,
    envConfigured: false,
  });
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('simulation');
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | 'YOU' | null>(null);
  const [sidebarHighlightId, setSidebarHighlightId] = useState<AgentId | 'YOU' | null>('journal');
  const [selectedMint, setSelectedMint] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);
  const [overnightBusy, setOvernightBusy] = useState(false);
  const [drawdownBusy, setDrawdownBusy] = useState(false);
  const [liveTradeOutputMint, setLiveTradeOutputMint] = useState<string | null>(null);
  const [phantomDexSubTab, setPhantomDexSubTab] = useState<PhantomDexSubTab>('swap');

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  const checkAuthStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/status');
      const data = (await res.json()) as {
        authenticated?: boolean;
        needsSetup?: boolean;
        envConfigured?: boolean;
      };
      setAuthState({
        checked: true,
        authenticated: Boolean(data.authenticated),
        needsSetup: Boolean(data.needsSetup),
        envConfigured: Boolean(data.envConfigured),
      });
    } catch {
      setAuthState((prev) => ({ ...prev, checked: true, authenticated: false }));
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSnapshot(null);
      setAuthState((prev) => ({ ...prev, checked: true, authenticated: false }));
      void checkAuthStatus();
    });
    void checkAuthStatus();
    return () => setUnauthorizedHandler(null);
  }, [checkAuthStatus]);

  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TerminalSnapshot;
      setSnapshot(data);
      setSelectedMint((curr) => curr || data.tokens[0]?.mintAddress || '');
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load terminal state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authState.authenticated) return;
    void fetchState();
    apiFetch('/api/health')
      .then((res) => {
        if (res.ok) return fetchState();
      })
      .catch(() => {});
  }, [authState.authenticated, fetchState]);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    setBearerToken(null);
    setSnapshot(null);
    await checkAuthStatus();
  };

  const handleToggleRun = async () => {
    try {
      const res = await apiFetch('/api/pipeline/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        snapshot?: TerminalSnapshot;
      };
      if (data.snapshot) {
        setSnapshot(data.snapshot);
      } else if (res.ok) {
        setSnapshot(data as unknown as TerminalSnapshot);
      }
      if (!res.ok) {
        showToast(data.error || 'Không thể chuyển trạng thái hệ thống.');
      }
    } catch {
      showToast('Không thể chuyển trạng thái hệ thống.');
    }
  };

  const handleScanLive = async () => {
    setIsScanning(true);
    try {
      const res = await apiFetch('/api/pipeline/scan-live', { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        result?: {
          scannedCount: number;
          blockedCount: number;
          halted?: boolean;
          haltReason?: string | null;
        };
        snapshot?: TerminalSnapshot;
      };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Quét dữ liệu DEX trực tiếp thất bại');
      }
      setSnapshot(data.snapshot);
      if (data.snapshot.tokens[0]) {
        setSelectedMint(data.snapshot.tokens[0].mintAddress);
      }
      if (data.result?.halted) {
        showToast(
          `ĐÃ NGẮT MẠCH DRAWDOWN: ${data.result.haltReason ?? 'Chạm giới hạn sụt giảm ngày tối đa.'}`
        );
      } else {
        showToast(
          `Đã quét ${data.result?.scannedCount ?? 0} cặp token Solana (${data.result?.blockedCount ?? 0} token bị LP Auditor lọc).`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi quét DEX trực tiếp');
    } finally {
      setIsScanning(false);
    }
  };

  const handleSimulatePaper = async (
    mintAddress: string,
    action: 'OPEN_SIM' | 'CLOSE_SIM'
  ) => {
    setSimBusy(true);
    try {
      const res = await apiFetch('/api/paper/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAddress, action, equityPct: 4 }),
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
      const res = await apiFetch('/api/paper/reset', {
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
    const res = await apiFetch('/api/notifications/read', { method: 'POST' });
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
      const res = await apiFetch('/api/alerts/rules', {
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
      const res = await apiFetch(`/api/alerts/rules/${id}`, {
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
      const res = await apiFetch(`/api/alerts/rules/${id}`, {
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
      const res = await apiFetch(`/api/alerts/rules/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
      if (res.ok && data.snapshot) setSnapshot(data.snapshot);
    } finally {
      setAlertBusy(false);
    }
  };

  const handleAcknowledgeAllAlerts = async () => {
    const res = await apiFetch('/api/alerts/acknowledge-all', { method: 'POST' });
    const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSnapshot };
    if (res.ok && data.snapshot) setSnapshot(data.snapshot);
  };

  const handleRunOvernight = async (resetStart70: boolean) => {
    setOvernightBusy(true);
    try {
      const res = await apiFetch('/api/overnight/run', {
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
      const res = await apiFetch('/api/overnight/config', {
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

  const handleUpdateDrawdownConfig = async (payload: {
    enabled?: boolean;
    maxDailyDrawdownPct?: number;
    minEquityThresholdUsd?: number | null;
    clearHalt?: boolean;
  }) => {
    setDrawdownBusy(true);
    try {
      const res = await apiFetch('/api/simulation/drawdown-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        guard?: { isHalted: boolean; maxDailyDrawdownPct: number; effectiveHaltThresholdUsd: number };
        snapshot?: TerminalSnapshot;
      };
      if (data.snapshot) {
        setSnapshot(data.snapshot);
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Không thể cập nhật giới hạn sụt giảm ngày');
      }
      if (data.guard?.isHalted) {
        showToast(
          `Đã lưu ngưỡng bảo vệ ($${data.guard.effectiveHaltThresholdUsd.toFixed(2)}) — Hệ thống đang tạm dừng do chạm ngưỡng.`
        );
      } else {
        showToast(
          `Đã cập nhật giới hạn sụt giảm ngày (-${data.guard?.maxDailyDrawdownPct ?? 30}% · Ngưỡng $${data.guard?.effectiveHaltThresholdUsd.toFixed(2) ?? '—'}).`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật giới hạn sụt giảm ngày');
    } finally {
      setDrawdownBusy(false);
    }
  };

  if (!authState.checked) {
    return (
      <div className="min-h-screen bg-[#031713] flex items-center justify-center p-6 font-mono-tabular text-sm text-[#43D7B1]">
        Đang kiểm tra trạng thái xác thực Grok Bot Terminal...
      </div>
    );
  }

  if (!authState.authenticated) {
    return (
      <AuthGate
        needsSetup={authState.needsSetup}
        envConfigured={authState.envConfigured}
        onAuthenticated={() =>
          setAuthState((prev) => ({ ...prev, authenticated: true, needsSetup: false }))
        }
      />
    );
  }

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
        onLogout={handleLogout}
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
              onUpdateDrawdownConfig={handleUpdateDrawdownConfig}
              drawdownBusy={drawdownBusy}
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
