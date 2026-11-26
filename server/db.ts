import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentRecord,
  BacktestDatasetRecord,
  BacktestSessionRecord,
  DailyDrawdownGuardState,
  DashboardStats,
  EquityPoint,
  LiveTradeRecord,
  NotificationItem,
  OvernightRecap,
  OvernightStrategyConfig,
  OvernightTopCoin,
  PaperTradeRecord,
  SystemLogEntry,
  TokenAccountInfo,
  TokenFlowItem,
  VolatilityAlertRule,
  WalletReadOnlyState,
  WalletTransferRecord,
} from '../src/types/terminal.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'grok_bot_terminal.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS SystemSettings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Agents (
      id TEXT PRIMARY KEY,
      order_index INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      vi_name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      color TEXT NOT NULL,
      metric_primary TEXT NOT NULL,
      metric_secondary TEXT NOT NULL,
      last_error TEXT,
      events_processed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS WalletConnections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_method TEXT NOT NULL,
      device_type TEXT NOT NULL,
      public_address TEXT NOT NULL,
      network TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      connected_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS WalletQrSessions (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      public_address TEXT,
      device_label TEXT,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS SolanaBalances (
      public_address TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      sol_balance REAL,
      rpc_status TEXT NOT NULL,
      rpc_error TEXT,
      last_synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS TokenAccounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_address TEXT NOT NULL,
      token_account TEXT NOT NULL,
      mint TEXT NOT NULL,
      symbol TEXT NOT NULL,
      amount REAL NOT NULL,
      decimals INTEGER NOT NULL,
      program TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS TokenMetadata (
      mint_address TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      pair_address TEXT NOT NULL,
      dex_id TEXT NOT NULL,
      price_usd REAL NOT NULL,
      price_change_5m REAL NOT NULL,
      price_change_1h REAL NOT NULL,
      price_change_24h REAL NOT NULL,
      liquidity_usd REAL NOT NULL,
      volume_24h_usd REAL NOT NULL,
      fdv_usd REAL NOT NULL,
      holders_count INTEGER NOT NULL,
      bonding_curve_pct REAL NOT NULL,
      mint_authority_revoked INTEGER,
      freeze_authority_revoked INTEGER,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      detected_ago TEXT NOT NULL,
      whale_inflow_usd REAL NOT NULL DEFAULT 0,
      sentiment_velocity TEXT NOT NULL DEFAULT 'normal',
      reason TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS PaperTrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint_address TEXT NOT NULL,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      reference_price_usd REAL NOT NULL,
      entry_price_sim_usd REAL NOT NULL,
      exit_price_sim_usd REAL,
      quantity_sim REAL NOT NULL,
      equity_allocated_usd REAL NOT NULL,
      equity_pct REAL NOT NULL,
      fee_sim_usd REAL NOT NULL,
      slippage_pct REAL NOT NULL,
      pnl_usd REAL NOT NULL,
      multiplier REAL NOT NULL,
      mcap_usd REAL NOT NULL,
      liquidity_usd REAL NOT NULL,
      bonding_curve_pct REAL NOT NULL,
      holders_count INTEGER NOT NULL,
      reason TEXT NOT NULL,
      exit_reason TEXT,
      sparkline_json TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS EquityHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      label TEXT NOT NULL,
      balance_usd REAL NOT NULL,
      pnl_delta_usd REAL NOT NULL,
      note TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS SystemLogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      time_short TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      token_symbol TEXT,
      mint_address TEXT,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      reason TEXT NOT NULL,
      result_badge TEXT NOT NULL,
      is_positive INTEGER
    );

    CREATE TABLE IF NOT EXISTS Notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS BacktestDatasets (
      id TEXT PRIMARY KEY,
      pool_address TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      token_name TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      source TEXT NOT NULL,
      dataset_hash TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      quality_status TEXT NOT NULL,
      quality_notes TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS HistoricalMarketData (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      FOREIGN KEY (dataset_id) REFERENCES BacktestDatasets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_hist_dataset_ts ON HistoricalMarketData(dataset_id, ts);

    CREATE TABLE IF NOT EXISTS BacktestSessions (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      software_version TEXT NOT NULL,
      initial_capital_usd REAL NOT NULL,
      final_capital_usd REAL NOT NULL,
      total_return_pct REAL NOT NULL,
      total_trades INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      win_rate_pct REAL NOT NULL,
      max_drawdown_pct REAL NOT NULL,
      stop_loss_pct REAL NOT NULL,
      take_profit_x REAL NOT NULL,
      trailing_stop_pct REAL NOT NULL,
      fee_pct REAL NOT NULL,
      slippage_pct REAL NOT NULL,
      status TEXT NOT NULL,
      notes TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS BackupHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notes TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS VolatilityAlertRules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      window TEXT NOT NULL,
      direction TEXT NOT NULL,
      threshold_pct REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_triggered INTEGER NOT NULL DEFAULT 0,
      triggered_symbol TEXT,
      triggered_change_pct REAL,
      last_triggered_at TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS LiveTrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT UNIQUE NOT NULL,
      wallet_address TEXT NOT NULL,
      dex_aggregator TEXT NOT NULL,
      route_labels TEXT NOT NULL,
      input_mint TEXT NOT NULL,
      input_symbol TEXT NOT NULL,
      input_amount REAL NOT NULL,
      output_mint TEXT NOT NULL,
      output_symbol TEXT NOT NULL,
      output_amount_est REAL NOT NULL,
      slippage_bps INTEGER NOT NULL,
      price_impact_pct REAL NOT NULL,
      priority_fee_lamports INTEGER NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS WalletTransfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      asset_symbol TEXT NOT NULL,
      mint_address TEXT NOT NULL,
      amount REAL NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      signature TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS AuthCredentials (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS AuthSessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const tokenCols = db.prepare('PRAGMA table_info(TokenMetadata)').all() as Array<{ name: string }>;
  const existingCols = new Set(tokenCols.map((c) => c.name));
  if (!existingCols.has('volume_5m_usd')) {
    db.exec('ALTER TABLE TokenMetadata ADD COLUMN volume_5m_usd REAL NOT NULL DEFAULT 0');
  }
  if (!existingCols.has('volume_1h_usd')) {
    db.exec('ALTER TABLE TokenMetadata ADD COLUMN volume_1h_usd REAL NOT NULL DEFAULT 0');
  }
  if (!existingCols.has('buy_ratio_pct')) {
    db.exec('ALTER TABLE TokenMetadata ADD COLUMN buy_ratio_pct REAL NOT NULL DEFAULT 50');
  }
  if (!existingCols.has('pair_age_hours')) {
    db.exec('ALTER TABLE TokenMetadata ADD COLUMN pair_age_hours REAL');
  }

  const agentCount = (db.prepare('SELECT COUNT(*) as c FROM Agents').get() as { c: number }).c;
  if (agentCount === 0) {
    seedInitialTerminalState();
  }

  const alertRuleCount = (db.prepare('SELECT COUNT(*) as c FROM VolatilityAlertRules').get() as { c: number }).c;
  if (alertRuleCount === 0) {
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO VolatilityAlertRules (agent_id, window, direction, threshold_pct, enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run('launch_radar', '1h', 'ANY', 35, nowIso);
    db.prepare(`
      INSERT INTO VolatilityAlertRules (agent_id, window, direction, threshold_pct, enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run('stop_guard', '5m', 'DOWN', 10, nowIso);
  }

  evaluateVolatilityAlerts();
}

export function setSetting(key: string, value: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO SystemSettings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM SystemSettings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function seedInitialTerminalState() {
  const now = new Date().toISOString();
  const timeShort = now.slice(11, 16);

  const initialSettings: Array<[string, string]> = [
    ['is_running', 'true'],
    ['paper_start_balance_usd', '50.00'],
    ['paper_balance_usd', '50.00'],
    ['tokens_checked', '0'],
    ['blocked_count', '0'],
    ['total_launches_tracked', '0'],
    ['sol_price_usd', '0'],
    ['sol_price_source', 'Đang chờ đồng bộ DexScreener'],
    ['rpc_latency_ms', '0'],
    ['rpc_slot', '0'],
    ['rpc_endpoint', 'https://api.mainnet-beta.solana.com'],
    ['latest_ticker', 'GROK BOT TERMINAL · VỐN ẢO KHỞI TẠO $50.00 · CHƯA CÓ LỆNH'],
    ['started_at', now],
    ['sim_drawdown_guard_enabled', 'true'],
    ['sim_max_daily_drawdown_pct', '30'],
    ['sim_drawdown_halted', 'false'],
  ];
  for (const [k, v] of initialSettings) {
    setSetting(k, v);
  }

  const agentsSeed = [
    ['launch_radar', 1, '01', 'LAUNCH RADAR', 'Radar phát hiện token mới', 'pump.fun + Raydium launches', 'SCAN', '#FF9B45', 'sẵn sàng quét DEX thật', '0 pairs scanned', 0],
    ['whale_watch', 2, '02', 'WHALE WATCH', 'Theo dõi ví lớn', 'wallets > $50k moving in', 'TRACK', '#49A9ED', 'chờ dữ liệu luồng thật', 'public swaps tracked', 0],
    ['sentiment', 3, '03', 'SENTIMENT', 'Phân tích tâm lý thị trường', 'X + Telegram velocity', 'READ', '#EF6682', 'chờ động lượng 5m/1h', 'verified feed window', 0],
    ['lp_auditor', 4, '04', 'LP AUDITOR', 'Kiểm toán thanh khoản', 'LP lock · mint · freeze', 'AUDIT', '#EF6682', 'kiểm tra Mint/Freeze RPC', '0 blocked · strict RPC', 0],
    ['holder_map', 5, '05', 'HOLDER MAP', 'Bản đồ phân bổ người nắm giữ', 'clusters · fresh wallets', 'MAP', '#F28482', 'sẵn sàng phân tích', 'top holder risk check', 0],
    ['risk_sizer', 6, '06', 'RISK SIZER', 'Bộ tính quy mô và rủi ro', 'size by volatility · 2-4%', 'IDLE', '#A986F5', '4% of $50.00 (sim)', 'virtual cap enforced', 0],
    ['sniper', 7, '07', 'SNIPER', 'Bộ mô phỏng thực thi', 'entry under 400 ms (paper)', 'LIVE', '#39DEA2', 'flat · chưa mở lệnh', 'paper-only executor', 0],
    ['profit_taker', 8, '08', 'PROFIT TAKER', 'Bộ mô phỏng chốt lời', '2x · 5x · moonbag', 'LADDER', '#EAC64D', 'đóng theo giá DEX thật', 'ladder active', 0],
    ['stop_guard', 9, '09', 'STOP GUARD', 'Bộ giới hạn rủi ro', 'trail 22% · hard -12%', 'ARMED', '#FF7A59', 'chưa kích hoạt dừng lỗ', 'virtual equity guard', 0],
    ['journal', 10, '10', 'JOURNAL', 'Nhật ký và báo cáo', 'logs every fill', 'ACTIVE', '#49A9ED', '0 fills recorded', 'SQLite persisted', 0],
  ];

  const insertAgent = db.prepare(`
    INSERT INTO Agents (id, order_index, code, name, vi_name, description, status, color, metric_primary, metric_secondary, last_error, events_processed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  for (const a of agentsSeed) {
    insertAgent.run(...a, now);
  }

  db.prepare('INSERT INTO EquityHistory (timestamp, label, balance_usd, pnl_delta_usd, note) VALUES (?, ?, ?, ?, ?)').run(
    now,
    timeShort,
    50.0,
    0.0,
    'Khởi tạo phiên mô phỏng (Paper Trading $50.00)'
  );

  appendLog({
    agentId: 'journal',
    agentName: 'JOURNAL',
    eventType: 'INFO',
    message: 'Khởi tạo cơ sở dữ liệu sạch ($50.00 vốn ảo · 0 lệnh mẫu)',
    reason: 'Nhấn "Quét DEX Solana trực tiếp" để nạp cặp token thật từ thị trường',
    resultBadge: 'READY',
    isPositive: null,
  });

  const notifSeed: Array<[string, string, string, number, string]> = [
    [
      'Khởi tạo sạch: Mô phỏng Paper + Phantom Non-Custodial',
      'Số dư mô phỏng bắt đầu ở $50.00 (0 lệnh mẫu). Khu vực Giao dịch Thật qua Jupiter DEX & Ví Phantom tách biệt hoàn toàn và yêu cầu bạn tự ký xác nhận trên Phantom.',
      'INFO',
      0,
      now,
    ],
  ];
  const insertNotif = db.prepare('INSERT INTO Notifications (title, message, severity, is_read, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const nf of notifSeed) {
    insertNotif.run(...nf);
  }
}

export function getAgents(): AgentRecord[] {
  const rows = db.prepare('SELECT * FROM Agents ORDER BY order_index ASC').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as AgentRecord['id'],
    orderIndex: Number(r.order_index),
    code: String(r.code),
    name: String(r.name),
    viName: String(r.vi_name),
    description: String(r.description),
    status: String(r.status),
    color: String(r.color),
    metricPrimary: String(r.metric_primary),
    metricSecondary: String(r.metric_secondary),
    lastError: r.last_error ? String(r.last_error) : null,
    eventsProcessed: Number(r.events_processed),
    updatedAt: String(r.updated_at),
  }));
}

export function getTokens(): TokenFlowItem[] {
  const rows = db.prepare('SELECT * FROM TokenMetadata ORDER BY rowid DESC LIMIT 20').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    mintAddress: String(r.mint_address),
    symbol: String(r.symbol),
    name: String(r.name),
    pairAddress: String(r.pair_address),
    dexId: String(r.dex_id),
    priceUsd: Number(r.price_usd),
    priceChange5m: Number(r.price_change_5m),
    priceChange1h: Number(r.price_change_1h),
    priceChange24h: Number(r.price_change_24h),
    liquidityUsd: Number(r.liquidity_usd),
    volume24hUsd: Number(r.volume_24h_usd),
    volume5mUsd: Number(r.volume_5m_usd ?? 0),
    volume1hUsd: Number(r.volume_1h_usd ?? 0),
    buyRatioPct: Number(r.buy_ratio_pct ?? 50),
    pairAgeHours: r.pair_age_hours === null || r.pair_age_hours === undefined ? null : Number(r.pair_age_hours),
    fdvUsd: Number(r.fdv_usd),
    holdersCount: Number(r.holders_count),
    bondingCurvePct: Number(r.bonding_curve_pct),
    mintAuthorityRevoked: r.mint_authority_revoked === null ? null : Boolean(r.mint_authority_revoked),
    freezeAuthorityRevoked: r.freeze_authority_revoked === null ? null : Boolean(r.freeze_authority_revoked),
    riskLevel: r.risk_level as TokenFlowItem['riskLevel'],
    status: r.status as TokenFlowItem['status'],
    source: String(r.source),
    sourceTimestamp: String(r.source_timestamp),
    detectedAgo: String(r.detected_ago),
    whaleInflowUsd: Number(r.whale_inflow_usd),
    sentimentVelocity: String(r.sentiment_velocity),
    reason: String(r.reason),
  }));
}

export function getTrades(): PaperTradeRecord[] {
  const rows = db.prepare('SELECT * FROM PaperTrades ORDER BY id DESC LIMIT 50').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    mintAddress: String(r.mint_address),
    symbol: String(r.symbol),
    status: r.status as PaperTradeRecord['status'],
    riskLevel: String(r.risk_level),
    referencePriceUsd: Number(r.reference_price_usd),
    entryPriceSimUsd: Number(r.entry_price_sim_usd),
    exitPriceSimUsd: r.exit_price_sim_usd === null ? null : Number(r.exit_price_sim_usd),
    quantitySim: Number(r.quantity_sim),
    equityAllocatedUsd: Number(r.equity_allocated_usd),
    equityPct: Number(r.equity_pct),
    feeSimUsd: Number(r.fee_sim_usd),
    slippagePct: Number(r.slippage_pct),
    pnlUsd: Number(r.pnl_usd),
    multiplier: Number(r.multiplier),
    mcapUsd: Number(r.mcap_usd),
    liquidityUsd: Number(r.liquidity_usd),
    bondingCurvePct: Number(r.bonding_curve_pct),
    holdersCount: Number(r.holders_count),
    reason: String(r.reason),
    exitReason: r.exit_reason ? String(r.exit_reason) : null,
    sparkline: JSON.parse(String(r.sparkline_json)) as number[],
    openedAt: String(r.opened_at),
    closedAt: r.closed_at ? String(r.closed_at) : null,
  }));
}

export function getLiveTrades(): LiveTradeRecord[] {
  const rows = db.prepare('SELECT * FROM LiveTrades ORDER BY id DESC LIMIT 50').all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const signature = String(r.signature);
    return {
      id: Number(r.id),
      signature,
      walletAddress: String(r.wallet_address),
      dexAggregator: String(r.dex_aggregator),
      routeLabels: String(r.route_labels),
      inputMint: String(r.input_mint),
      inputSymbol: String(r.input_symbol),
      inputAmount: Number(r.input_amount),
      outputMint: String(r.output_mint),
      outputSymbol: String(r.output_symbol),
      outputAmountEst: Number(r.output_amount_est),
      slippageBps: Number(r.slippage_bps),
      priceImpactPct: Number(r.price_impact_pct),
      priorityFeeLamports: Number(r.priority_fee_lamports),
      status: String(r.status) as LiveTradeRecord['status'],
      errorMessage: r.error_message ? String(r.error_message) : null,
      solscanUrl: `https://solscan.io/tx/${encodeURIComponent(signature)}`,
      createdAt: String(r.created_at),
      confirmedAt: r.confirmed_at ? String(r.confirmed_at) : null,
    };
  });
}

