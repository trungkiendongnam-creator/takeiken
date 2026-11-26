import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentRecord,
  BacktestDatasetRecord,
  BacktestSessionRecord,
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

  const initialSettings: Array<[string, string]> = [
    ['is_running', 'true'],
    ['paper_start_balance_usd', '50.00'],
    ['paper_balance_usd', '94.35'],
    ['tokens_checked', '129'],
    ['blocked_count', '0'],
    ['total_launches_tracked', '4353'],
    ['sol_price_usd', '142.20'],
    ['sol_price_source', 'DexScreener / Reference'],
    ['rpc_latency_ms', '33'],
    ['rpc_slot', '312849200'],
    ['rpc_endpoint', 'https://api.mainnet-beta.solana.com'],
    ['latest_ticker', 'PROFIT TAKER · SOLD (SIM) $CLAUDIA 1.78x'],
    ['started_at', now],
  ];
  for (const [k, v] of initialSettings) {
    setSetting(k, v);
  }

  const agentsSeed = [
    ['launch_radar', 1, '01', 'LAUNCH RADAR', 'Radar phát hiện token mới', 'pump.fun + Raydium launches', 'SCAN', '#FF9B45', 'next $Bingwu · launched 7m', '129 pairs scanned', 129],
    ['whale_watch', 2, '02', 'WHALE WATCH', 'Theo dõi ví lớn', 'wallets > $50k moving in', 'TRACK', '#49A9ED', '$62k whale into $Bingwu', '14 public wallets', 42],
    ['sentiment', 3, '03', 'SENTIMENT', 'Phân tích tâm lý thị trường', 'X + Telegram velocity', 'READ', '#EF6682', 'mentions +95% · 30m', 'verified feed window', 38],
    ['lp_auditor', 4, '04', 'LP AUDITOR', 'Kiểm toán thanh khoản', 'LP lock · mint · freeze', 'AUDIT', '#EF6682', 'passed $Bingwu', '0 blocked · strict RPC', 129],
    ['holder_map', 5, '05', 'HOLDER MAP', 'Bản đồ phân bổ người nắm giữ', 'clusters · fresh wallets', 'MAP', '#F28482', '0 bad clusters', 'top 10 concentration OK', 64],
    ['risk_sizer', 6, '06', 'RISK SIZER', 'Bộ tính quy mô và rủi ro', 'size by volatility · 2-4%', 'IDLE', '#A986F5', '3% of $94.35 (sim)', 'virtual cap enforced', 29],
    ['sniper', 7, '07', 'SNIPER', 'Bộ mô phỏng thực thi', 'entry under 400 ms (paper)', 'LIVE', '#39DEA2', 'flat · waiting', 'paper-only executor', 7],
    ['profit_taker', 8, '08', 'PROFIT TAKER', 'Bộ mô phỏng chốt lời', '2x · 5x · moonbag', 'LADDER', '#EAC64D', 'sold (sim) $CLAUDIA 1.78x', 'ladder active', 5],
    ['stop_guard', 9, '09', 'STOP GUARD', 'Bộ giới hạn rủi ro', 'trail 22% · hard -12%', 'ARMED', '#FF7A59', '2 stops · max -12%', 'virtual equity guard', 2],
    ['journal', 10, '10', 'JOURNAL', 'Nhật ký và báo cáo', 'logs every fill', 'ACTIVE', '#49A9ED', 'fill #14', 'SQLite persisted', 14],
  ];

  const insertAgent = db.prepare(`
    INSERT INTO Agents (id, order_index, code, name, vi_name, description, status, color, metric_primary, metric_secondary, last_error, events_processed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  for (const a of agentsSeed) {
    insertAgent.run(...a, now);
  }

  const tokensSeed = [
    ['So11111111111111111111111111111111111111112', '$Bingwu', 'Bingwu Token', 'PairBingwu001', 'pump.fun', 0.0001231, 34.2, 34.0, 118.4, 84500, 312000, 412000, 892, 84, 1, 1, 'MEDIUM RISK', 'WATCHING', 'DexScreener Feed', now, '7m', 62000, 'mentions +95% · 30m', 'Whale inflow $62k detected · awaiting Sniper trigger'],
    ['ZELDAmint1111111111111111111111111111111111', '$ZELDA', 'Zelda Solana', 'PairZelda002', 'raydium', 0.00003602, 12.4, 37.0, 92.1, 61200, 198000, 285000, 640, 91, 1, 1, 'MEDIUM RISK', 'PASSED', 'DexScreener Feed', now, '11m', 18400, 'steady +42%', 'LP Auditor passed · Mint & Freeze revoked'],
    ['1SOLmint11111111111111111111111111111111111', '$1SOL', 'One Sol', 'Pair1Sol003', 'pump.fun', 0.0002257, 4.5, 40.0, 1080.0, 95400, 742000, 1450000, 2180, 100, 1, 1, 'LOW RISK', 'CLOSED', 'Session Archive', now, '16m', 74000, 'peak velocity', 'Best multiplier 11.8x recorded · partial stop hit later'],
    ['GRANNYmint111111111111111111111111111111111', '$GRANNY', 'Granny Meme', 'PairGranny004', 'raydium', 0.00004748, 8.9, 43.0, 64.5, 53800, 146000, 198000, 518, 79, 1, 1, 'MEDIUM RISK', 'PASSED', 'DexScreener Feed', now, '21m', 14200, 'rising +31%', 'LP locked · 0 bad holder clusters'],
    ['CLAUDIAmint11111111111111111111111111111111', '$CLAUDIA', 'Claudia AI', 'PairClaudia005', 'pump.fun', 0.0003338, 14.1, 78.0, 145.0, 128000, 584000, 1100000, 1599, 98, 1, 1, 'HIGH RISK', 'CLOSED', 'Paper Session', now, '24m', 41500, 'buys 82% of flow', 'pair 9m old · buys 82% of flow'],
  ];

  const insertToken = db.prepare(`
    INSERT INTO TokenMetadata (
      mint_address, symbol, name, pair_address, dex_id, price_usd,
      price_change_5m, price_change_1h, price_change_24h, liquidity_usd,
      volume_24h_usd, fdv_usd, holders_count, bonding_curve_pct,
      mint_authority_revoked, freeze_authority_revoked, risk_level, status,
      source, source_timestamp, detected_ago, whale_inflow_usd, sentiment_velocity, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const t of tokensSeed) {
    insertToken.run(...t);
  }

  const tradesSeed = [
    ['1SOLmint11111111111111111111111111111111111', '$1SOL', 'CLOSED', 'LOW RISK', 0.0000191, 0.0000192, 0.0002257, 130208, 2.50, 4.0, 0.02, 0.5, 27.00, 11.80, 1450000, 95400, 100, 2180, 'early breakout · clean LP audit', 'ladder take-profit 11.8x (sim)', JSON.stringify([1, 1.4, 2.2, 4.1, 6.8, 9.5, 11.8, 11.2]), '2026-11-25T23:12:00Z', '2026-11-25T23:28:00Z'],
    ['1SOLmint11111111111111111111111111111111111', '$1SOL', 'CLOSED', 'MEDIUM RISK', 0.0002290, 0.0002300, 0.0002185, 9560, 2.20, 3.0, 0.01, 0.4, -0.11, 0.95, 1410000, 91200, 100, 2180, 're-entry momentum check', 'stop hit · momentum gone', JSON.stringify([1, 1.03, 1.01, 0.98, 0.96, 0.95]), '2026-11-25T23:41:00Z', '2026-11-25T23:46:00Z'],
    ['WhiteCow111111111111111111111111111111111111', '$WhiteCow', 'CLOSED', 'MEDIUM RISK', 0.0000840, 0.0000845, 0.0003388, 38698, 3.27, 4.0, 0.02, 0.6, 9.84, 4.01, 690000, 74000, 96, 1120, 'bonding curve 96% · fast fill', 'runner trailed out', JSON.stringify([1, 1.25, 1.8, 2.6, 3.5, 4.4, 4.01]), '2026-11-25T23:49:00Z', '2026-11-25T23:53:00Z'],
    ['GRIFFIN1111111111111111111111111111111111111', '$GRIFFIN', 'CLOSED', 'LOW RISK', 0.0001120, 0.0001126, 0.0002980, 26642, 3.00, 3.5, 0.02, 0.5, 4.95, 2.65, 520000, 64500, 94, 940, 'whale accumulation + LP locked', 'take-profit 2.65x (sim)', JSON.stringify([1, 1.15, 1.5, 1.9, 2.4, 2.65]), '2026-11-25T23:54:00Z', '2026-11-25T23:56:00Z'],
    ['CATNIP11111111111111111111111111111111111111', '$CATNIP', 'CLOSED', 'HIGH RISK', 0.0000620, 0.0000624, 0.0000549, 44871, 2.80, 3.0, 0.02, 0.7, -0.34, 0.88, 210000, 41200, 82, 490, 'high velocity scalp', 'hard stop -12% triggered', JSON.stringify([1, 1.02, 0.97, 0.92, 0.88]), '2026-11-25T23:55:00Z', '2026-11-25T23:57:00Z'],
    ['PEPECAT1111111111111111111111111111111111111', '$PEPECAT', 'CLOSED', 'MEDIUM RISK', 0.0001500, 0.0001508, 0.0001740, 21883, 3.30, 3.8, 0.02, 0.5, 0.16, 1.15, 410000, 58000, 89, 780, 'clean holder distribution', 'partial scale out', JSON.stringify([1, 1.06, 1.12, 1.19, 1.15]), '2026-11-25T23:57:00Z', '2026-11-25T23:58:00Z'],
    ['CLAUDIAmint11111111111111111111111111111111', '$CLAUDIA', 'CLOSED', 'HIGH RISK', 0.0001875, 0.0001875, 0.0003338, 19466, 3.65, 4.0, 0.03, 0.5, 2.85, 1.78, 1100000, 128000, 98, 1599, 'pair 9m old · buys 82% of flow', 'runner trailed out', JSON.stringify([1, 1.08, 1.24, 1.42, 1.56, 1.94, 1.78]), '2026-11-25T23:58:00Z', '2026-11-26T00:02:00Z'],
  ];

  const insertTrade = db.prepare(`
    INSERT INTO PaperTrades (
      mint_address, symbol, status, risk_level, reference_price_usd, entry_price_sim_usd,
      exit_price_sim_usd, quantity_sim, equity_allocated_usd, equity_pct, fee_sim_usd,
      slippage_pct, pnl_usd, multiplier, mcap_usd, liquidity_usd, bonding_curve_pct,
      holders_count, reason, exit_reason, sparkline_json, opened_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const tr of tradesSeed) {
    insertTrade.run(...tr);
  }

  const equitySeed: Array<[string, string, number, number, string]> = [
    ['2026-11-25T23:00:00Z', '23:00', 50.00, 0.00, 'Session initialized (Paper Trading)'],
    ['2026-11-25T23:28:00Z', '23:28', 77.00, 27.00, 'SELL (SIM) $1SOL 11.8x'],
    ['2026-11-25T23:46:00Z', '23:46', 76.89, -0.11, 'STOP (SIM) $1SOL -12% guard'],
    ['2026-11-25T23:53:00Z', '23:53', 86.73, 9.84, 'SELL (SIM) $WhiteCow 4.01x'],
    ['2026-11-25T23:56:00Z', '23:56', 91.68, 4.95, 'SELL (SIM) $GRIFFIN 2.65x'],
    ['2026-11-25T23:57:00Z', '23:57', 91.34, -0.34, 'STOP (SIM) $CATNIP -12%'],
    ['2026-11-25T23:58:00Z', '23:58', 91.50, 0.16, 'SELL (SIM) $PEPECAT 1.15x'],
    ['2026-11-26T00:02:00Z', '00:02', 94.35, 2.85, 'SELL (SIM) $CLAUDIA 1.78x'],
  ];
  const insertEq = db.prepare('INSERT INTO EquityHistory (timestamp, label, balance_usd, pnl_delta_usd, note) VALUES (?, ?, ?, ?, ?)');
  for (const eq of equitySeed) {
    insertEq.run(...eq);
  }

  const logsSeed: Array<[string, string, string, string, string | null, string | null, string, string, string, string, number | null]> = [
    ['2026-11-25T23:46:00Z', '23:46', 'stop_guard', 'STOP GUARD', '$1SOL', '1SOLmint11111111111111111111111111111111111', 'STOP_SIM', 'STOP (SIM) $1SOL', 'stop hit · momentum gone', '-$0.11', 0],
    ['2026-11-25T23:49:00Z', '23:49', 'sniper', 'SNIPER', '$WhiteCow', 'WhiteCow111111111111111111111111111111111111', 'BUY_SIM', 'BUY (SIM) $WhiteCow size 4%', 'bonding curve 96% · fast fill', 'size 4%', null],
    ['2026-11-25T23:53:00Z', '23:53', 'profit_taker', 'PROFIT TAKER', '$WhiteCow', 'WhiteCow111111111111111111111111111111111111', 'SELL_SIM', 'SELL (SIM) $WhiteCow', 'runner trailed out', '+$9.84 4.01x', 1],
    ['2026-11-25T23:58:00Z', '23:58', 'sniper', 'SNIPER', '$CLAUDIA', 'CLAUDIAmint11111111111111111111111111111111', 'BUY_SIM', 'BUY (SIM) $CLAUDIA size 4%', 'pair 9m old · buys 82% of flow', 'size 4%', null],
    ['2026-11-26T00:02:00Z', '00:02', 'profit_taker', 'PROFIT TAKER', '$CLAUDIA', 'CLAUDIAmint11111111111111111111111111111111', 'SELL_SIM', 'SELL (SIM) $CLAUDIA', 'runner trailed out', '+$2.85 1.78x', 1],
    ['2026-11-26T00:03:15Z', '00:03', 'lp_auditor', 'LP AUDITOR', '$Bingwu', 'So11111111111111111111111111111111111111112', 'AUDIT', 'AUDIT PASS $Bingwu', 'LP locked · mint & freeze revoked', 'PASS', 1],
    ['2026-11-26T00:03:45Z', '00:03', 'whale_watch', 'WHALE WATCH', '$Bingwu', 'So11111111111111111111111111111111111111112', 'TRACK', '$62k whale inflow into $Bingwu', 'public wallet accumulation detected', '+$62k', 1],
  ];

  const insertLog = db.prepare(`
    INSERT INTO SystemLogs (timestamp, time_short, agent_id, agent_name, token_symbol, mint_address, event_type, message, reason, result_badge, is_positive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const lg of logsSeed) {
    insertLog.run(...lg);
  }

  const notifSeed: Array<[string, string, string, number, string]> = [
    ['Hệ thống sẵn sàng (Read-Only + Paper)', 'Chế độ an toàn đang bật: không có đường ký hoặc gửi giao dịch thật lên Solana.', 'INFO', 0, now],
    ['$Bingwu vượt qua LP Auditor', 'Whale Watch ghi nhận dòng tiền công khai $62k. Có thể nhấn "Scan Live DEX" để quét thị trường Solana thật.', 'INFO', 0, now],
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
      solscanUrl: `https://solscan.io/tx/${signature}`,
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
      solscanUrl: `https://solscan.io/tx/${signature}`,
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
    dailyDrawdownLimitPct: Number(getSetting('overnight_daily_drawdown_pct', '30')),
  };
}

export function computeOvernightRecap(): OvernightRecap {
  const cfg = getOvernightStrategyConfig();
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
    peakEquityUsd > 0 ? Number((((peakEquityUsd - endBalanceUsd) / peakEquityUsd) * 100).toFixed(1)) : 0;
  const drawdownPaused = drawdownFromPeakPct >= cfg.dailyDrawdownLimitPct;

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
    drawdownFromPeakPct,
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

