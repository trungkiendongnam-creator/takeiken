import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FlaskConical,
  Play,
} from 'lucide-react';
import type { BacktestSessionRecord, TerminalSnapshot } from '../types/terminal';

interface BacktestPanelProps {
  snapshot: TerminalSnapshot;
  onRefreshState: (next: TerminalSnapshot) => void;
}

const PRESET_SOLANA_POOLS = [
  {
    label: 'SOL / USDC (Raydium Mainnet)',
    address: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
  },
  {
    label: 'WIF / SOL (Raydium Mainnet)',
    address: 'EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx',
  },
  {
    label: 'BONK / SOL (Raydium Mainnet)',
    address: '8QaXeHBrShJTdtN1rWHbp3pH9vS9z1Q9F1xL7r4Q9xN1',
  },
];

export const BacktestPanel: React.FC<BacktestPanelProps> = ({
  snapshot,
  onRefreshState,
}) => {
  const [poolAddress, setPoolAddress] = useState(PRESET_SOLANA_POOLS[0].address);
  const [timeframe, setTimeframe] = useState<'minute' | 'hour' | 'day'>('hour');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(
    snapshot.backtestDatasets[0]?.id ?? ''
  );
  const [initialCapital, setInitialCapital] = useState(50);
  const [sizePct, setSizePct] = useState(10);
  const [stopLossPct, setStopLossPct] = useState(12);
  const [takeProfitX, setTakeProfitX] = useState(1.5);
  const [trailingStopPct, setTrailingStopPct] = useState(22);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<BacktestSessionRecord | null>(
    snapshot.backtestSessions[0] ?? null
  );

  const handleFetchDataset = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await fetch('/api/backtest/fetch-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolAddress: poolAddress.trim(), timeframe, limit: 120 }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        dataset?: { id: string; recordCount: number; datasetHash: string };
        snapshot?: TerminalSnapshot;
      };
      if (!res.ok || !data.ok || !data.snapshot || !data.dataset) {
        throw new Error(data.error || 'Không thể tải dữ liệu lịch sử pool Solana');
      }
      onRefreshState(data.snapshot);
      setSelectedDatasetId(data.dataset.id);
      setInfoMsg(
        `Đã tải & kiểm định ${data.dataset.recordCount} nến OHLCV thật (${data.dataset.id}, SHA256: ${data.dataset.datasetHash}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi nhập tập dữ liệu');
    } finally {
      setBusy(false);
    }
  };

  const handleRunBacktest = async () => {
    if (!selectedDatasetId) {
      setErrorMsg('Hãy tải một tập dữ liệu lịch sử thật trước khi chạy kiểm thử.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: selectedDatasetId,
          initialCapitalUsd: initialCapital,
          positionSizePct: sizePct,
          stopLossPct,
          takeProfitX,
          trailingStopPct,
          feePct: 0.5,
          slippagePct: 0.5,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        session?: BacktestSessionRecord;
        snapshot?: TerminalSnapshot;
      };
      if (!res.ok || !data.ok || !data.snapshot || !data.session) {
        throw new Error(data.error || 'Lỗi thực thi Backtest');
      }
      onRefreshState(data.snapshot);
      setActiveSession(data.session);
      setInfoMsg(
        `Kiểm thử ${data.session.id} hoàn tất: ${data.session.totalTrades} lệnh · Lợi nhuận ${data.session.totalReturnPct}%`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi Backtest');
    } finally {
      setBusy(false);
    }
  };

  const parsedTrades = activeSession
    ? (JSON.parse(activeSession.tradesJson) as Array<{
        entryTime: string;
        exitTime: string;
        entryPrice: number;
        exitPrice: number;
        multiplier: number;
        pnlUsd: number;
        reason: string;
      }>)
    : [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EAC64D]/40 bg-[#06231F] p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EAC64D]/15 text-[#EAC64D]">
            <FlaskConical className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#E6F2ED]">
              Kiểm thử Chiến lược (Backtest) — Dữ liệu lịch sử Solana DEX thật (GeckoTerminal OHLCV)
            </h2>
            <p className="mt-0.5 text-xs text-[#8FA9A0]">
              Mỗi tập dữ liệu được gắn Mã Dataset, SHA-256 Hash, kiểm tra chất lượng (thiếu dữ liệu, trùng thời gian, giá âm, thứ tự thời gian) và chạy vòng lặp chống nhìn trước tương lai (Anti-Lookahead) từng nến.
            </p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-[#EF6682] bg-[#EF6682]/10 p-3 text-xs text-[#EF6682]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {infoMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-[#39DEA2] bg-[#39DEA2]/10 p-3 text-xs text-[#39DEA2]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{infoMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Fetch Real Historical Dataset + Config */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
            <h3 className="text-xs font-bold tracking-wider text-[#E6F2ED]">
              BƯỚC 1: TẢI DỮ LIỆU LỊCH SỬ THẬT TỪ SOLANA DEX
            </h3>

            <div className="flex flex-wrap gap-1.5">
              {PRESET_SOLANA_POOLS.map((p) => (
                <button
                  key={p.address}
                  type="button"
                  onClick={() => setPoolAddress(p.address)}
                  className="rounded border border-[#145B4B] bg-[#092D27] px-2 py-1 text-[11px] text-[#43D7B1] hover:border-[#43D7B1] cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] text-[#8FA9A0]">Địa chỉ Pool Solana (Base58)</label>
              <input
                type="text"
                value={poolAddress}
                onChange={(e) => setPoolAddress(e.target.value)}
                className="w-full rounded-lg border border-[#145B4B] bg-[#031713] px-3 py-2 font-mono-tabular text-xs text-[#E6F2ED] focus:border-[#43D7B1] focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as 'minute' | 'hour' | 'day')}
                className="rounded-lg border border-[#145B4B] bg-[#031713] px-3 py-2 font-mono-tabular text-xs text-[#E6F2ED]"
              >
                <option value="minute">Nến 1 phút (120 thanh)</option>
                <option value="hour">Nến 1 giờ (120 thanh)</option>
                <option value="day">Nến 1 ngày (120 thanh)</option>
              </select>

              <button
                type="button"
                disabled={busy}
                onClick={handleFetchDataset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#43D7B1]/60 bg-[#092D27] px-3.5 py-2 text-xs font-semibold text-[#43D7B1] hover:bg-[#145B4B]/60 disabled:opacity-50 cursor-pointer"
              >
                <Database className="h-3.5 w-3.5" />
                {busy ? 'Đang tải...' : 'Tải & Kiểm định OHLCV'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
            <h3 className="text-xs font-bold tracking-wider text-[#E6F2ED]">
              BƯỚC 2: CẤU HÌNH CHIẾN LƯỢC & CHẠY KIỂM THỬ
            </h3>

            <div>
              <label className="block text-[11px] text-[#8FA9A0] mb-1">Tập dữ liệu đã kiểm định</label>
              <select
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                className="w-full rounded-lg border border-[#145B4B] bg-[#031713] px-3 py-2 font-mono-tabular text-xs text-[#E6F2ED]"
              >
                <option value="">-- Chọn tập dữ liệu --</option>
                {snapshot.backtestDatasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.id} ({ds.tokenSymbol} · {ds.recordCount} nến · {ds.qualityStatus})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5 font-mono-tabular text-xs">
              <label className="space-y-1">
                <span className="text-[11px] text-[#8FA9A0]">Vốn ảo ($)</span>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Number(e.target.value))}
                  className="w-full rounded border border-[#145B4B] bg-[#031713] px-2.5 py-1.5 text-[#E6F2ED]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-[#8FA9A0]">Tỷ trọng / lệnh (%)</span>
                <input
                  type="number"
                  value={sizePct}
                  onChange={(e) => setSizePct(Number(e.target.value))}
                  className="w-full rounded border border-[#145B4B] bg-[#031713] px-2.5 py-1.5 text-[#E6F2ED]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-[#8FA9A0]">Cắt lỗ cứng (%)</span>
                <input
                  type="number"
                  value={stopLossPct}
                  onChange={(e) => setStopLossPct(Number(e.target.value))}
                  className="w-full rounded border border-[#145B4B] bg-[#031713] px-2.5 py-1.5 text-[#E6F2ED]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-[#8FA9A0]">Chốt lời (×)</span>
                <input
                  type="number"
                  step="0.1"
                  value={takeProfitX}
                  onChange={(e) => setTakeProfitX(Number(e.target.value))}
                  className="w-full rounded border border-[#145B4B] bg-[#031713] px-2.5 py-1.5 text-[#E6F2ED]"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-[11px] text-[#8FA9A0]">Cắt lỗ trượt (%)</span>
                <input
                  type="number"
                  value={trailingStopPct}
                  onChange={(e) => setTrailingStopPct(Number(e.target.value))}
                  className="w-full rounded border border-[#145B4B] bg-[#031713] px-2.5 py-1.5 text-[#E6F2ED]"
                />
              </label>
            </div>

            <button
              type="button"
              disabled={busy || !selectedDatasetId}
              onClick={handleRunBacktest}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-[#EAC64D]/60 bg-[#EAC64D]/15 py-2.5 text-xs font-bold text-[#EAC64D] hover:bg-[#EAC64D]/25 disabled:opacity-40 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              Chạy Kiểm thử (Chống Look-ahead)
            </button>
          </div>
        </div>

        {/* Right: Datasets Manifest + Backtest Session Result */}
        <div className="lg:col-span-7 space-y-4">
          {/* Verified Datasets Table */}
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4">
            <h3 className="text-xs font-bold tracking-wider text-[#E6F2ED] mb-2.5">
              DANH MỤC TẬP DỮ LIỆU & KIỂM ĐỊNH CHẤT LƯỢNG ({snapshot.backtestDatasets.length})
            </h3>
            {snapshot.backtestDatasets.length === 0 ? (
              <div className="py-6 text-center font-mono-tabular text-xs text-[#8FA9A0]">
                Chưa có tập dữ liệu nào. Nhấn "Tải & Kiểm định OHLCV" để lấy dữ liệu lịch sử Solana thật.
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto space-y-2">
                {snapshot.backtestDatasets.map((ds) => (
                  <div
                    key={ds.id}
                    className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5 font-mono-tabular text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-[#43D7B1]">
                        {ds.id} · {ds.tokenSymbol}
                      </span>
                      <span
                        className={
                          ds.qualityStatus === 'VERIFIED'
                            ? 'text-[#39DEA2]'
                            : ds.qualityStatus === 'WARNING'
                            ? 'text-[#EAC64D]'
                            : 'text-[#EF6682]'
                        }
                      >
                        {ds.qualityStatus === 'VERIFIED' ? 'ĐẠT CHUẨN' : ds.qualityStatus === 'WARNING' ? 'CẢNH BÁO' : 'LỖI'} · Mã Hash: {ds.datasetHash}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-[#8FA9A0]">{ds.qualityNotes}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Backtest Result */}
          <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold tracking-wider text-[#E6F2ED]">
                KẾT QUẢ KIỂM THỬ ({snapshot.backtestSessions.length} VÒNG ĐÃ CHẠY)
              </h3>
              {snapshot.backtestSessions.length > 0 && (
                <select
                  value={activeSession?.id ?? ''}
                  onChange={(e) => {
                    const found = snapshot.backtestSessions.find((s) => s.id === e.target.value);
                    if (found) setActiveSession(found);
                  }}
                  className="rounded border border-[#145B4B] bg-[#031713] px-2 py-1 font-mono-tabular text-xs text-[#E6F2ED]"
                >
                  {snapshot.backtestSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.tokenSymbol} ({s.totalReturnPct}%)
                    </option>
                  ))}
                </select>
              )}
            </div>

            {!activeSession ? (
              <div className="py-8 text-center font-mono-tabular text-xs text-[#8FA9A0]">
                Chưa có vòng kiểm thử nào được chạy.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono-tabular">
                  <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                    <div className="text-[10px] text-[#8FA9A0]">Vốn cuối kỳ</div>
                    <div className="text-base font-bold text-[#E6F2ED]">
                      ${activeSession.finalCapitalUsd.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                    <div className="text-[10px] text-[#8FA9A0]">Tổng lợi nhuận</div>
                    <div
                      className={`text-base font-bold ${
                        activeSession.totalReturnPct >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'
                      }`}
                    >
                      {activeSession.totalReturnPct >= 0 ? '+' : ''}
                      {activeSession.totalReturnPct}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                    <div className="text-[10px] text-[#8FA9A0]">Tỷ lệ thắng</div>
                    <div className="text-base font-bold text-[#A986F5]">
                      {activeSession.winRatePct}% ({activeSession.wins}T/{activeSession.losses}B)
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#145B4B]/70 bg-[#031713] p-2.5">
                    <div className="text-[10px] text-[#8FA9A0]">Sụt giảm tối đa</div>
                    <div className="text-base font-bold text-[#EF6682]">
                      -{activeSession.maxDrawdownPct}%
                    </div>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-lg border border-[#145B4B]/70 bg-[#031713]">
                  {parsedTrades.length === 0 ? (
                    <div className="p-4 text-center font-mono-tabular text-xs text-[#8FA9A0]">
                      Không có tín hiệu vào lệnh thỏa điều kiện trong giai đoạn lịch sử này.
                    </div>
                  ) : (
                    <table className="w-full text-left font-mono-tabular text-[11px]">
                      <thead className="bg-[#06231F] text-[#8FA9A0]">
                        <tr>
                          <th className="px-2.5 py-1.5">Vào lệnh</th>
                          <th className="px-2.5 py-1.5">Thoát lệnh</th>
                          <th className="px-2.5 py-1.5">Hệ số</th>
                          <th className="px-2.5 py-1.5">Lãi/Lỗ</th>
                          <th className="px-2.5 py-1.5">Lý do</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#145B4B]/40">
                        {parsedTrades.map((tr, i) => (
                          <tr key={i}>
                            <td className="px-2.5 py-1.5 text-[#8FA9A0]">
                              {tr.entryTime.slice(5, 16).replace('T', ' ')}
                            </td>
                            <td className="px-2.5 py-1.5 text-[#8FA9A0]">
                              {tr.exitTime.slice(5, 16).replace('T', ' ')}
                            </td>
                            <td className="px-2.5 py-1.5 text-[#E6F2ED]">{tr.multiplier}×</td>
                            <td
                              className={`px-2.5 py-1.5 font-semibold ${
                                tr.pnlUsd >= 0 ? 'text-[#39DEA2]' : 'text-[#EF6682]'
                              }`}
                            >
                              {tr.pnlUsd >= 0 ? '+' : '-'}${Math.abs(tr.pnlUsd).toFixed(2)}
                            </td>
                            <td className="px-2.5 py-1.5 text-[#E6F2ED]">{tr.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