export function insertLiveTrade(entry: {
  signature: string;
  walletAddress: string;
  dexAggregator: string;
  routeLabels: string;
  inputMint: string;
  inputSymbol: string;
  inputAmount: number;
  outputMint: string;
  outputSymbol: string;
  outputAmountEst: number;
  slippageBps: number;
  priceImpactPct: number;
  priorityFeeLamports: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  errorMessage?: string | null;
}) {
  const nowIso = new Date().toISOString();
  const confirmedAt = entry.status === 'CONFIRMED' ? nowIso : null;
  db.prepare(`
    INSERT INTO LiveTrades (
      signature, wallet_address, dex_aggregator, route_labels,
      input_mint, input_symbol, input_amount,
      output_mint, output_symbol, output_amount_est,
      slippage_bps, price_impact_pct, priority_fee_lamports,
      status, error_message, created_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET
      status = excluded.status,
      error_message = excluded.error_message,
      confirmed_at = COALESCE(excluded.confirmed_at, LiveTrades.confirmed_at)
  `).run(
    entry.signature,
    entry.walletAddress,
    entry.dexAggregator,
    entry.routeLabels,
    entry.inputMint,
    entry.inputSymbol,
    entry.inputAmount,
    entry.outputMint,
    entry.outputSymbol,
    entry.outputAmountEst,
    entry.slippageBps,
    entry.priceImpactPct,
    entry.priorityFeeLamports,
    entry.status,
    entry.errorMessage ?? null,
    nowIso,
    confirmedAt
  );
}

