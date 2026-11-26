import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import {
  appendLog,
  computeDashboardStats,
  computeOvernightRecap,
  DB_PATH,
  db,
  evaluateAndEnforceDailyDrawdownGuard,
  evaluateVolatilityAlerts,
  getAgents,
  getBacktestDatasets,
  getBacktestSessions,
  getDailyDrawdownGuardState,
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
  restoreAgentsFromHalt,
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
import {
  getAuthStatus,
  loginWithPasscode,
  revokeBearerToken,
  setupFirstAdminPasscode,
  verifyBearerToken,
} from './server/auth.ts';
import type { DexRouterOption, DexTokenOption, TerminalSnapshot } from './src/types/terminal.ts';

initDatabase();

const SOLANA_SIG_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const QR_CODE_REGEX = /^[A-F0-9]{32}$/;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,80}$/;
const SAFE_HOST_REGEX = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
const TRUSTED_PROXY_SUFFIXES = [
  '.run.app',
  '.aistudio.google.com',
  '.googleusercontent.com',
  '.web.app',
  '.firebaseapp.com',
  '.appspot.com',
];

function isTrustedForwardedHost(host: string): boolean {
  if (!SAFE_HOST_REGEX.test(host) || host.includes('..')) return false;
  const hostname = host.split(':')[0].toLowerCase();
  if (process.env.APP_URL) {
    try {
      const configuredHost = new URL(process.env.APP_URL).host.toLowerCase();
      if (host.toLowerCase() === configuredHost) return true;
    } catch {
      // ignore invalid APP_URL
    }
  }
  return TRUSTED_PROXY_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function buildSafeBaseUrl(req: express.Request): string {
  if (process.env.APP_URL) {
    try {
      const parsed = new URL(process.env.APP_URL);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // fallback to request host validation
    }
  }

  const rawForwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto =
    rawForwardedProto === 'http' || rawForwardedProto === 'https'
      ? rawForwardedProto
      : req.protocol === 'https'
      ? 'https'
      : 'http';

  const rawHost = String(req.headers.host || '').split(',')[0].trim();
  const rawForwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();

  let safeHost = 'localhost:3000';
  if (rawForwardedHost && isTrustedForwardedHost(rawForwardedHost)) {
    safeHost = rawForwardedHost;
  } else if (rawHost && SAFE_HOST_REGEX.test(rawHost) && !rawHost.includes('..')) {
    safeHost = rawHost;
  }

  return `${proto}://${safeHost}`;
}

function parseFiniteInRange(
  raw: unknown,
  fallback: number | null,
  min: number,
  max: number,
  fieldName: string
): number {
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== null) return fallback;
    throw new Error(`Thiếu tham số số hợp lệ: ${fieldName}.`);
  }
  if (typeof raw === 'boolean' || (typeof raw === 'string' && raw.trim() === '')) {
    throw new Error(`Tham số ${fieldName} không phải số hợp lệ.`);
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`Giá trị ${fieldName} phải là số hữu hạn trong khoảng ${min}..${max}.`);
  }
  return num;
}

