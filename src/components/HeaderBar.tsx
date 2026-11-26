import React, { useEffect, useState } from 'react';
import {
  Activity,
  FlaskConical,
  Moon,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wallet,
  Zap,
} from 'lucide-react';
import type { TerminalSnapshot } from '../types/terminal';
import { GrokLogo } from './GrokLogo';

export type WorkspaceTab = 'simulation' | 'livetrade' | 'overnight' | 'backtest' | 'qa';

interface HeaderBarProps {
  snapshot: TerminalSnapshot;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenPhantomConnect?: () => void;
  onToggleRun: () => void;
  onScanLive: () => void;
  isScanning: boolean;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  snapshot,
  activeTab,
  onSelectTab,
  onOpenPhantomConnect,
  onToggleRun,
  onScanLive,
  isScanning,
}) => {
  const [uptimeStr, setUptimeStr] = useState('00:04:00');

  useEffect(() => {
    const baseSeconds = 240; // Starts at 00:04:00 like reference and ticks live
    const startMs = Date.now();
    const updateClock = () => {
      const elapsed = snapshot.isRunning ? Math.floor((Date.now() - startMs) / 1000) : 0;
      const total = baseSeconds + elapsed;
      const hrs = String(Math.floor(total / 3600)).padStart(2, '0');
      const mins = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
      const secs = String(total % 60).padStart(2, '0');
      setUptimeStr(`${hrs}:${mins}:${secs}`);
    };
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, [snapshot.isRunning]);

  const { stats, wallet } = snapshot;

  return (
    <header className="border-b border-[#145B4B] bg-[#041C17]">
      {/* Window Chrome Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#145B4B]/60 px-4 py-2 text-xs">
        <div className="flex items-center gap-2 shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-[#EF6682]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#EAC64D]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#39DEA2]" />
        </div>

        <div className="text-[#8FA9A0] font-mono-tabular truncate text-center">
          Grok Bot Terminal — phiên đêm · 10 agent · Solana Mainnet
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono-tabular text-[11px] font-medium ${
              wallet.connected && wallet.connectionMethod === 'PHANTOM_EXTENSION'
                ? 'border-[#39DEA2]/60 bg-[#39DEA2]/10 text-[#39DEA2]'
                : 'border-[#FF9B45]/50 bg-[#FF9B45]/10 text-[#FF9B45]'
            }`}
          >
            <ShieldCheck className="h-3 w-3" />
            {wallet.connected && wallet.connectionMethod === 'PHANTOM_EXTENSION'
              ? 'JUPITER DEX · PHANTOM NON-CUSTODIAL'
              : 'PAPER TRADING · JUPITER DEX SẴN SÀNG'}
          </span>
        </div>
      </div>

      {/* Main Terminal Header */}
      <div className="flex flex-col gap-4 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Mascot + Brand + Live Sub-rows */}
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#145B4B] bg-[#06231F] shadow-[0_0_20px_rgba(67,215,177,0.12)]">
            <GrokLogo className="h-10 w-10" />
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight whitespace-nowrap">
                <span className="text-[#FF9B45]">Grok Bot</span>{' '}
                <span className="text-[#E6F2ED]">Terminal</span>
              </h1>
              <span className="rounded border border-[#145B4B] bg-[#092D27] px-2 py-0.5 font-mono-tabular text-[11px] text-[#8FA9A0]">
                {snapshot.version}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <button
                type="button"
                onClick={onToggleRun}
                className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold transition-colors hover:opacity-90 cursor-pointer"
                title="Bật / Tạm dừng luồng mô phỏng"
              >
                {snapshot.isRunning ? (
                  <>
                    <Pause className="h-3 w-3 text-[#FF9B45]" />
                    <span className="text-[#FF9B45]">đang chạy</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3 text-[#8FA9A0]" />
                    <span className="text-[#8FA9A0]">tạm dừng</span>
                  </>
                )}
              </button>
              <span className="text-[#8FA9A0]">·</span>
              <span className="font-mono-tabular text-[#8FA9A0]">{uptimeStr}</span>
              <span className="hidden sm:inline rounded border border-[#145B4B] bg-[#092D27] px-2.5 py-0.5 font-mono-tabular text-[11px] text-[#43D7B1] truncate max-w-[340px]">
                {snapshot.latestTicker}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-[11px] text-[#8FA9A0]">
              <span>pump.fun + raydium</span>
              <span>·</span>
              <span className="text-[#E6F2ED]">
                SOL ${snapshot.solPriceUsd > 0 ? snapshot.solPriceUsd.toFixed(2) : '—'}
              </span>
              <span>·</span>
              <span className="text-[#43D7B1]">
                RPC {snapshot.rpcLatencyMs !== null ? `${snapshot.rpcLatencyMs} ms` : 'mất kết nối'}
              </span>
              <span>·</span>
              <span>{snapshot.totalLaunchesTracked.toLocaleString()} token mới</span>
            </div>
          </div>
        </div>

        {/* Right: Paper KPIs + Separated Phantom Read-Only Widget */}
        <div className="flex flex-wrap items-center gap-4 lg:gap-6 shrink-0">
          {/* Paper Trading Balance (STRICTLY VIRTUAL) */}
          <div className="flex items-center gap-5 border-r border-[#145B4B]/70 pr-5">
            <div>
              <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-[#E6F2ED] leading-none">
                ${stats.paperBalanceUsd.toFixed(2)}
              </div>
              <div className="mt-1 text-[11px] text-[#8FA9A0]">số dư ảo (paper)</div>
            </div>

            <div className="text-center">
              <div className="font-mono-tabular text-xl font-semibold text-[#E6F2ED] leading-none">
                {stats.totalTrades}
              </div>
              <div className="mt-1 text-[11px] text-[#8FA9A0]">kịch bản</div>
            </div>

            <div className="text-center">
              <div className="font-mono-tabular text-xl font-semibold text-[#39DEA2] leading-none">
                {stats.wins}
              </div>
              <div className="mt-1 text-[11px] text-[#8FA9A0]">dương</div>
            </div>

            <div className="text-center">
              <div className="font-mono-tabular text-xl font-semibold text-[#EF6682] leading-none">
                {stats.losses}
              </div>
              <div className="mt-1 text-[11px] text-[#8FA9A0]">âm</div>
            </div>
          </div>

          {/* Separate Phantom Wallet Read-Only Module (Never merged into Paper Balance) */}
          <button
            type="button"
            onClick={() => (onOpenPhantomConnect ? onOpenPhantomConnect() : onSelectTab('livetrade'))}
            className="flex items-center gap-2.5 rounded-lg border border-[#145B4B] bg-[#06231F] px-3 py-2 text-left transition-colors hover:border-[#43D7B1] cursor-pointer"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#A986F5]/15 text-[#A986F5]">
              <Wallet className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E6F2ED] whitespace-nowrap">
                <span>{wallet.connected ? wallet.shortAddress : 'Ví Phantom'}</span>
                <span className="font-mono-tabular text-[10px] text-[#43D7B1]">
                  {wallet.connected && wallet.connectionMethod === 'PHANTOM_EXTENSION' ? 'KÝ AN TOÀN' : 'CHỈ ĐỌC'}
                </span>
              </div>
              <div className="font-mono-tabular text-[11px] text-[#8FA9A0] whitespace-nowrap">
                {wallet.connected
                  ? wallet.rpcStatus === 'OK' && wallet.solBalance !== null
                    ? `${wallet.solBalance.toFixed(4)} SOL · Mainnet`
                    : `RPC ${wallet.rpcStatus}`
                  : 'Kết nối · Nạp/Rút · DEX'}
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Navigation & Live Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#145B4B]/60 bg-[#031713]/70 px-4 py-1.5">
        <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Workspace navigation">
          <button
            type="button"
            onClick={() => onSelectTab('simulation')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === 'simulation'
                ? 'bg-[#092D27] text-[#EAC64D] border border-[#EAC64D]/60'
                : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            Chạy Mô Phỏng (Paper)
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('livetrade')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === 'livetrade'
                ? 'bg-[#092D27] text-[#39DEA2] border border-[#39DEA2]/70'
                : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            Giao dịch Thật (Phantom & DEX)
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('overnight')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === 'overnight'
                ? 'bg-[#092D27] text-[#FF9B45] border border-[#FF9B45]/60'
                : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            Kịch bản Qua đêm ($70)
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('backtest')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === 'backtest'
                ? 'bg-[#092D27] text-[#EAC64D] border border-[#EAC64D]/50'
                : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Backtest Dữ liệu thật
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('qa')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === 'qa'
                ? 'bg-[#092D27] text-[#49A9ED] border border-[#49A9ED]/50'
                : 'text-[#8FA9A0] hover:text-[#E6F2ED]'
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            Phân tích & QA / Bảo mật
          </button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onScanLive}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#43D7B1]/60 bg-[#092D27] px-3 py-1.5 text-xs font-semibold text-[#43D7B1] transition-colors hover:bg-[#145B4B]/60 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'Đang quét DEX Solana...' : 'Quét DEX Solana trực tiếp'}
          </button>
        </div>
      </div>
    </header>
  );
};