export function updateLiveTradeStatus(
  signature: string,
  status: 'PENDING' | 'CONFIRMED' | 'FAILED',
  errorMessage: string | null = null
) {
  const confirmedAt = status === 'CONFIRMED' ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE LiveTrades
    SET status = ?,
        error_message = ?,
        confirmed_at = COALESCE(?, confirmed_at)
    WHERE signature = ?
  `).run(status, errorMessage, confirmedAt, signature);
}

export function getWalletTransfers(): WalletTransferRecord[] {
  const rows = db.prepare('SELECT * FROM WalletTransfers ORDER BY id DESC LIMIT 50').all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const signature = String(r.signature);
    return {
      id: Number(r.id),
      direction: String(r.direction) as WalletTransferRecord['direction'],
      assetSymbol: String(r.asset_symbol),
      mintAddress: String(r.mint_address),
      amount: Number(r.amount),
      fromAddress: String(r.from_address),
      toAddress: String(r.to_address),
      signature,
      status: String(r.status) as WalletTransferRecord['status'],
      note: r.note ? String(r.note) : null,
      solscanUrl: `https://solscan.io/tx/${encodeURIComponent(signature)}`,
      createdAt: String(r.created_at),
      confirmedAt: r.confirmed_at ? String(r.confirmed_at) : null,
    };
  });
}

