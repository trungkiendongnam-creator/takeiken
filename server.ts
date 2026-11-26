import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import {
  appendLog,
  computeDashboardStats,
  computeOvernightRecap,
  DB_PATH,
  db,
  evaluateVolatilityAlerts,
  getAgents,
  getBacktestDatasets,
  getBacktestSessions,
  getEquityHistory,
  getLiveTrades,
  getLogs,
  getNotifications,
  getOvernightStrategyConfig,
  getSetting,
  getTokens,
  getTrades,
  getVolatilityAlertRules,
  getWalletState,
  getWalletTransfers,
  initDatabase,
  insertLiveTrade,
  insertWalletTransfer,
  setSetting,
  updateLiveTradeStatus,
  updateWalletTransferStatus,
} from './server/db.ts';
import {
  executePaperSimulation,
  runLiveSolanaScanPipeline,
  runOvernightStrategyCycle,
} from './server/agentPipeline.ts';
import { fetchAndValidateHistoricalDataset, runBacktestOnDataset } from './server/backtestEngine.ts';
import { fetchLiveSolPrice } from './server/dexConnector.ts';
import {
  CURATED_SOLANA_TOKENS,
  broadcastSignedSolanaTx,
  buildJupiterSwapTransaction,
  buildSolanaTransferTransaction,
  fetchJupiterQuote,
  resolveTokenDecimalsAndAudit,
  simulateSolanaTransaction,
  verifySignatureOnChain,
} from './server/jupiterDex.ts';
import {
  getSolanaRpcHealth,
  isValidSolanaBase58,
  looksLikeSecretOrMnemonic,
  readWalletOnChain,
} from './server/solanaRpc.ts';
import type { DexRouterOption, DexTokenOption, TerminalSnapshot } from './src/types/terminal.ts';

initDatabase();

function buildSnapshot(): TerminalSnapshot {
  const notifications = getNotifications();
  const agents = getAgents();
  const tokens = getTokens();
  const trades = getTrades();
  const equityHistory = getEquityHistory();
  const logs = getLogs(100);
  const stats = computeDashboardStats();
  const wallet = getWalletState();
  const backtestDatasets = getBacktestDatasets();
  const backtestSessions = getBacktestSessions();
  const volatilityAlerts = getVolatilityAlertRules();

  return {
    appName: 'Grok Bot Terminal',
    version: 'v1.0-night',
    isRunning: getSetting('is_running', 'true') === 'true',
    mode: 'PAPER TRADING · READ-ONLY',
    startedAt: getSetting('started_at', new Date().toISOString()),
    solPriceUsd: Number(getSetting('sol_price_usd', '142.20')),
    solPriceSource: getSetting('sol_price_source', 'DexScreener Reference'),
    rpcLatencyMs: Number(getSetting('rpc_latency_ms', '33')),
    rpcSlot: Number(getSetting('rpc_slot', '312849200')),
    rpcEndpoint: getSetting('rpc_endpoint', 'https://api.mainnet-beta.solana.com'),
    totalLaunchesTracked: Number(getSetting('total_launches_tracked', '4353')),
    throughputMsgPerSec: getSetting('is_running', 'true') === 'true' ? 64 : 0,
    latestTicker: getSetting('latest_ticker', 'PROFIT TAKER · SOLD (SIM) $CLAUDIA 1.78x'),
    agents,
    tokens,
    trades,
    liveTrades: getLiveTrades(),
    walletTransfers: getWalletTransfers(),
    equityHistory,
    logs,
    notifications,
    unreadNotifications: notifications.filter((n) => !n.isRead).length,
    volatilityAlerts,
    stats,
    wallet,
    backtestDatasets,
    backtestSessions,
    overnightConfig: getOvernightStrategyConfig(),
    overnightRecap: computeOvernightRecap(),
  };
}