function createRateLimiter(maxRequests: number, windowMs: number): express.RequestHandler {
  const buckets = new Map<string, number[]>();
  return (req, res, next) => {
    const key = `${req.ip || req.socket.remoteAddress || 'local'}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({
        ok: false,
        error: 'Quá nhiều yêu cầu liên tiếp tới máy chủ. Vui lòng thử lại sau ít giây.',
      });
      return;
    }
    recent.push(now);
    if (buckets.size > 2000 && !buckets.has(key)) {
      buckets.clear();
    }
    buckets.set(key, recent);
    next();
  };
}

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
    mode: 'HYBRID: PAPER SIM + PHANTOM DEX',
    startedAt: getSetting('started_at', new Date().toISOString()),
    solPriceUsd: Number(getSetting('sol_price_usd', '142.20')),
    solPriceSource: getSetting('sol_price_source', 'DexScreener Reference'),
    rpcLatencyMs: Number(getSetting('rpc_latency_ms', '33')),
    rpcSlot: Number(getSetting('rpc_slot', '312849200')),
    rpcEndpoint: getSetting('rpc_endpoint', 'https://api.mainnet-beta.solana.com'),
    totalLaunchesTracked: Number(getSetting('total_launches_tracked', '0')),
    throughputMsgPerSec: getSetting('is_running', 'true') === 'true' ? 64 : 0,
    latestTicker: getSetting('latest_ticker', 'GROK BOT TERMINAL · DUAL MODE (PAPER + PHANTOM DEX)'),
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
    dailyDrawdownGuard: getDailyDrawdownGuardState(),
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

    const walletBadge = params.connectionMethod === 'PUBLIC_ADDRESS' ? 'WATCH-ONLY' : 'NON-CUSTODIAL';
    appendLog({
      agentId: 'journal',
      agentName: params.connectionMethod === 'PUBLIC_ADDRESS' ? 'WATCH-ONLY ADDRESS' : 'PHANTOM NON-CUSTODIAL',
      eventType: 'INFO',
      message: `Connected ${addr.slice(0, 4)}...${addr.slice(-4)} (${params.connectionMethod})`,
      reason: `SOL: ${chain.solBalance} · ${chain.tokenAccounts.length} token accounts (${walletBadge})`,
      resultBadge: walletBadge,
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
  app.disable('x-powered-by');

  // Security headers across all HTTP responses
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  // Block any web/HTTP access to database files or the data/ directory (including Vite /@fs/ or encoded paths)
  app.use((req, res, next) => {
    const rawTarget = req.originalUrl || req.url || req.path || '';
    let decoded = rawTarget;
    try {
      decoded = decodeURIComponent(rawTarget);
    } catch {
      res.status(403).json({ ok: false, error: 'Đường dẫn không hợp lệ.' });
      return;
    }
    const cleanPath = decoded.split('?')[0].replace(/\\/g, '/');
    const normalizedSegments = path.posix.normalize(cleanPath).toLowerCase();
    const isDbExtension = /\.(db|sqlite|sqlite3|db-wal|db-shm|db-journal)$/i.test(normalizedSegments);
    const touchesDataDir =
      normalizedSegments === '/data' ||
      normalizedSegments.startsWith('/data/') ||
      normalizedSegments.includes('/data/') ||
      normalizedSegments.endsWith('/data');

    if (isDbExtension || touchesDataDir) {
      res.status(403).json({ ok: false, error: 'Truy cập tệp cơ sở dữ liệu qua web bị chặn.' });
      return;
    }
    next();
  });

  app.use(express.json({ limit: '512kb' }));

  // Clean JSON parse error handler (no stack trace exposure)
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ ok: false, error: 'Dữ liệu JSON gửi lên không hợp lệ.' });
      return;
    }
    next(err);
  });

  // Cross-origin mutation guard for /api/*
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    try {
      const originUrl = new URL(origin);
      const isHttp = originUrl.protocol === 'http:' || originUrl.protocol === 'https:';
      const reqHost = String(req.headers.host || '').trim();
      const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
      const matchesHost = Boolean(reqHost && originUrl.host === reqHost);
      const matchesTrustedProxy = Boolean(
        forwardedHost && originUrl.host === forwardedHost && isTrustedForwardedHost(forwardedHost)
      );
      if (!isHttp || (!matchesHost && !matchesTrustedProxy)) {
        res.status(403).json({ ok: false, error: 'Chặn yêu cầu ghi dữ liệu từ nguồn (Origin) không hợp lệ.' });
        return;
      }
      next();
    } catch {
      res.status(403).json({ ok: false, error: 'Origin header không hợp lệ.' });
    }
  });

  const rpcDexRateLimit = createRateLimiter(45, 60_000);
  const heavyScanRateLimit = createRateLimiter(20, 60_000);
  const qrRateLimit = createRateLimiter(25, 60_000);
  const authRateLimit = createRateLimiter(12, 15 * 60_000);

  // Public Auth Endpoints (session bootstrap, login, logout)
  app.get('/api/auth/status', (req, res) => {
    res.json({ ok: true, ...getAuthStatus(req.headers.authorization) });
  });

  app.post('/api/auth/setup', authRateLimit, (req, res) => {
    try {
      const { token } = setupFirstAdminPasscode(req.body?.passcode);
      res.json({ ok: true, token });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Thiết lập mật khẩu thất bại.';
      const status = msg.includes('đã được thiết lập') || msg.includes('biến môi trường') ? 409 : 400;
      res.status(status).json({ ok: false, error: msg });
    }
  });

  app.post('/api/auth/login', authRateLimit, (req, res) => {
    try {
      const { token } = loginWithPasscode(req.body?.passcode);
      res.json({ ok: true, token });
    } catch (err) {
      res.status(401).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Đăng nhập thất bại.',
      });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    revokeBearerToken(req.headers.authorization);
    res.json({ ok: true });
  });

  // Mobile companion QR confirmation uses its own single-use 128-bit (32-hex) challenge token
  app.post('/api/wallet/qr-session/:code/confirm', qrRateLimit, async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      if (!QR_CODE_REGEX.test(code)) {
        res.status(400).json({ ok: false, error: 'Định dạng mã ghép nối QR không hợp lệ.' });
        return;
      }
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

  // Require verified Bearer session on all other /api/* endpoints
  app.use('/api', (req, res, next) => {
    if (!verifyBearerToken(req.headers.authorization)) {
      res.status(401).json({
        ok: false,
        error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập.',
      });
      return;
    }
    next();
  });

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
    res.json({ ok: true, rpc, solPrice });
  });

  app.post('/api/pipeline/toggle', (req, res) => {
    const nextState = typeof req.body?.isRunning === 'boolean'
      ? req.body.isRunning
      : getSetting('is_running', 'true') !== 'true';

    if (nextState) {
      const guard = evaluateAndEnforceDailyDrawdownGuard();
      if (guard.isHalted) {
        res.status(400).json({
          ok: false,
          error:
            guard.haltReason ??
            'Không thể bật lại luồng giao dịch khi đang kích hoạt ngắt mạch Maximum Daily Drawdown.',
          snapshot: buildSnapshot(),
        });
        return;
      }
      restoreAgentsFromHalt();
    }

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
    if (nextState) {
      void runLiveSolanaScanPipeline().catch(() => {});
    }
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.post('/api/pipeline/scan-live', heavyScanRateLimit, async (_req, res) => {
    try {
      const result = await runLiveSolanaScanPipeline();
      res.json({ ok: true, result, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Quét DEX thất bại' });
    }
  });

  app.post('/api/simulation/drawdown-config', (req, res) => {
    try {
      const { enabled, maxDailyDrawdownPct, minEquityThresholdUsd, clearHalt } = req.body ?? {};

      if (typeof enabled === 'boolean') {
        setSetting('sim_drawdown_guard_enabled', enabled ? 'true' : 'false');
      }

      if (maxDailyDrawdownPct !== undefined) {
        const clampedPct = parseFiniteInRange(maxDailyDrawdownPct, null, 1, 95, 'maxDailyDrawdownPct');
        const pctStr = String(Number(clampedPct.toFixed(1)));
        setSetting('sim_max_daily_drawdown_pct', pctStr);
        setSetting('overnight_daily_drawdown_pct', pctStr);
      }

      if (minEquityThresholdUsd !== undefined) {
        if (minEquityThresholdUsd === null || String(minEquityThresholdUsd).trim() === '') {
          setSetting('sim_min_equity_threshold_usd', '');
        } else {
          const clampedFloor = parseFiniteInRange(
            minEquityThresholdUsd,
            null,
            0,
            1_000_000,
            'minEquityThresholdUsd'
          );
          setSetting('sim_min_equity_threshold_usd', String(Number(clampedFloor.toFixed(2))));
        }
      }

      const guard = evaluateAndEnforceDailyDrawdownGuard({ allowClearIfHealthy: true });
      if (clearHalt && guard.isHalted) {
        res.status(400).json({
          ok: false,
          error: `Tài sản hiện tại ($${guard.totalPortfolioEquityUsd.toFixed(2)}) vẫn đang dưới ngưỡng ngắt mạch ($${guard.effectiveHaltThresholdUsd.toFixed(2)}). Hãy tăng giới hạn sụt giảm, hạ mức sàn Equity hoặc đặt lại vốn ảo.`,
          snapshot: buildSnapshot(),
        });
        return;
      }

      if (clearHalt && !guard.isHalted) {
        setSetting('is_running', 'true');
      }

      appendLog({
        agentId: 'stop_guard',
        agentName: 'DAILY DRAWDOWN GUARD',
        eventType: 'INFO',
        message: `Cập nhật giới hạn sụt giảm ngày: ${guard.enabled ? `-${guard.maxDailyDrawdownPct}%` : 'TẮT'}${guard.minEquityThresholdUsd !== null ? ` · Sàn $${guard.minEquityThresholdUsd.toFixed(2)}` : ''}`,
        reason: guard.isHalted
          ? `Đang kích hoạt ngắt mạch tại $${guard.effectiveHaltThresholdUsd.toFixed(2)}`
          : `Ngưỡng ngắt mạch hiện tại $${guard.effectiveHaltThresholdUsd.toFixed(2)}`,
        resultBadge: guard.isHalted ? 'HALTED' : guard.enabled ? 'ARMED' : 'OFF',
        isPositive: !guard.isHalted,
      });

      res.json({ ok: true, guard, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Cập nhật giới hạn sụt giảm ngày thất bại.',
      });
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

      if (startBalanceUsd !== undefined) {
        const clamped = parseFiniteInRange(startBalanceUsd, null, 10, 100000, 'startBalanceUsd');
        setSetting('overnight_start_balance_usd', String(Number(clamped.toFixed(2))));
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

  app.post('/api/paper/simulate', async (req, res) => {
    try {
      const { mintAddress, action, equityPct, simulatedMultiplier, exitPrice } = req.body ?? {};
      if (simulatedMultiplier !== undefined || exitPrice !== undefined) {
        res.status(400).json({
          ok: false,
          error: 'Không chấp nhận hệ số lợi nhuận hoặc giá đóng lệnh do client tự gửi lên. Hệ thống chỉ chốt theo giá thị trường thực tế.',
        });
        return;
      }
      if (
        typeof mintAddress !== 'string' ||
        !mintAddress.trim() ||
        mintAddress.trim().length > 64 ||
        (action !== 'OPEN_SIM' && action !== 'CLOSE_SIM')
      ) {
        res.status(400).json({ ok: false, error: 'Tham số mô phỏng không hợp lệ.' });
        return;
      }
      const validEquityPct =
        equityPct !== undefined ? parseFiniteInRange(equityPct, null, 0.5, 100, 'equityPct') : undefined;
      const result = await executePaperSimulation({
        mintAddress: mintAddress.trim(),
        action,
        equityPct: validEquityPct,
      });
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.message });
        return;
      }
      res.json({ ok: true, message: result.message, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Tham số mô phỏng không hợp lệ.' });
    }
  });

  app.post('/api/paper/reset', (req, res) => {
    try {
      const startAmount = parseFiniteInRange(req.body?.startBalanceUsd, 50, 10, 100000, 'startBalanceUsd');
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
      setSetting('sim_drawdown_halted', 'false');
      setSetting('sim_drawdown_halted_at', '');
      setSetting('sim_drawdown_halt_reason', '');
      setSetting('is_running', 'true');
      restoreAgentsFromHalt();
      evaluateAndEnforceDailyDrawdownGuard({ allowClearIfHealthy: true });
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
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Đặt lại vốn mô phỏng thất bại' });
    }
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
      agentName: 'PHANTOM WALLET',
      eventType: 'INFO',
      message: 'Disconnected wallet session',
      reason: 'User disconnected wallet',
      resultBadge: 'DISCONNECTED',
      isPositive: null,
    });
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.post('/api/wallet/qr-session', qrRateLimit, async (req, res) => {
    try {
      const code = crypto.randomBytes(16).toString('hex').toUpperCase();
      const expiresAt = Date.now() + 5 * 60 * 1000;
      const nowIso = new Date().toISOString();
      db.prepare(
        'INSERT INTO WalletQrSessions (code, status, public_address, device_label, expires_at, created_at) VALUES (?, ?, NULL, NULL, ?, ?)'
      ).run(code, 'PENDING', expiresAt, nowIso);

      const baseUrl = buildSafeBaseUrl(req);
      const pairUrl = `${baseUrl}/?phantomPair=${encodeURIComponent(code)}`;
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
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!QR_CODE_REGEX.test(code)) {
      res.status(400).json({ ok: false, error: 'Định dạng mã ghép nối QR không hợp lệ.' });
      return;
    }
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

  app.post('/api/backtest/fetch-dataset', heavyScanRateLimit, async (req, res) => {
    try {
      const { poolAddress, timeframe, limit } = req.body ?? {};
      if (typeof poolAddress !== 'string' || !isValidSolanaBase58(poolAddress.trim())) {
        res.status(400).json({ ok: false, error: 'Vui lòng nhập địa chỉ Pool Solana (Base58) hợp lệ.' });
        return;
      }
      const tf = timeframe === 'minute' || timeframe === 'day' ? timeframe : 'hour';
      const validLimit = Math.round(parseFiniteInRange(limit, 120, 20, 500, 'limit'));
      const dataset = await fetchAndValidateHistoricalDataset({
        poolAddress: poolAddress.trim(),
        timeframe: tf,
        limit: validLimit,
      });
      res.json({ ok: true, dataset, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to fetch historical dataset' });
    }
  });

  app.post('/api/backtest/run', (req, res) => {
    try {
      const { datasetId, initialCapitalUsd, positionSizePct, stopLossPct, takeProfitX, trailingStopPct, feePct, slippagePct } = req.body ?? {};
      if (typeof datasetId !== 'string' || !SAFE_ID_REGEX.test(datasetId.trim())) {
        res.status(400).json({ ok: false, error: 'datasetId không hợp lệ.' });
        return;
      }
      const session = runBacktestOnDataset({
        datasetId: datasetId.trim(),
        initialCapitalUsd: parseFiniteInRange(initialCapitalUsd, 50, 10, 1_000_000, 'initialCapitalUsd'),
        positionSizePct: parseFiniteInRange(positionSizePct, 10, 1, 100, 'positionSizePct'),
        stopLossPct: parseFiniteInRange(stopLossPct, 12, 1, 95, 'stopLossPct'),
        takeProfitX: parseFiniteInRange(takeProfitX, 1.8, 1.05, 100, 'takeProfitX'),
        trailingStopPct: parseFiniteInRange(trailingStopPct, 22, 1, 95, 'trailingStopPct'),
        feePct: parseFiniteInRange(feePct, 0.5, 0, 10, 'feePct'),
        slippagePct: parseFiniteInRange(slippagePct, 0.5, 0, 20, 'slippagePct'),
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

  app.get('/api/dex/mint-info/:mint', rpcDexRateLimit, async (req, res) => {
    try {
      const info = await resolveTokenDecimalsAndAudit(String(req.params.mint || ''));
      res.json({ ok: true, info });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Không kiểm tra được Mint' });
    }
  });

  app.post('/api/dex/quote', rpcDexRateLimit, async (req, res) => {
    try {
      const { inputMint, outputMint, amountUi, slippageBps, dexFilter } = req.body ?? {};
      if (typeof inputMint !== 'string' || typeof outputMint !== 'string') {
        res.status(400).json({ ok: false, error: 'Thiếu inputMint hoặc outputMint hợp lệ.' });
        return;
      }
      const validAmountUi = parseFiniteInRange(amountUi, null, 1e-9, 1_000_000_000, 'amountUi');
      const validSlippageBps = Math.round(parseFiniteInRange(slippageBps, 50, 10, 1500, 'slippageBps'));
      const allowedDex: DexRouterOption[] = ['AUTO', 'RAYDIUM', 'ORCA', 'METEORA', 'PUMP_FUN'];
      const router: DexRouterOption = allowedDex.includes(dexFilter) ? dexFilter : 'AUTO';
      const quote = await fetchJupiterQuote({
        inputMint,
        outputMint,
        amountUi: validAmountUi,
        slippageBps: validSlippageBps,
        dexFilter: router,
      });
      res.json({ ok: true, quote });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Lấy báo giá Jupiter thất bại' });
    }
  });

  app.post('/api/dex/build-swap', rpcDexRateLimit, async (req, res) => {
    try {
      const { userPublicKey, quoteResponse, priorityFeeLamports } = req.body ?? {};
      if (typeof userPublicKey !== 'string') {
        res.status(400).json({ ok: false, error: 'Thiếu địa chỉ ví Phantom công khai.' });
        return;
      }
      const validPriorityFee = Math.round(
        parseFiniteInRange(priorityFeeLamports, 100_000, 0, 5_000_000, 'priorityFeeLamports')
      );
      const built = await buildJupiterSwapTransaction({
        userPublicKey,
        quoteResponse,
        priorityFeeLamports: validPriorityFee,
      });
      appendLog({
        agentId: 'sniper',
        agentName: 'JUPITER DEX',
        eventType: 'INFO',
        message: `Khởi tạo giao dịch chưa ký cho ví ${userPublicKey.trim().slice(0, 4)}...${userPublicKey.trim().slice(-4)}`,
        reason: 'Chờ người dùng xác nhận ký trực tiếp trên Ví Phantom (Non-custodial)',
        resultBadge: 'UNSIGNED TX',
        isPositive: true,
      });
      res.json({ ok: true, ...built });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Tạo giao dịch Jupiter thất bại' });
    }
  });

  app.post('/api/dex/simulate', rpcDexRateLimit, async (req, res) => {
    try {
      const { swapTransaction } = req.body ?? {};
      const sim = await simulateSolanaTransaction(typeof swapTransaction === 'string' ? swapTransaction : '');
      res.json({ ok: true, simulation: sim });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Mô phỏng RPC thất bại' });
    }
  });

  app.post('/api/dex/broadcast', rpcDexRateLimit, async (req, res) => {
    try {
      const { signedTransaction } = req.body ?? {};
      const signature = await broadcastSignedSolanaTx(typeof signedTransaction === 'string' ? signedTransaction : '');
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

      const sigTrim = typeof signature === 'string' ? signature.trim() : '';
      const walletTrim = typeof walletAddress === 'string' ? walletAddress.trim() : '';
      const inMintTrim = typeof inputMint === 'string' ? inputMint.trim() : '';
      const outMintTrim = typeof outputMint === 'string' ? outputMint.trim() : '';

      if (
        !SOLANA_SIG_REGEX.test(sigTrim) ||
        !isValidSolanaBase58(walletTrim) ||
        !isValidSolanaBase58(inMintTrim) ||
        !isValidSolanaBase58(outMintTrim)
      ) {
        res.status(400).json({ ok: false, error: 'Thiếu signature, walletAddress hoặc địa chỉ Mint Solana hợp lệ.' });
        return;
      }

      const validInAmount = parseFiniteInRange(inputAmount, null, 1e-9, 1e12, 'inputAmount');
      const validOutEst = parseFiniteInRange(outputAmountEst, 0, 0, 1e12, 'outputAmountEst');
      const validSlippage = Math.round(parseFiniteInRange(slippageBps, 50, 0, 5000, 'slippageBps'));
      const validImpact = parseFiniteInRange(priceImpactPct, 0, -100, 100, 'priceImpactPct');
      const validPriority = Math.round(parseFiniteInRange(priorityFeeLamports, 100000, 0, 10_000_000, 'priorityFeeLamports'));

      const check = await verifySignatureOnChain(sigTrim);
      insertLiveTrade({
        signature: sigTrim,
        walletAddress: walletTrim,
        dexAggregator: 'Jupiter Aggregator v1',
        routeLabels: String(routeLabels || 'Jupiter Best Route').slice(0, 120),
        inputMint: inMintTrim,
        inputSymbol: String(inputSymbol || 'TOKEN').slice(0, 20),
        inputAmount: validInAmount,
        outputMint: outMintTrim,
        outputSymbol: String(outputSymbol || 'TOKEN').slice(0, 20),
        outputAmountEst: validOutEst,
        slippageBps: validSlippage,
        priceImpactPct: validImpact,
        priorityFeeLamports: validPriority,
        status: check.status,
        errorMessage: check.errorMessage,
      });

      appendLog({
        agentId: 'sniper',
        agentName: 'JUPITER LIVE',
        tokenSymbol: `$${String(outputSymbol || 'TOKEN').replace(/^\$/, '').slice(0, 18)}`,
        mintAddress: outMintTrim,
        eventType: 'BUY_SIM',
        message: `SWAP THẬT ${validInAmount} ${String(inputSymbol || 'TOKEN').slice(0, 18)} → ${validOutEst} ${String(outputSymbol || 'TOKEN').slice(0, 18)}`,
        reason: `Route: ${String(routeLabels || 'Jupiter').slice(0, 80)} · Tx: ${sigTrim.slice(0, 8)}...`,
        resultBadge: check.status,
        isPositive: check.status !== 'FAILED',
      });

      db.prepare(
        'INSERT INTO Notifications (title, message, severity, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(
        `Giao dịch thật Jupiter DEX (${check.status})`,
        `${validInAmount} ${String(inputSymbol || 'TOKEN').slice(0, 18)} → ~${validOutEst} ${String(outputSymbol || 'TOKEN').slice(0, 18)} qua ${String(routeLabels || 'Jupiter').slice(0, 80)}.`,
        check.status === 'FAILED' ? 'ALERT' : 'INFO',
        new Date().toISOString()
      );

      // Refresh connected wallet balances if same wallet
      const currentWallet = getWalletState();
      if (currentWallet.connected && currentWallet.publicAddress === walletTrim) {
        await syncWalletReadOnly({
          publicAddress: walletTrim,
          connectionMethod: currentWallet.connectionMethod === 'NONE' ? 'PHANTOM_EXTENSION' : currentWallet.connectionMethod,
          deviceType: currentWallet.deviceType,
        }).catch(() => {});
      }

      res.json({ ok: true, status: check.status, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Lưu giao dịch thất bại' });
    }
  });

  app.post('/api/dex/refresh-tx/:signature', rpcDexRateLimit, async (req, res) => {
    try {
      const sig = String(req.params.signature || '').trim();
      if (!SOLANA_SIG_REGEX.test(sig)) {
        res.status(400).json({ ok: false, error: 'Chữ ký giao dịch Solana (Signature) không hợp lệ.' });
        return;
      }
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
  app.post('/api/wallet/deposit-qr', qrRateLimit, async (req, res) => {
    try {
      const { destinationAddress, amount, mintAddress } = req.body ?? {};
      const addr = String(destinationAddress || '').trim();
      if (looksLikeSecretOrMnemonic(addr) || !isValidSolanaBase58(addr)) {
        res.status(400).json({ ok: false, error: 'Địa chỉ Phantom nhận nạp tiền không hợp lệ.' });
        return;
      }
      const query = new URLSearchParams();
      if (amount !== undefined && amount !== null && amount !== '') {
        const validAmount = parseFiniteInRange(amount, null, 1e-9, 1e12, 'amount');
        query.set('amount', String(validAmount));
      }
      const mint = typeof mintAddress === 'string' ? mintAddress.trim() : '';
      if (mint) {
        if (!isValidSolanaBase58(mint)) {
          res.status(400).json({ ok: false, error: 'Địa chỉ Mint tài sản không hợp lệ.' });
          return;
        }
        if (mint !== 'So11111111111111111111111111111111111111112') {
          query.set('spl-token', mint);
        }
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

  app.post('/api/wallet/build-transfer', rpcDexRateLimit, async (req, res) => {
    try {
      const { fromAddress, toAddress, mintAddress, amountUi } = req.body ?? {};
      const validAmountUi = parseFiniteInRange(amountUi, null, 1e-9, 1e12, 'amountUi');
      const built = await buildSolanaTransferTransaction({
        fromAddress: String(fromAddress || ''),
        toAddress: String(toAddress || ''),
        mintAddress: String(mintAddress || 'So11111111111111111111111111111111111111112'),
        amountUi: validAmountUi,
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

      if (direction !== 'DEPOSIT' && direction !== 'WITHDRAW') {
        res.status(400).json({ ok: false, error: 'Loại giao dịch phải là DEPOSIT hoặc WITHDRAW.' });
        return;
      }
      const dir = direction;
      const sig = String(signature || '').trim();
      const fromAddr = String(fromAddress || '').trim();
      const toAddr = String(toAddress || '').trim();
      const mintAddr = String(mintAddress || 'So11111111111111111111111111111111111111112').trim();

      if (!SOLANA_SIG_REGEX.test(sig) || !isValidSolanaBase58(fromAddr) || !isValidSolanaBase58(toAddr) || !isValidSolanaBase58(mintAddr)) {
        res.status(400).json({ ok: false, error: 'Địa chỉ ví, Mint tài sản hoặc chữ ký giao dịch không hợp lệ.' });
        return;
      }

      const validAmount = parseFiniteInRange(amount, null, 1e-9, 1e12, 'amount');
      const cleanSymbol = String(assetSymbol || 'SOL').slice(0, 20);

      const check = await verifySignatureOnChain(sig);
      insertWalletTransfer({
        direction: dir,
        assetSymbol: cleanSymbol,
        mintAddress: mintAddr,
        amount: validAmount,
        fromAddress: fromAddr,
        toAddress: toAddr,
        signature: sig,
        status: check.status,
        note: typeof note === 'string' ? note.slice(0, 140) : null,
      });

      appendLog({
        agentId: 'journal',
        agentName: dir === 'DEPOSIT' ? 'PHANTOM NẠP' : 'PHANTOM RÚT',
        tokenSymbol: cleanSymbol,
        eventType: 'INFO',
        message: `${dir === 'DEPOSIT' ? 'NẠP VÀO PHANTOM' : 'RÚT VỀ VÍ PHANTOM'} ${validAmount} ${cleanSymbol}`,
        reason: `${fromAddr.slice(0, 4)}... → ${toAddr.slice(0, 4)}... · Tx: ${sig.slice(0, 8)}...`,
        resultBadge: check.status,
        isPositive: check.status !== 'FAILED',
      });

      db.prepare(
        'INSERT INTO Notifications (title, message, severity, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(
        `${dir === 'DEPOSIT' ? 'Nạp tiền' : 'Rút về Ví Phantom'} (${check.status})`,
        `${validAmount} ${cleanSymbol} → ${toAddr.slice(0, 6)}...${toAddr.slice(-4)}`,
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

  app.post('/api/wallet/refresh-transfer/:signature', rpcDexRateLimit, async (req, res) => {
    try {
      const sig = String(req.params.signature || '').trim();
      if (!SOLANA_SIG_REGEX.test(sig)) {
        res.status(400).json({ ok: false, error: 'Chữ ký giao dịch Solana (Signature) không hợp lệ.' });
        return;
      }
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

      // Flush WAL journal pages first, then create an atomic standalone snapshot with VACUUM INTO
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      const escapedTarget = targetPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escapedTarget}';`);

      const stat = fs.statSync(targetPath);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error('SQLite backup verification failed: empty backup file.');
      }

      const backupDb = new DatabaseSync(targetPath, { readOnly: true });
      let tableCount = 0;
      try {
        const sourceTables = db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
          .all() as Array<{ name: string }>;
        const backupTables = backupDb
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
          .all() as Array<{ name: string }>;
        tableCount = backupTables.length;
        if (backupTables.length !== sourceTables.length) {
          throw new Error(`Backup table mismatch: expected ${sourceTables.length}, got ${backupTables.length}`);
        }
      } finally {
        backupDb.close();
      }

      db.prepare('INSERT INTO BackupHistory (backup_path, created_at, notes) VALUES (?, ?, ?)').run(
        targetPath,
        new Date().toISOString(),
        `Atomic SQLite VACUUM snapshot (${tableCount} tables, ${stat.size} bytes)`
      );
      appendLog({
        agentId: 'journal',
        agentName: 'BACKUP',
        eventType: 'INFO',
        message: `Created full SQLite backup ${fileName}`,
        reason: `Verified ${tableCount} tables (${Math.round(stat.size / 1024)} KB)`,
        resultBadge: 'SAVED',
        isPositive: true,
      });
      res.json({ ok: true, fileName, tableCount, sizeBytes: stat.size, snapshot: buildSnapshot() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backup failed' });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(`
export function createHotContext() {
  return {
    accept() {},
    prune() {},
    dispose() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function updateStyle(id, css) {
  let el = document.querySelector(\`style[data-vite-dev-id="\${id}"]\`);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(el);
  }
  el.textContent = css;
}
export function removeStyle(id) {
  const el = document.querySelector(\`style[data-vite-dev-id="\${id}"]\`);
  if (el) el.remove();
}
export function injectQuery(url) {
  return url;
}
`);
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
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
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Grok Bot Terminal server running on http://0.0.0.0:${PORT}`);

    // Continuous autonomous Paper Trading & DEX scan loop while running and within Daily Drawdown limits
    let autoCycleRunning = false;
    const runAutoAgentCycle = async () => {
      if (autoCycleRunning) return;
      if (getSetting('is_running', 'true') !== 'true') return;
      const guard = evaluateAndEnforceDailyDrawdownGuard();
      if (guard.isHalted) return;

      autoCycleRunning = true;
      try {
        await runLiveSolanaScanPipeline();
      } catch {
        // Non-fatal network/RPC cycle error; next tick will retry cleanly
      } finally {
        autoCycleRunning = false;
      }
    };

    setTimeout(() => {
      void runAutoAgentCycle();
    }, 2500);
    setInterval(() => {
      void runAutoAgentCycle();
    }, 18_000);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