export function insertWalletTransfer(entry: {
  direction: 'DEPOSIT' | 'WITHDRAW';
  assetSymbol: string;
  mintAddress: string;
  amount: number;
  fromAddress: string;
  toAddress: string;
  signature: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  note?: string | null;
}) {
  const nowIso = new Date().toISOString();
  const confirmedAt = entry.status === 'CONFIRMED' ? nowIso : null;
  db.prepare(`
    INSERT INTO WalletTransfers (
      direction, asset_symbol, mint_address, amount, from_address, to_address,
      signature, status, note, created_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET
      status = excluded.status,
      note = COALESCE(excluded.note, WalletTransfers.note),
      confirmed_at = COALESCE(excluded.confirmed_at, WalletTransfers.confirmed_at)
  `).run(
    entry.direction,
    entry.assetSymbol,
    entry.mintAddress,
    entry.amount,
    entry.fromAddress,
    entry.toAddress,
    entry.signature,
    entry.status,
    entry.note ?? null,
    nowIso,
    confirmedAt
  );
}

export function updateWalletTransferStatus(
  signature: string,
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
) {
  const confirmedAt = status === 'CONFIRMED' ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE WalletTransfers
    SET status = ?,
        confirmed_at = COALESCE(?, confirmed_at)
    WHERE signature = ?
  `).run(status, confirmedAt, signature);
}

export function getEquityHistory(): EquityPoint[] {
  const rows = db.prepare('SELECT * FROM EquityHistory ORDER BY id ASC').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    timestamp: String(r.timestamp),
    label: String(r.label),
    balanceUsd: Number(r.balance_usd),
    pnlDeltaUsd: Number(r.pnl_delta_usd),
    note: String(r.note),
  }));
}

export function getLogs(limit = 80): SystemLogEntry[] {
  const rows = db.prepare('SELECT * FROM SystemLogs ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    timestamp: String(r.timestamp),
    timeShort: String(r.time_short),
    agentId: String(r.agent_id) as SystemLogEntry['agentId'],
    agentName: String(r.agent_name),
    tokenSymbol: r.token_symbol ? String(r.token_symbol) : null,
    mintAddress: r.mint_address ? String(r.mint_address) : null,
    eventType: String(r.event_type) as SystemLogEntry['eventType'],
    message: String(r.message),
    reason: String(r.reason),
    resultBadge: String(r.result_badge),
    isPositive: r.is_positive === null ? null : Boolean(r.is_positive),
  }));
}

export function getNotifications(): NotificationItem[] {
  const rows = db.prepare('SELECT * FROM Notifications ORDER BY id DESC LIMIT 30').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    message: String(r.message),
    severity: String(r.severity) as NotificationItem['severity'],
    isRead: Boolean(r.is_read),
    createdAt: String(r.created_at),
  }));
}

export function computeDashboardStats(): DashboardStats {
  const startBal = Number(getSetting('paper_start_balance_usd', '50'));
  const currentBal = Number(getSetting('paper_balance_usd', '50'));
  const tokensChecked = Number(getSetting('tokens_checked', '0'));
  const blockedCount = Number(getSetting('blocked_count', '0'));

  const closedTrades = db.prepare(`SELECT * FROM PaperTrades WHERE status = 'CLOSED' ORDER BY id DESC`).all() as Array<Record<string, unknown>>;
  const wins = closedTrades.filter((t) => Number(t.pnl_usd) > 0).length;
  const losses = closedTrades.filter((t) => Number(t.pnl_usd) <= 0).length;
  const totalTrades = closedTrades.length;
  const winRatePct = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;

  let bestMultiplier = 0;
  let bestSymbol = '—';
  let bestPnlUsd = 0;
  for (const t of closedTrades) {
    if (Number(t.multiplier) > bestMultiplier) {
      bestMultiplier = Number(t.multiplier);
      bestSymbol = String(t.symbol);
      bestPnlUsd = Number(t.pnl_usd);
    }
  }

  const lastSell = closedTrades[0];
  const totalPnlUsd = Number((currentBal - startBal).toFixed(2));
  const totalPnlPct = startBal > 0 ? Number(((totalPnlUsd / startBal) * 100).toFixed(1)) : 0;
  const blockedPct = tokensChecked > 0 ? Number(((blockedCount / tokensChecked) * 100).toFixed(1)) : 0;

  return {
    paperStartBalanceUsd: startBal,
    paperBalanceUsd: Number(currentBal.toFixed(2)),
    totalPnlUsd,
    totalPnlPct,
    totalTrades,
    wins,
    losses,
    winRatePct,
    tokensChecked,
    blockedCount,
    blockedPct,
    bestMultiplier: Number(bestMultiplier.toFixed(2)),
    bestSymbol,
    bestPnlUsd: Number(bestPnlUsd.toFixed(2)),
    lastSellPnlUsd: lastSell ? Number(Number(lastSell.pnl_usd).toFixed(2)) : 0,
    lastSellSymbol: lastSell ? String(lastSell.symbol) : '—',
    lastSellReason: lastSell && lastSell.exit_reason ? String(lastSell.exit_reason) : 'realized',
    lastSellTime: lastSell && lastSell.closed_at ? String(lastSell.closed_at) : '',
  };
}

export function getWalletState(): WalletReadOnlyState {
  const conn = db.prepare('SELECT * FROM WalletConnections WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined;
  if (!conn) {
    return {
      connected: false,
      connectionMethod: 'NONE',
      deviceType: 'None',
      publicAddress: null,
      shortAddress: null,
      network: 'Solana Mainnet-Beta',
      solBalance: null,
      rpcStatus: 'DISCONNECTED',
      rpcError: null,
      tokenAccounts: [],
      lastSyncedAt: null,
    };
  }

  const addr = String(conn.public_address);
  const bal = db.prepare('SELECT * FROM SolanaBalances WHERE public_address = ?').get(addr) as Record<string, unknown> | undefined;
  const tokens = db.prepare('SELECT * FROM TokenAccounts WHERE owner_address = ? ORDER BY amount DESC').all(addr) as Array<Record<string, unknown>>;

  return {
    connected: true,
    connectionMethod: String(conn.connection_method) as WalletReadOnlyState['connectionMethod'],
    deviceType: String(conn.device_type),
    publicAddress: addr,
    shortAddress: `${addr.slice(0, 4)}...${addr.slice(-4)}`,
    network: String(conn.network),
    solBalance: bal && bal.sol_balance !== null ? Number(bal.sol_balance) : null,
    rpcStatus: (bal ? String(bal.rpc_status) : 'OK') as WalletReadOnlyState['rpcStatus'],
    rpcError: bal && bal.rpc_error ? String(bal.rpc_error) : null,
    tokenAccounts: tokens.map((t): TokenAccountInfo => ({
      tokenAccount: String(t.token_account),
      mint: String(t.mint),
      symbol: String(t.symbol),
      amount: Number(t.amount),
      decimals: Number(t.decimals),
      program: String(t.program) as TokenAccountInfo['program'],
    })),
    lastSyncedAt: bal ? String(bal.last_synced_at) : String(conn.connected_at),
  };
}

export function getBacktestDatasets(): BacktestDatasetRecord[] {
  const rows = db.prepare('SELECT * FROM BacktestDatasets ORDER BY created_at DESC LIMIT 25').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    poolAddress: String(r.pool_address),
    tokenSymbol: String(r.token_symbol),
    tokenName: String(r.token_name),
    timeframe: String(r.timeframe),
    source: String(r.source),
    datasetHash: String(r.dataset_hash),
    recordCount: Number(r.record_count),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    qualityStatus: String(r.quality_status) as BacktestDatasetRecord['qualityStatus'],
    qualityNotes: String(r.quality_notes),
    createdAt: String(r.created_at),
  }));
}

export function getBacktestSessions(): BacktestSessionRecord[] {
  const rows = db.prepare('SELECT * FROM BacktestSessions ORDER BY created_at DESC LIMIT 25').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    datasetId: String(r.dataset_id),
    tokenSymbol: String(r.token_symbol),
    softwareVersion: String(r.software_version),
    initialCapitalUsd: Number(r.initial_capital_usd),
    finalCapitalUsd: Number(r.final_capital_usd),
    totalReturnPct: Number(r.total_return_pct),
    totalTrades: Number(r.total_trades),
    wins: Number(r.wins),
    losses: Number(r.losses),
    winRatePct: Number(r.win_rate_pct),
    maxDrawdownPct: Number(r.max_drawdown_pct),
    stopLossPct: Number(r.stop_loss_pct),
    takeProfitX: Number(r.take_profit_x),
    trailingStopPct: Number(r.trailing_stop_pct),
    feePct: Number(r.fee_pct),
    slippagePct: Number(r.slippage_pct),
    status: String(r.status) as BacktestSessionRecord['status'],
    notes: String(r.notes),
    tradesJson: String(r.trades_json),
    createdAt: String(r.created_at),
  }));
}

export function appendLog(entry: {
  agentId: string;
  agentName: string;
  tokenSymbol?: string | null;
  mintAddress?: string | null;
  eventType: SystemLogEntry['eventType'];
  message: string;
  reason: string;
  resultBadge: string;
  isPositive?: boolean | null;
}) {
  const now = new Date();
  const timeShort = now.toISOString().slice(11, 16);
  db.prepare(`
    INSERT INTO SystemLogs (timestamp, time_short, agent_id, agent_name, token_symbol, mint_address, event_type, message, reason, result_badge, is_positive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    now.toISOString(),
    timeShort,
    entry.agentId,
    entry.agentName,
    entry.tokenSymbol ?? null,
    entry.mintAddress ?? null,
    entry.eventType,
    entry.message,
    entry.reason,
    entry.resultBadge,
    entry.isPositive === undefined || entry.isPositive === null ? null : entry.isPositive ? 1 : 0
  );
}