async function syncWalletReadOnly(params: {
  publicAddress: string;
  connectionMethod: 'PHANTOM_EXTENSION' | 'PHANTOM_MOBILE_QR' | 'PUBLIC_ADDRESS';
  deviceType: string;
}) {
  const addr = params.publicAddress.trim();
  if (looksLikeSecretOrMnemonic(addr)) {
    appendLog({
      agentId: 'SYSTEM',
      agentName: 'SECURITY GUARD',
      eventType: 'WARN',
      message: 'Rejected secret/mnemonic input on wallet connect',
      reason: 'Private keys & seed phrases are strictly prohibited.',
      resultBadge: 'REJECTED',
      isPositive: false,
    });
    throw new Error('CHẶN BẢO MẬT: Tuyệt đối không nhập Seed Phrase hoặc Private Key. Chỉ hỗ trợ địa chỉ Solana công khai.');
  }
  if (!isValidSolanaBase58(addr)) {
    throw new Error('ĐỊA CHỈ KHÔNG HỢP LỆ: Địa chỉ công khai Solana Base58 không đúng định dạng.');
  }

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE WalletConnections SET is_active = 0').run();
  db.prepare(
    'INSERT INTO WalletConnections (connection_method, device_type, public_address, network, is_active, connected_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(params.connectionMethod, params.deviceType, addr, 'Solana Mainnet-Beta', nowIso);

  try {
    const chain = await readWalletOnChain(addr);
    setSetting('rpc_latency_ms', String(chain.latencyMs));

    db.prepare(`
      INSERT INTO SolanaBalances (public_address, network, sol_balance, rpc_status, rpc_error, last_synced_at)
      VALUES (?, 'Solana Mainnet-Beta', ?, 'OK', NULL, ?)
      ON CONFLICT(public_address) DO UPDATE SET
        sol_balance = excluded.sol_balance,
        rpc_status = 'OK',
        rpc_error = NULL,
        last_synced_at = excluded.last_synced_at
    `).run(addr, chain.solBalance, nowIso);

    db.prepare('DELETE FROM TokenAccounts WHERE owner_address = ?').run(addr);
    const insTok = db.prepare(`
      INSERT INTO TokenAccounts (owner_address, token_account, mint, symbol, amount, decimals, program)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ta of chain.tokenAccounts) {
      insTok.run(addr, ta.tokenAccount, ta.mint, ta.symbol, ta.amount, ta.decimals, ta.program);
    }

    appendLog({
      agentId: 'journal',
      agentName: 'PHANTOM READ-ONLY',
      eventType: 'INFO',
      message: `Connected ${addr.slice(0, 4)}...${addr.slice(-4)} (${params.connectionMethod})`,
      reason: `SOL: ${chain.solBalance} · ${chain.tokenAccounts.length} token accounts (Read-Only)`,
      resultBadge: 'READ-ONLY',
      isPositive: true,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Solana RPC error';
    const rpcStatus = errMsg.includes('RATE_LIMITED') ? 'RATE_LIMITED' : 'ERROR';
    // Never treat RPC failure as 0 balance: store NULL for sol_balance
    db.prepare(`
      INSERT INTO SolanaBalances (public_address, network, sol_balance, rpc_status, rpc_error, last_synced_at)
      VALUES (?, 'Solana Mainnet-Beta', NULL, ?, ?, ?)
      ON CONFLICT(public_address) DO UPDATE SET
        rpc_status = excluded.rpc_status,
        rpc_error = excluded.rpc_error,
        last_synced_at = excluded.last_synced_at
    `).run(addr, rpcStatus, errMsg, nowIso);

    appendLog({
      agentId: 'SYSTEM',
      agentName: 'SOLANA RPC',
      eventType: 'ERROR',
      message: `RPC read failed for ${addr.slice(0, 4)}...${addr.slice(-4)}`,
      reason: errMsg,
      resultBadge: rpcStatus,
      isPositive: false,
    });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/state', (_req, res) => {
    res.json(buildSnapshot());
  });

  app.get('/api/health', async (_req, res) => {
    const [rpc, solPrice] = await Promise.all([getSolanaRpcHealth(), fetchLiveSolPrice()]);
    if (rpc.ok && rpc.latencyMs !== null) {
      setSetting('rpc_latency_ms', String(rpc.latencyMs));
      if (rpc.slot !== null) setSetting('rpc_slot', String(rpc.slot));
    }
    if (solPrice.priceUsd > 0) {
      setSetting('sol_price_usd', solPrice.priceUsd.toFixed(2));
      setSetting('sol_price_source', solPrice.source);
    }
    res.json({ ok: true, rpc, solPrice, dbPath: DB_PATH });
  });

  app.post('/api/pipeline/toggle', (req, res) => {
    const nextState = typeof req.body?.isRunning === 'boolean'
      ? req.body.isRunning
      : getSetting('is_running', 'true') !== 'true';
    setSetting('is_running', nextState ? 'true' : 'false');
    appendLog({
      agentId: 'SYSTEM',
      agentName: 'GROK CORE',
      eventType: 'INFO',
      message: nextState ? 'Pipeline resumed (Paper Trading)' : 'Pipeline paused by operator',
      reason: 'Operator terminal toggle',
      resultBadge: nextState ? 'RUNNING' : 'PAUSED',
      isPositive: nextState,
    });
    res.json(buildSnapshot());
  });

  app.post('/api/pipeline/scan-live', async (_req, res) => {
    try {
      const result = await runLiveSolanaScanPipeline();
      res.json({ ok: true, result, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Quét DEX thất bại' });
    }
  });

  app.post('/api/overnight/config', (req, res) => {
    try {
      const { enabled, startTime, endTime, startBalanceUsd } = req.body ?? {};
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

      if (typeof enabled === 'boolean') {
        setSetting('overnight_enabled', enabled ? 'true' : 'false');
      }

      let nextStart = getSetting('overnight_start_time', '23:00');
      let nextEnd = getSetting('overnight_end_time', '07:00');

      if (typeof startTime === 'string') {
        const s = startTime.trim();
        if (!timeRegex.test(s)) {
          res.status(400).json({ ok: false, error: 'Giờ bắt đầu phải theo định dạng HH:mm (ví dụ 23:00).' });
          return;
        }
        nextStart = s;
      }

      if (typeof endTime === 'string') {
        const e = endTime.trim();
        if (!timeRegex.test(e)) {
          res.status(400).json({ ok: false, error: 'Giờ kết thúc phải theo định dạng HH:mm (ví dụ 07:00).' });
          return;
        }
        nextEnd = e;
      }

      if (nextStart === nextEnd) {
        res.status(400).json({ ok: false, error: 'Giờ bắt đầu và giờ kết thúc không được trùng nhau.' });
        return;
      }

      setSetting('overnight_start_time', nextStart);
      setSetting('overnight_end_time', nextEnd);
      setSetting('overnight_window', `${nextStart} → ${nextEnd}`);

      if (typeof startBalanceUsd === 'number' && Number.isFinite(startBalanceUsd)) {
        const clamped = Math.min(100000, Math.max(10, Number(startBalanceUsd)));
        setSetting('overnight_start_balance_usd', String(clamped));
      }

      const cfg = getOvernightStrategyConfig();
      appendLog({
        agentId: 'journal',
        agentName: 'OVERNIGHT CFG',
        eventType: 'INFO',
        message: `Cập nhật Kịch bản Qua đêm: ${cfg.enabled ? 'ĐANG BẬT' : 'ĐÃ TẮT'} · ${cfg.sessionWindow}`,
        reason: `Vốn chuẩn $${cfg.startBalanceUsd} · Lịch chạy do người dùng điều chỉnh`,
        resultBadge: cfg.enabled ? 'ON' : 'OFF',
        isPositive: cfg.enabled,
      });

      res.json({ ok: true, config: cfg, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Cập nhật cấu hình Phiên Đêm thất bại' });
    }
  });

  app.post('/api/overnight/run', async (req, res) => {
    try {
      const resetStart70 = Boolean(req.body?.resetStart70);
      const forceEnable = Boolean(req.body?.forceEnable);
      const result = await runOvernightStrategyCycle({ resetStart70, forceEnable });
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.summary, snapshot: buildSnapshot() });
        return;
      }
      res.json({ ok: true, result, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Lỗi chạy Kịch bản Phiên Đêm' });
    }
  });

  app.post('/api/paper/simulate', (req, res) => {
    const { mintAddress, action, equityPct, simulatedMultiplier } = req.body ?? {};
    if (typeof mintAddress !== 'string' || (action !== 'OPEN_SIM' && action !== 'CLOSE_SIM')) {
      res.status(400).json({ ok: false, error: 'Tham số mô phỏng không hợp lệ.' });
      return;
    }
    const result = executePaperSimulation({
      mintAddress,
      action,
      equityPct: typeof equityPct === 'number' ? equityPct : undefined,
      simulatedMultiplier: typeof simulatedMultiplier === 'number' ? simulatedMultiplier : undefined,
    });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.message });
      return;
    }
    res.json({ ok: true, message: result.message, snapshot: buildSnapshot() });
  });

  app.post('/api/paper/reset', (req, res) => {
    const startAmount = Math.min(100000, Math.max(10, Number(req.body?.startBalanceUsd ?? 50)));
    const nowIso = new Date().toISOString();
    const timeShort = nowIso.slice(11, 16);

    db.prepare('DELETE FROM PaperTrades').run();
    db.prepare('DELETE FROM EquityHistory').run();
    db.prepare('INSERT INTO EquityHistory (timestamp, label, balance_usd, pnl_delta_usd, note) VALUES (?, ?, ?, 0, ?)').run(
      nowIso,
      timeShort,
      startAmount,
      'Paper Trading balance reset'
    );

    setSetting('paper_start_balance_usd', startAmount.toFixed(2));
    setSetting('paper_balance_usd', startAmount.toFixed(2));
    setSetting('latest_ticker', `SYSTEM · PAPER BALANCE RESET TO $${startAmount.toFixed(2)}`);
    appendLog({
      agentId: 'journal',
      agentName: 'JOURNAL',
      eventType: 'INFO',
      message: `Paper Trading session reset to $${startAmount.toFixed(2)}`,
      reason: 'Operator requested fresh virtual session',
      resultBadge: 'RESET',
      isPositive: true,
    });

    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  const VALID_AGENT_IDS = new Set([
    'launch_radar',
    'whale_watch',
    'sentiment',
    'lp_auditor',
    'holder_map',
    'risk_sizer',
    'sniper',
    'profit_taker',
    'stop_guard',
    'journal',
  ]);
  const VALID_WINDOWS = new Set(['5m', '1h', '24h']);
  const VALID_DIRECTIONS = new Set(['ANY', 'UP', 'DOWN']);

  app.post('/api/alerts/rules', (req, res) => {
    const { agentId, window, direction, thresholdPct } = req.body ?? {};
    if (typeof agentId !== 'string' || !VALID_AGENT_IDS.has(agentId)) {
      res.status(400).json({ ok: false, error: 'Vui lòng chọn Agent hợp lệ.' });
      return;
    }
    const win = VALID_WINDOWS.has(window) ? String(window) : '1h';
    const dir = VALID_DIRECTIONS.has(direction) ? String(direction) : 'ANY';
    const pct = Number(thresholdPct);
    if (!Number.isFinite(pct) || pct < 0.5 || pct > 5000) {
      res.status(400).json({ ok: false, error: 'Ngưỡng biến động phải nằm trong khoảng từ 0.5% đến 5000%.' });
      return;
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO VolatilityAlertRules (agent_id, window, direction, threshold_pct, enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(agentId, win, dir, Number(pct.toFixed(2)), nowIso);

    evaluateVolatilityAlerts();
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.patch('/api/alerts/rules/:id', (req, res) => {
    const ruleId = Number(req.params.id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      res.status(400).json({ ok: false, error: 'Invalid rule ID.' });
      return;
    }
    const existing = db.prepare('SELECT id FROM VolatilityAlertRules WHERE id = ?').get(ruleId);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Alert rule not found.' });
      return;
    }

    if (typeof req.body?.enabled === 'boolean') {
      db.prepare('UPDATE VolatilityAlertRules SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, ruleId);
    }
    if (typeof req.body?.acknowledged === 'boolean') {
      db.prepare('UPDATE VolatilityAlertRules SET acknowledged = ? WHERE id = ?').run(req.body.acknowledged ? 1 : 0, ruleId);
    }
    if (typeof req.body?.thresholdPct === 'number') {
      const pct = Number(req.body.thresholdPct);
      if (Number.isFinite(pct) && pct >= 0.5 && pct <= 5000) {
        db.prepare('UPDATE VolatilityAlertRules SET threshold_pct = ? WHERE id = ?').run(Number(pct.toFixed(2)), ruleId);
      }
    }

    evaluateVolatilityAlerts();
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.delete('/api/alerts/rules/:id', (req, res) => {
    const ruleId = Number(req.params.id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      res.status(400).json({ ok: false, error: 'Invalid rule ID.' });
      return;
    }
    db.prepare('DELETE FROM VolatilityAlertRules WHERE id = ?').run(ruleId);
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.post('/api/alerts/acknowledge-all', (_req, res) => {
    db.prepare('UPDATE VolatilityAlertRules SET acknowledged = 1 WHERE is_triggered = 1').run();
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.post('/api/wallet/connect', async (req, res) => {
    try {
      const { publicAddress, connectionMethod, deviceType } = req.body ?? {};
      if (typeof publicAddress !== 'string') {
        res.status(400).json({ ok: false, error: 'publicAddress string is required.' });
        return;
      }
      const allowedMethods = ['PHANTOM_EXTENSION', 'PHANTOM_MOBILE_QR', 'PUBLIC_ADDRESS'];
      const method = allowedMethods.includes(connectionMethod) ? connectionMethod : 'PUBLIC_ADDRESS';
      await syncWalletReadOnly({
        publicAddress,
        connectionMethod: method,
        deviceType: typeof deviceType === 'string' ? deviceType.slice(0, 60) : 'Desktop Browser',
      });
      res.json({ ok: true, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Wallet connect failed' });
    }
  });

  app.post('/api/wallet/sync', async (_req, res) => {
    try {
      const current = getWalletState();
      if (!current.connected || !current.publicAddress) {
        res.status(400).json({ ok: false, error: 'No read-only wallet connected.' });
        return;
      }
      await syncWalletReadOnly({
        publicAddress: current.publicAddress,
        connectionMethod: current.connectionMethod === 'NONE' ? 'PUBLIC_ADDRESS' : current.connectionMethod,
        deviceType: current.deviceType,
      });
      res.json({ ok: true, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  app.post('/api/wallet/disconnect', (_req, res) => {
    db.prepare('UPDATE WalletConnections SET is_active = 0').run();
    appendLog({
      agentId: 'journal',
      agentName: 'PHANTOM READ-ONLY',
      eventType: 'INFO',
      message: 'Disconnected Read-Only wallet session',
      reason: 'User disconnected wallet',
      resultBadge: 'DISCONNECTED',
      isPositive: null,
    });
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.post('/api/wallet/qr-session', async (req, res) => {
    try {
      const code = crypto.randomBytes(8).toString('hex').toUpperCase();
      const expiresAt = Date.now() + 5 * 60 * 1000;
      const nowIso = new Date().toISOString();
      db.prepare(
        'INSERT INTO WalletQrSessions (code, status, public_address, device_label, expires_at, created_at) VALUES (?, ?, NULL, NULL, ?, ?)'
      ).run(code, 'PENDING', expiresAt, nowIso);

      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
      const pairUrl = `${proto}://${host}/?phantomPair=${code}`;
      const qrDataUrl = await QRCode.toDataURL(pairUrl, {
        width: 220,
        margin: 1,
        color: { dark: '#43D7B1', light: '#06231F' },
      });

      res.json({ ok: true, code, pairUrl, qrDataUrl, expiresAt });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'QR creation failed' });
    }
  });

  app.get('/api/wallet/qr-session/:code', (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    const row = db.prepare('SELECT * FROM WalletQrSessions WHERE code = ?').get(code) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ ok: false, error: 'Pairing code not found.' });
      return;
    }
    if (Date.now() > Number(row.expires_at) && row.status === 'PENDING') {
      db.prepare(`UPDATE WalletQrSessions SET status = 'EXPIRED' WHERE code = ?`).run(code);
      res.json({ ok: true, status: 'EXPIRED', publicAddress: null });
      return;
    }
    res.json({
      ok: true,
      status: String(row.status),
      publicAddress: row.public_address ? String(row.public_address) : null,
      expiresAt: Number(row.expires_at),
    });
  });

  app.post('/api/wallet/qr-session/:code/confirm', async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase();
      const publicAddress = String(req.body?.publicAddress || '').trim();
      const deviceLabel = String(req.body?.deviceLabel || 'Phantom Mobile Companion').slice(0, 60);

      const row = db.prepare('SELECT * FROM WalletQrSessions WHERE code = ?').get(code) as Record<string, unknown> | undefined;
      if (!row) {
        res.status(404).json({ ok: false, error: 'Pairing session not found.' });
        return;
      }
      if (String(row.status) !== 'PENDING') {
        res.status(400).json({ ok: false, error: `Mã ghép nối đã ở trạng thái ${String(row.status)}.` });
        return;
      }
      if (Date.now() > Number(row.expires_at)) {
        db.prepare(`UPDATE WalletQrSessions SET status = 'EXPIRED' WHERE code = ?`).run(code);
        res.status(400).json({ ok: false, error: 'Mã QR ghép nối đã hết hạn (giới hạn 5 phút).' });
        return;
      }

      if (looksLikeSecretOrMnemonic(publicAddress) || !isValidSolanaBase58(publicAddress)) {
        res.status(400).json({ ok: false, error: 'Vui lòng cung cấp địa chỉ công khai Solana hợp lệ (không nhập Private Key hoặc Seed Phrase).' });
        return;
      }

      db.prepare(`UPDATE WalletQrSessions SET status = 'CONFIRMED', public_address = ?, device_label = ? WHERE code = ?`).run(
        publicAddress,
        deviceLabel,
        code
      );

      await syncWalletReadOnly({
        publicAddress,
        connectionMethod: 'PHANTOM_MOBILE_QR',
        deviceType: deviceLabel,
      });

      res.json({ ok: true, status: 'CONFIRMED', publicAddress });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Mobile pairing failed' });
    }
  });

  app.post('/api/backtest/fetch-dataset', async (req, res) => {
    try {
      const { poolAddress, timeframe, limit } = req.body ?? {};
      if (typeof poolAddress !== 'string' || !isValidSolanaBase58(poolAddress)) {
        res.status(400).json({ ok: false, error: 'Vui lòng nhập địa chỉ Pool Solana (Base58) hợp lệ.' });
        return;
      }
      const tf = timeframe === 'minute' || timeframe === 'day' ? timeframe : 'hour';
      const dataset = await fetchAndValidateHistoricalDataset({
        poolAddress: poolAddress.trim(),
        timeframe: tf,
        limit: typeof limit === 'number' ? limit : 120,
      });
      res.json({ ok: true, dataset, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to fetch historical dataset' });
    }
  });

  app.post('/api/backtest/run', (req, res) => {
    try {
      const { datasetId, initialCapitalUsd, positionSizePct, stopLossPct, takeProfitX, trailingStopPct, feePct, slippagePct } = req.body ?? {};
      if (typeof datasetId !== 'string') {
        res.status(400).json({ ok: false, error: 'datasetId is required.' });
        return;
      }
      const session = runBacktestOnDataset({
        datasetId,
        initialCapitalUsd: Number(initialCapitalUsd ?? 50),
        positionSizePct: Number(positionSizePct ?? 10),
        stopLossPct: Number(stopLossPct ?? 12),
        takeProfitX: Number(takeProfitX ?? 1.8),
        trailingStopPct: Number(trailingStopPct ?? 22),
        feePct: Number(feePct ?? 0.5),
        slippagePct: Number(slippagePct ?? 0.5),
      });
      res.json({ ok: true, session, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Backtest execution failed' });
    }
  });

  app.post('/api/notifications/read', (_req, res) => {
    db.prepare('UPDATE Notifications SET is_read = 1').run();
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  // --- LIVE JUPITER DEX AGGREGATOR + PHANTOM NON-CUSTODIAL TRADING ---
  app.get('/api/dex/tokens', (_req, res) => {
    const tokens: DexTokenOption[] = [...CURATED_SOLANA_TOKENS];
    const seen = new Set(tokens.map((t) => t.mint));
    for (const scanned of getTokens()) {
      if (isValidSolanaBase58(scanned.mintAddress) && !seen.has(scanned.mintAddress)) {
        seen.add(scanned.mintAddress);
        tokens.push({
          mint: scanned.mintAddress,
          symbol: scanned.symbol.replace(/^\$/, ''),
          name: scanned.name,
          decimals: 6,
          verified: false,
          source: `Scanner (${scanned.dexId})`,
        });
      }
    }
    res.json({ ok: true, tokens });
  });

  app.get('/api/dex/mint-info/:mint', async (req, res) => {
    try {
      const info = await resolveTokenDecimalsAndAudit(String(req.params.mint || ''));
      res.json({ ok: true, info });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Không kiểm tra được Mint' });
    }
  });

  app.post('/api/dex/quote', async (req, res) => {
    try {
      const { inputMint, outputMint, amountUi, slippageBps, dexFilter } = req.body ?? {};
      if (typeof inputMint !== 'string' || typeof outputMint !== 'string') {
        res.status(400).json({ ok: false, error: 'Thiếu inputMint hoặc outputMint hợp lệ.' });
        return;
      }
      const allowedDex: DexRouterOption[] = ['AUTO', 'RAYDIUM', 'ORCA', 'METEORA', 'PUMP_FUN'];
      const router: DexRouterOption = allowedDex.includes(dexFilter) ? dexFilter : 'AUTO';
      const quote = await fetchJupiterQuote({
        inputMint,
        outputMint,
        amountUi: Number(amountUi),
        slippageBps: Number(slippageBps ?? 50),
        dexFilter: router,
      });
      res.json({ ok: true, quote });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Lấy báo giá Jupiter thất bại' });
    }
  });

  app.post('/api/dex/build-swap', async (req, res) => {
    try {
      const { userPublicKey, quoteResponse, priorityFeeLamports } = req.body ?? {};
      if (typeof userPublicKey !== 'string') {
        res.status(400).json({ ok: false, error: 'Thiếu địa chỉ ví Phantom công khai.' });
        return;
      }
      const built = await buildJupiterSwapTransaction({
        userPublicKey,
        quoteResponse,
        priorityFeeLamports: typeof priorityFeeLamports === 'number' ? priorityFeeLamports : 100_000,
      });
      appendLog({
        agentId: 'sniper',
        agentName: 'JUPITER DEX',
        eventType: 'INFO',
        message: `Khởi tạo giao dịch chưa ký cho ví ${userPublicKey.slice(0, 4)}...${userPublicKey.slice(-4)}`,
        reason: 'Chờ người dùng xác nhận ký trực tiếp trên Ví Phantom (Non-custodial)',
        resultBadge: 'UNSIGNED TX',
        isPositive: true,
      });
      res.json({ ok: true, ...built });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Tạo giao dịch Jupiter thất bại' });
    }
  });

  app.post('/api/dex/simulate', async (req, res) => {
    try {
      const { swapTransaction } = req.body ?? {};
      const sim = await simulateSolanaTransaction(String(swapTransaction || ''));
      res.json({ ok: true, simulation: sim });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Mô phỏng RPC thất bại' });
    }
  });

  app.post('/api/dex/broadcast', async (req, res) => {
    try {
      const { signedTransaction } = req.body ?? {};
      const signature = await broadcastSignedSolanaTx(String(signedTransaction || ''));
      res.json({ ok: true, signature });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Phát giao dịch thất bại' });
    }
  });

  app.post('/api/dex/record-tx', async (req, res) => {
    try {
      const {
        signature,
        walletAddress,
        routeLabels,
        inputMint,
        inputSymbol,
        inputAmount,
        outputMint,
        outputSymbol,
        outputAmountEst,
        slippageBps,
        priceImpactPct,
        priorityFeeLamports,
      } = req.body ?? {};

      if (typeof signature !== 'string' || typeof walletAddress !== 'string' || !isValidSolanaBase58(walletAddress)) {
        res.status(400).json({ ok: false, error: 'Thiếu signature hoặc walletAddress hợp lệ.' });
        return;
      }

      const check = await verifySignatureOnChain(signature);
      insertLiveTrade({
        signature: signature.trim(),
        walletAddress: walletAddress.trim(),
        dexAggregator: 'Jupiter Aggregator v1',
        routeLabels: String(routeLabels || 'Jupiter Best Route').slice(0, 120),
        inputMint: String(inputMint || ''),
        inputSymbol: String(inputSymbol || 'TOKEN').slice(0, 20),
        inputAmount: Number(inputAmount || 0),
        outputMint: String(outputMint || ''),
        outputSymbol: String(outputSymbol || 'TOKEN').slice(0, 20),
        outputAmountEst: Number(outputAmountEst || 0),
        slippageBps: Number(slippageBps || 50),
        priceImpactPct: Number(priceImpactPct || 0),
        priorityFeeLamports: Number(priorityFeeLamports || 100000),
        status: check.status,
        errorMessage: check.errorMessage,
      });

      appendLog({
        agentId: 'sniper',
        agentName: 'JUPITER LIVE',
        tokenSymbol: `$${String(outputSymbol || 'TOKEN').replace(/^\$/, '')}`,
        mintAddress: typeof outputMint === 'string' ? outputMint : null,
        eventType: 'BUY_SIM',
        message: `SWAP THẬT ${Number(inputAmount || 0)} ${String(inputSymbol)} → ${Number(outputAmountEst || 0)} ${String(outputSymbol)}`,
        reason: `Route: ${String(routeLabels || 'Jupiter')} · Tx: ${signature.slice(0, 8)}...`,
        resultBadge: check.status,
        isPositive: check.status !== 'FAILED',
      });

      db.prepare(
        'INSERT INTO Notifications (title, message, severity, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(
        `Giao dịch thật Jupiter DEX (${check.status})`,
        `${Number(inputAmount || 0)} ${String(inputSymbol)} → ~${Number(outputAmountEst || 0)} ${String(outputSymbol)} qua ${String(routeLabels || 'Jupiter')}.`,
        check.status === 'FAILED' ? 'ALERT' : 'INFO',
        new Date().toISOString()
      );

      // Refresh connected wallet balances if same wallet
      const currentWallet = getWalletState();
      if (currentWallet.connected && currentWallet.publicAddress === walletAddress.trim()) {
        await syncWalletReadOnly({
          publicAddress: walletAddress.trim(),
          connectionMethod: currentWallet.connectionMethod === 'NONE' ? 'PHANTOM_EXTENSION' : currentWallet.connectionMethod,
          deviceType: currentWallet.deviceType,
        }).catch(() => {});
      }

      res.json({ ok: true, status: check.status, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Lưu giao dịch thất bại' });
    }
  });

  app.post('/api/dex/refresh-tx/:signature', async (req, res) => {
    try {
      const sig = String(req.params.signature || '').trim();
      const check = await verifySignatureOnChain(sig);
      updateLiveTradeStatus(sig, check.status, check.errorMessage);
      if (check.status === 'CONFIRMED') {
        const currentWallet = getWalletState();
        if (currentWallet.connected && currentWallet.publicAddress) {
          await syncWalletReadOnly({
            publicAddress: currentWallet.publicAddress,
            connectionMethod: currentWallet.connectionMethod === 'NONE' ? 'PHANTOM_EXTENSION' : currentWallet.connectionMethod,
            deviceType: currentWallet.deviceType,
          }).catch(() => {});
        }
      }
      res.json({ ok: true, status: check.status, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Kiểm tra giao dịch thất bại' });
    }
  });

  // --- PHANTOM WALLET DEPOSIT & WITHDRAW (SOL & SPL ON-CHAIN) ---
  app.post('/api/wallet/deposit-qr', async (req, res) => {
    try {
      const { destinationAddress, amount, mintAddress } = req.body ?? {};
      const addr = String(destinationAddress || '').trim();
      if (looksLikeSecretOrMnemonic(addr) || !isValidSolanaBase58(addr)) {
        res.status(400).json({ ok: false, error: 'Địa chỉ Phantom nhận nạp tiền không hợp lệ.' });
        return;
      }
      const query = new URLSearchParams();
      const numAmount = Number(amount);
      if (Number.isFinite(numAmount) && numAmount > 0) {
        query.set('amount', String(numAmount));
      }
      const mint = typeof mintAddress === 'string' ? mintAddress.trim() : '';
      if (mint && mint !== 'So11111111111111111111111111111111111111112' && isValidSolanaBase58(mint)) {
        query.set('spl-token', mint);
      }
      query.set('label', 'Grok Bot Terminal');
      const qs = query.toString();
      const solanaPayUri = `solana:${addr}${qs ? `?${qs}` : ''}`;
      const qrDataUrl = await QRCode.toDataURL(solanaPayUri, {
        width: 220,
        margin: 1,
        color: { dark: '#39DEA2', light: '#031713' },
      });
      res.json({ ok: true, destinationAddress: addr, solanaPayUri, qrDataUrl });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Tạo mã QR nạp tiền thất bại' });
    }
  });

  app.post('/api/wallet/build-transfer', async (req, res) => {
    try {
      const { fromAddress, toAddress, mintAddress, amountUi } = req.body ?? {};
      const built = await buildSolanaTransferTransaction({
        fromAddress: String(fromAddress || ''),
        toAddress: String(toAddress || ''),
        mintAddress: String(mintAddress || 'So11111111111111111111111111111111111111112'),
        amountUi: Number(amountUi),
      });
      res.json({ ok: true, ...built });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Không khởi tạo được lệnh chuyển tiền Phantom' });
    }
  });

  app.post('/api/wallet/record-transfer', async (req, res) => {
    try {
      const {
        direction,
        assetSymbol,
        mintAddress,
        amount,
        fromAddress,
        toAddress,
        signature,
        note,
      } = req.body ?? {};

      const dir = direction === 'DEPOSIT' ? 'DEPOSIT' : 'WITHDRAW';
      const sig = String(signature || '').trim();
      const fromAddr = String(fromAddress || '').trim();
      const toAddr = String(toAddress || '').trim();

      if (!isValidSolanaBase58(fromAddr) || !isValidSolanaBase58(toAddr)) {
        res.status(400).json({ ok: false, error: 'Địa chỉ gửi/nhận không hợp lệ.' });
        return;
      }

      const check = await verifySignatureOnChain(sig);
      insertWalletTransfer({
        direction: dir,
        assetSymbol: String(assetSymbol || 'SOL').slice(0, 20),
        mintAddress: String(mintAddress || 'So11111111111111111111111111111111111111112'),
        amount: Number(amount || 0),
        fromAddress: fromAddr,
        toAddress: toAddr,
        signature: sig,
        status: check.status,
        note: typeof note === 'string' ? note.slice(0, 140) : null,
      });

      appendLog({
        agentId: 'journal',
        agentName: dir === 'DEPOSIT' ? 'PHANTOM NẠP' : 'PHANTOM RÚT',
        tokenSymbol: String(assetSymbol || 'SOL'),
        eventType: 'INFO',
        message: `${dir === 'DEPOSIT' ? 'NẠP VÀO PHANTOM' : 'RÚT VỀ VÍ PHANTOM'} ${Number(amount || 0)} ${String(assetSymbol || 'SOL')}`,
        reason: `${fromAddr.slice(0, 4)}... → ${toAddr.slice(0, 4)}... · Tx: ${sig.slice(0, 8)}...`,
        resultBadge: check.status,
        isPositive: check.status !== 'FAILED',
      });

      db.prepare(
        'INSERT INTO Notifications (title, message, severity, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(
        `${dir === 'DEPOSIT' ? 'Nạp tiền' : 'Rút về Ví Phantom'} (${check.status})`,
        `${Number(amount || 0)} ${String(assetSymbol || 'SOL')} → ${toAddr.slice(0, 6)}...${toAddr.slice(-4)}`,
        check.status === 'FAILED' ? 'ALERT' : 'INFO',
        new Date().toISOString()
      );

      const currentWallet = getWalletState();
      if (
        currentWallet.connected &&
        currentWallet.publicAddress &&
        (currentWallet.publicAddress === fromAddr || currentWallet.publicAddress === toAddr)
      ) {
        await syncWalletReadOnly({
          publicAddress: currentWallet.publicAddress,
          connectionMethod: currentWallet.connectionMethod === 'NONE' ? 'PHANTOM_EXTENSION' : currentWallet.connectionMethod,
          deviceType: currentWallet.deviceType,
        }).catch(() => {});
      }

      res.json({ ok: true, status: check.status, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Lưu lịch sử nạp/rút thất bại' });
    }
  });

  app.post('/api/wallet/refresh-transfer/:signature', async (req, res) => {
    try {
      const sig = String(req.params.signature || '').trim();
      const check = await verifySignatureOnChain(sig);
      updateWalletTransferStatus(sig, check.status);
      if (check.status === 'CONFIRMED') {
        const currentWallet = getWalletState();
        if (currentWallet.connected && currentWallet.publicAddress) {
          await syncWalletReadOnly({
            publicAddress: currentWallet.publicAddress,
            connectionMethod: currentWallet.connectionMethod === 'NONE' ? 'PHANTOM_EXTENSION' : currentWallet.connectionMethod,
            deviceType: currentWallet.deviceType,
          }).catch(() => {});
        }
      }
      res.json({ ok: true, status: check.status, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Làm mới trạng thái nạp/rút thất bại' });
    }
  });

  app.post('/api/backup/create', (_req, res) => {
    try {
      const backupDir = path.resolve(process.cwd(), 'data', 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `grok_bot_backup_${stamp}.db`;
      const targetPath = path.resolve(backupDir, fileName);
      if (!targetPath.startsWith(backupDir + path.sep)) {
        res.status(400).json({ ok: false, error: 'Invalid backup path.' });
        return;
      }
      fs.copyFileSync(DB_PATH, targetPath);
      db.prepare('INSERT INTO BackupHistory (backup_path, created_at, notes) VALUES (?, ?, ?)').run(
        targetPath,
        new Date().toISOString(),
        'Manual SQLite snapshot backup'
      );
      appendLog({
        agentId: 'journal',
        agentName: 'BACKUP',
        eventType: 'INFO',
        message: `Created SQLite backup ${fileName}`,
        reason: 'Operator snapshot verified',
        resultBadge: 'SAVED',
        isPositive: true,
      });
      res.json({ ok: true, fileName, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backup failed' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Grok Bot Terminal server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