export function updateAgentState(agentId: string, status: string, metricPrimary: string, metricSecondary: string, lastError: string | null = null) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE Agents
    SET status = ?, metric_primary = ?, metric_secondary = ?, last_error = ?, events_processed = events_processed + 1, updated_at = ?
    WHERE id = ?
  `).run(status, metricPrimary, metricSecondary, lastError, now, agentId);
}

export function getVolatilityAlertRules(): VolatilityAlertRule[] {
  const rows = db.prepare(`
    SELECT r.*, a.name as agent_name
    FROM VolatilityAlertRules r
    LEFT JOIN Agents a ON a.id = r.agent_id
    ORDER BY r.id DESC
  `).all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: Number(r.id),
    agentId: String(r.agent_id) as VolatilityAlertRule['agentId'],
    agentName: r.agent_name ? String(r.agent_name) : String(r.agent_id).toUpperCase(),
    window: String(r.window) as VolatilityAlertRule['window'],
    direction: String(r.direction) as VolatilityAlertRule['direction'],
    thresholdPct: Number(r.threshold_pct),
    enabled: Boolean(r.enabled),
    isTriggered: Boolean(r.is_triggered),
    triggeredSymbol: r.triggered_symbol ? String(r.triggered_symbol) : null,
    triggeredChangePct: r.triggered_change_pct === null ? null : Number(r.triggered_change_pct),
    lastTriggeredAt: r.last_triggered_at ? String(r.last_triggered_at) : null,
    acknowledged: Boolean(r.acknowledged),
    createdAt: String(r.created_at),
  }));
}

export function evaluateVolatilityAlerts(): { triggeredCount: number } {
  const rules = db.prepare('SELECT * FROM VolatilityAlertRules').all() as Array<Record<string, unknown>>;
  const tokens = db.prepare('SELECT symbol, price_change_5m, price_change_1h, price_change_24h FROM TokenMetadata').all() as Array<Record<string, unknown>>;
  const agents = db.prepare('SELECT id, name FROM Agents').all() as Array<Record<string, unknown>>;
  const agentNameMap = new Map(agents.map((a) => [String(a.id), String(a.name)]));

  let triggeredCount = 0;
  const nowIso = new Date().toISOString();

  for (const rule of rules) {
    const ruleId = Number(rule.id);
    if (!rule.enabled) {
      db.prepare(`
        UPDATE VolatilityAlertRules
        SET is_triggered = 0, triggered_symbol = NULL, triggered_change_pct = NULL
        WHERE id = ?
      `).run(ruleId);
      continue;
    }

    const win = String(rule.window);
    const dir = String(rule.direction);
    const threshold = Number(rule.threshold_pct);
    const agentId = String(rule.agent_id);
    const agentName = agentNameMap.get(agentId) ?? agentId.toUpperCase();

    let bestMatch: { symbol: string; change: number; mag: number } | null = null;
    for (const tok of tokens) {
      const change =
        win === '5m'
          ? Number(tok.price_change_5m)
          : win === '24h'
          ? Number(tok.price_change_24h)
          : Number(tok.price_change_1h);

      const matches =
        dir === 'UP'
          ? change >= threshold
          : dir === 'DOWN'
          ? change <= -threshold
          : Math.abs(change) >= threshold;

      if (matches) {
        const mag = Math.abs(change);
        if (!bestMatch || mag > bestMatch.mag) {
          bestMatch = { symbol: String(tok.symbol), change, mag };
        }
      }
    }

    if (bestMatch) {
      triggeredCount += 1;
      const wasTriggered = Boolean(rule.is_triggered);
      const prevSymbol = rule.triggered_symbol ? String(rule.triggered_symbol) : null;
      const newlyTriggered = !wasTriggered || prevSymbol !== bestMatch.symbol;

      db.prepare(`
        UPDATE VolatilityAlertRules
        SET is_triggered = 1,
            triggered_symbol = ?,
            triggered_change_pct = ?,
            last_triggered_at = COALESCE(?, last_triggered_at),
            acknowledged = CASE WHEN ? THEN 0 ELSE acknowledged END
        WHERE id = ?
      `).run(
        bestMatch.symbol,
        Number(bestMatch.change.toFixed(1)),
        newlyTriggered ? nowIso : null,
        newlyTriggered ? 1 : 0,
        ruleId
      );

      if (newlyTriggered) {
        const sign = bestMatch.change >= 0 ? '+' : '';
        appendLog({
          agentId,
          agentName,
          tokenSymbol: bestMatch.symbol,
          eventType: 'WARN',
          message: `VOLATILITY ALERT · ${agentName}`,
          reason: `${bestMatch.symbol} moved ${sign}${bestMatch.change.toFixed(1)}% (${win}) exceeding ${threshold}% threshold`,
          resultBadge: `${sign}${bestMatch.change.toFixed(1)}%`,
          isPositive: bestMatch.change >= 0,
        });

        db.prepare(
          'INSERT INTO Notifications (title, message, severity, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
        ).run(
          `Volatility Alert: ${agentName}`,
          `${bestMatch.symbol} reached ${sign}${bestMatch.change.toFixed(1)}% over ${win} (threshold ${threshold}%).`,
          'ALERT',
          nowIso
        );
      }
    } else {
      db.prepare(`
        UPDATE VolatilityAlertRules
        SET is_triggered = 0, triggered_symbol = NULL, triggered_change_pct = NULL
        WHERE id = ?
      `).run(ruleId);
    }
  }

  return { triggeredCount };
}

export function getOvernightStrategyConfig(): OvernightStrategyConfig {
  const startBal = Number(getSetting('overnight_start_balance_usd', '70'));
  const enabled = getSetting('overnight_enabled', 'true') === 'true';
  const startTime = getSetting('overnight_start_time', '23:00');
  const endTime = getSetting('overnight_end_time', '07:00');
  const drawdownLimitPct = Number(
    getSetting('sim_max_daily_drawdown_pct', getSetting('overnight_daily_drawdown_pct', '30'))
  );
  return {
    enabled,
    promptName: 'grok-bot-overnight.prompt',
    startTime,
    endTime,
    sessionWindow: `${startTime} → ${endTime}`,
    startBalanceUsd: startBal,
    dexAllowlist: ['pump.fun', 'Raydium', 'Meteora'],
    maxPairAgeHours: Number(getSetting('overnight_max_age_hours', '6')),
    minLiquidityUsd: Number(getSetting('overnight_min_liq_usd', '40000')),
    minVol5mUsd: Number(getSetting('overnight_min_vol5m_usd', '25000')),
    minHolders: Number(getSetting('overnight_min_holders', '300')),
    minBuyRatioPct: Number(getSetting('overnight_min_buy_ratio_pct', '70')),
    minScannerSignals: 2,
    noChase1hPct: Number(getSetting('overnight_no_chase_1h_pct', '300')),
    sizerMinPct: Number(getSetting('overnight_sizer_min_pct', '20')),
    sizerMaxPct: Number(getSetting('overnight_sizer_max_pct', '40')),
    maxOpenPositions: Number(getSetting('overnight_max_open', '2')),
    scaleDownAfterLosses: 2,
    maxSlippagePct: Number(getSetting('overnight_max_slippage_pct', '2.5')),
    splitEntryParts: 2,
    tpLadderDesc: '40% @ 2× · 30% @ 4× · 30% @ 25% trailing stop',
    trailingStopPct: Number(getSetting('overnight_trailing_stop_pct', '25')),
    hardStopPct: Number(getSetting('overnight_hard_stop_pct', '12')),
    timeStopMinutes: Number(getSetting('overnight_time_stop_min', '25')),
    dailyDrawdownLimitPct: Number.isFinite(drawdownLimitPct) && drawdownLimitPct > 0 ? drawdownLimitPct : 30,
  };
}

function isSameLocalDayIso(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

const DEFAULT_AGENT_STATUSES: Record<AgentRecord['id'], { status: string; metricSecondary: string }> = {
  launch_radar: { status: 'SCAN', metricSecondary: 'pump.fun + Raydium' },
  whale_watch: { status: 'TRACK', metricSecondary: 'public swaps tracked' },
  sentiment: { status: 'READ', metricSecondary: 'verified feed window' },
  lp_auditor: { status: 'AUDIT', metricSecondary: 'strict Mint/Freeze RPC' },
  holder_map: { status: 'MAP', metricSecondary: 'top holder risk check' },
  risk_sizer: { status: 'READY', metricSecondary: 'virtual cap enforced' },
  sniper: { status: 'LIVE', metricSecondary: 'paper-only executor' },
  profit_taker: { status: 'LADDER', metricSecondary: 'ladder active' },
  stop_guard: { status: 'ARMED', metricSecondary: 'daily drawdown guard active' },
  journal: { status: 'ACTIVE', metricSecondary: 'SQLite persisted' },
};

export function restoreAgentsFromHalt() {
  const haltedRows = db.prepare(`SELECT id FROM Agents WHERE status = 'HALTED'`).all() as Array<{ id: string }>;
  for (const row of haltedRows) {
    const id = row.id as AgentRecord['id'];
    const def = DEFAULT_AGENT_STATUSES[id];
    if (def) {
      updateAgentState(id, def.status, 'resumed by operator', def.metricSecondary, null);
    }
  }
}

export function getDailyDrawdownGuardState(): DailyDrawdownGuardState {
  const enabled = getSetting('sim_drawdown_guard_enabled', 'true') === 'true';
  const rawMaxPct = Number(
    getSetting('sim_max_daily_drawdown_pct', getSetting('overnight_daily_drawdown_pct', '30'))
  );
  const maxDailyDrawdownPct = Number.isFinite(rawMaxPct) ? Math.min(95, Math.max(1, rawMaxPct)) : 30;

  const rawMinEq = getSetting('sim_min_equity_threshold_usd', '');
  const parsedMinEq = rawMinEq.trim() !== '' ? Number(rawMinEq) : NaN;
  const minEquityThresholdUsd =
    Number.isFinite(parsedMinEq) && parsedMinEq >= 0 ? Number(parsedMinEq.toFixed(2)) : null;

  const realizedBalanceUsd = Number(Number(getSetting('paper_balance_usd', '50')).toFixed(2));
  const paperStartBal = Number(Number(getSetting('paper_start_balance_usd', '50')).toFixed(2));

  // Compute unrealized PnL across all OPEN simulated positions using latest TokenMetadata prices
  const openTrades = db
    .prepare(
      `SELECT pt.equity_allocated_usd, pt.entry_price_sim_usd, tm.price_usd as live_price_usd
       FROM PaperTrades pt
       LEFT JOIN TokenMetadata tm ON tm.mint_address = pt.mint_address
       WHERE pt.status = 'OPEN'`
    )
    .all() as Array<{
      equity_allocated_usd: number;
      entry_price_sim_usd: number;
      live_price_usd: number | null;
    }>;

  let unrealizedPnlUsd = 0;
  for (const tr of openTrades) {
    const livePrice = Number(tr.live_price_usd);
    const entryPrice = Number(tr.entry_price_sim_usd);
    const allocated = Number(tr.equity_allocated_usd);
    if (Number.isFinite(livePrice) && livePrice > 0 && Number.isFinite(entryPrice) && entryPrice > 0) {
      const mult = livePrice / entryPrice;
      unrealizedPnlUsd += Math.max(-allocated, allocated * (mult - 1));
    }
  }
  unrealizedPnlUsd = Number(unrealizedPnlUsd.toFixed(2));

  const totalPortfolioEquityUsd = Number(Math.max(0, realizedBalanceUsd + unrealizedPnlUsd).toFixed(2));

  // Daily baseline & daily peak from EquityHistory for today
  const now = new Date();
  const eqRows = db
    .prepare('SELECT timestamp, balance_usd FROM EquityHistory ORDER BY id ASC')
    .all() as Array<{ timestamp: string; balance_usd: number }>;

  const todayRows = eqRows.filter((r) => isSameLocalDayIso(r.timestamp, now));
  const priorRows = eqRows.filter((r) => !isSameLocalDayIso(r.timestamp, now));

  const dailyStartEquityUsd =
    priorRows.length > 0
      ? Number(priorRows[priorRows.length - 1].balance_usd)
      : todayRows.length > 0
      ? Number(todayRows[0].balance_usd)
      : paperStartBal;

  let dailyPeakEquityUsd = dailyStartEquityUsd;
  for (const row of todayRows) {
    const val = Number(row.balance_usd);
    if (val > dailyPeakEquityUsd) dailyPeakEquityUsd = val;
  }
  if (totalPortfolioEquityUsd > dailyPeakEquityUsd) {
    dailyPeakEquityUsd = totalPortfolioEquityUsd;
  }
  dailyPeakEquityUsd = Number(Math.max(0, dailyPeakEquityUsd).toFixed(2));

  const pctDerivedFloorUsd = Number(
    (dailyPeakEquityUsd * (1 - maxDailyDrawdownPct / 100)).toFixed(2)
  );
  const effectiveHaltThresholdUsd =
    minEquityThresholdUsd !== null
      ? Number(Math.max(pctDerivedFloorUsd, minEquityThresholdUsd).toFixed(2))
      : pctDerivedFloorUsd;

  const currentDailyDrawdownPct =
    dailyPeakEquityUsd > 0
      ? Number(
          Math.max(
            0,
            ((dailyPeakEquityUsd - totalPortfolioEquityUsd) / dailyPeakEquityUsd) * 100
          ).toFixed(1)
        )
      : 0;

  const storedHalted = getSetting('sim_drawdown_halted', 'false') === 'true';
  const storedHaltedAt = getSetting('sim_drawdown_halted_at', '') || null;
  const storedHaltReason = getSetting('sim_drawdown_halt_reason', '') || null;

  const isBreached =
    enabled &&
    ((dailyPeakEquityUsd > 0 && totalPortfolioEquityUsd <= effectiveHaltThresholdUsd) ||
      (minEquityThresholdUsd !== null && totalPortfolioEquityUsd <= minEquityThresholdUsd));

  const isHalted = enabled && (storedHalted || isBreached);
  const computedHaltReason = isBreached
    ? `Tổng tài sản ($${totalPortfolioEquityUsd.toFixed(2)}) giảm xuống dưới ngưỡng cho phép ($${effectiveHaltThresholdUsd.toFixed(2)} · Sụt giảm ngày -${currentDailyDrawdownPct}% / giới hạn -${maxDailyDrawdownPct}%).`
    : storedHaltReason;

  return {
    enabled,
    maxDailyDrawdownPct,
    minEquityThresholdUsd,
    dailyStartEquityUsd: Number(dailyStartEquityUsd.toFixed(2)),
    dailyPeakEquityUsd,
    realizedBalanceUsd,
    unrealizedPnlUsd,
    totalPortfolioEquityUsd,
    currentDailyDrawdownPct,
    effectiveHaltThresholdUsd,
    isHalted,
    haltedAt: isHalted ? storedHaltedAt : null,
    haltReason: isHalted ? computedHaltReason : null,
  };
}

export function evaluateAndEnforceDailyDrawdownGuard(options?: {
  allowClearIfHealthy?: boolean;
}): DailyDrawdownGuardState {
  const state = getDailyDrawdownGuardState();
  const isBreached =
    state.enabled &&
    ((state.dailyPeakEquityUsd > 0 &&
      state.totalPortfolioEquityUsd <= state.effectiveHaltThresholdUsd) ||
      (state.minEquityThresholdUsd !== null &&
        state.totalPortfolioEquityUsd <= state.minEquityThresholdUsd));

  const wasHalted = getSetting('sim_drawdown_halted', 'false') === 'true';

  if (isBreached) {
    const nowIso = new Date().toISOString();
    const reason =
      state.haltReason ??
      `Tổng tài sản ($${state.totalPortfolioEquityUsd.toFixed(2)}) chạm ngưỡng ngắt mạch ($${state.effectiveHaltThresholdUsd.toFixed(2)}).`;

    if (!wasHalted) {
      setSetting('sim_drawdown_halted', 'true');
      setSetting('sim_drawdown_halted_at', nowIso);
      setSetting('sim_drawdown_halt_reason', reason);
      setSetting('is_running', 'false');
      setSetting(
        'latest_ticker',
        `HALT · CHẠM GIỚI HẠN SỤT GIẢM NGÀY ($${state.totalPortfolioEquityUsd.toFixed(2)} <= $${state.effectiveHaltThresholdUsd.toFixed(2)})`
      );

      const allAgentIds: AgentRecord['id'][] = [
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
      ];
      for (const agentId of allAgentIds) {
        updateAgentState(
          agentId,
          'HALTED',
          `EQ $${state.totalPortfolioEquityUsd.toFixed(2)} <= $${state.effectiveHaltThresholdUsd.toFixed(2)}`,
          `Daily DD -${state.currentDailyDrawdownPct}% / -${state.maxDailyDrawdownPct}%`,
          'Halted by Maximum Daily Drawdown limit'
        );
      }

      appendLog({
        agentId: 'stop_guard',
        agentName: 'DAILY DRAWDOWN GUARD',
        eventType: 'WARN',
        message: `NGẮT MẠCH TOÀN BỘ AGENT · Sụt giảm ngày -${state.currentDailyDrawdownPct}%`,
        reason,
        resultBadge: `HALT $${state.totalPortfolioEquityUsd.toFixed(2)}`,
        isPositive: false,
      });

      db.prepare(
        'INSERT INTO Notifications (title, message, severity, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run('Ngắt mạch Maximum Daily Drawdown', reason, 'ALERT', nowIso);
    } else if (getSetting('is_running', 'true') === 'true') {
      setSetting('is_running', 'false');
    }

    return {
      ...state,
      isHalted: true,
      haltedAt: getSetting('sim_drawdown_halted_at', nowIso) || nowIso,
      haltReason: reason,
    };
  }

  if (!state.enabled || (options?.allowClearIfHealthy && wasHalted)) {
    setSetting('sim_drawdown_halted', 'false');
    setSetting('sim_drawdown_halted_at', '');
    setSetting('sim_drawdown_halt_reason', '');
    restoreAgentsFromHalt();
    return {
      ...state,
      isHalted: false,
      haltedAt: null,
      haltReason: null,
    };
  }

  return state;
}

export function computeOvernightRecap(): OvernightRecap {
  const cfg = getOvernightStrategyConfig();
  const guard = getDailyDrawdownGuardState();
  const startBalanceUsd = Number(getSetting('paper_start_balance_usd', '50'));
  const endBalanceUsd = Number(getSetting('paper_balance_usd', '50'));
  const netPnlUsd = Number((endBalanceUsd - startBalanceUsd).toFixed(2));
  const netPnlPct = startBalanceUsd > 0 ? Number(((netPnlUsd / startBalanceUsd) * 100).toFixed(1)) : 0;

  const eqRows = db.prepare('SELECT balance_usd FROM EquityHistory ORDER BY id ASC').all() as Array<{ balance_usd: number }>;
  let peakEquityUsd = startBalanceUsd;
  for (const row of eqRows) {
    const val = Number(row.balance_usd);
    if (val > peakEquityUsd) peakEquityUsd = val;
  }
  if (endBalanceUsd > peakEquityUsd) peakEquityUsd = endBalanceUsd;

  const drawdownFromPeakPct =
    peakEquityUsd > 0 ? Number((((peakEquityUsd - guard.totalPortfolioEquityUsd) / peakEquityUsd) * 100).toFixed(1)) : 0;
  const drawdownPaused = guard.isHalted || drawdownFromPeakPct >= cfg.dailyDrawdownLimitPct;

  const openPositionsCount = (
    db.prepare(`SELECT COUNT(*) as c FROM PaperTrades WHERE status = 'OPEN'`).get() as { c: number }
  ).c;

  const closedTrades = db
    .prepare(`SELECT symbol, pnl_usd, multiplier FROM PaperTrades WHERE status = 'CLOSED' ORDER BY id DESC`)
    .all() as Array<{ symbol: string; pnl_usd: number; multiplier: number }>;

  let consecutiveLosses = 0;
  for (const t of closedTrades) {
    if (Number(t.pnl_usd) <= 0) {
      consecutiveLosses += 1;
    } else {
      break;
    }
  }
  const sizeScaledDownHalf = consecutiveLosses >= cfg.scaleDownAfterLosses;
  const baseSizerPct = 30; // Midpoint of 20-40% overnight compounding range
  const effectivePositionPct = sizeScaledDownHalf ? baseSizerPct / 2 : baseSizerPct;

  const wins = closedTrades.filter((t) => Number(t.pnl_usd) > 0).length;
  const losses = closedTrades.filter((t) => Number(t.pnl_usd) <= 0).length;

  let bestTrade: OvernightRecap['bestTrade'] = null;
  let worstTrade: OvernightRecap['worstTrade'] = null;
  const coinAgg = new Map<string, { pnlUsd: number; tradesCount: number; bestMultiplier: number }>();

  for (const t of closedTrades) {
    const sym = String(t.symbol);
    const pnl = Number(t.pnl_usd);
    const mult = Number(t.multiplier);

    if (!bestTrade || pnl > bestTrade.pnlUsd) {
      bestTrade = { symbol: sym, pnlUsd: Number(pnl.toFixed(2)), multiplier: Number(mult.toFixed(2)) };
    }
    if (!worstTrade || pnl < worstTrade.pnlUsd) {
      worstTrade = { symbol: sym, pnlUsd: Number(pnl.toFixed(2)), multiplier: Number(mult.toFixed(2)) };
    }

    const curr = coinAgg.get(sym) ?? { pnlUsd: 0, tradesCount: 0, bestMultiplier: 0 };
    curr.pnlUsd = Number((curr.pnlUsd + pnl).toFixed(2));
    curr.tradesCount += 1;
    if (mult > curr.bestMultiplier) curr.bestMultiplier = Number(mult.toFixed(2));
    coinAgg.set(sym, curr);
  }

  const topThreeCoins: OvernightTopCoin[] = Array.from(coinAgg.entries())
    .map(([symbol, data]) => ({
      symbol,
      pnlUsd: data.pnlUsd,
      tradesCount: data.tradesCount,
      bestMultiplier: data.bestMultiplier,
    }))
    .sort((a, b) => b.pnlUsd - a.pnlUsd)
    .slice(0, 3);

  return {
    startBalanceUsd: Number(startBalanceUsd.toFixed(2)),
    endBalanceUsd: Number(endBalanceUsd.toFixed(2)),
    netPnlUsd,
    netPnlPct,
    peakEquityUsd: Number(peakEquityUsd.toFixed(2)),
    drawdownFromPeakPct: Math.max(0, drawdownFromPeakPct),
    drawdownPaused,
    openPositionsCount,
    consecutiveLosses,
    sizeScaledDownHalf,
    effectivePositionPct,
    totalTrades: closedTrades.length,
    wins,
    losses,
    bestTrade,
    worstTrade,
    topThreeCoins,
  };
}

