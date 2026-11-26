export type AgentId =
  | 'launch_radar'
  | 'whale_watch'
  | 'sentiment'
  | 'lp_auditor'
  | 'holder_map'
  | 'risk_sizer'
  | 'sniper'
  | 'profit_taker'
  | 'stop_guard'
  | 'journal';

export interface AgentRecord {
  id: AgentId;
  orderIndex: number;
  code: string;
  name: string;
  viName: string;
  description: string;
  status: string;
  color: string;
  metricPrimary: string;
  metricSecondary: string;
  lastError: string | null;
  eventsProcessed: number;
  updatedAt: string;
}

export interface TokenFlowItem {
  mintAddress: string;
  symbol: string;
  name: string;
  pairAddress: string;
  dexId: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  liquidityUsd: number;
  volume24hUsd: number;
  volume5mUsd?: number;
  volume1hUsd?: number;
  buyRatioPct?: number;
  pairAgeHours?: number | null;
  fdvUsd: number;
  holdersCount: number;
  bondingCurvePct: number;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  riskLevel: 'LOW RISK' | 'MEDIUM RISK' | 'HIGH RISK' | 'FILTERED';
  status: 'WATCHING' | 'PASSED' | 'OPEN' | 'CLOSED' | 'FILTERED';
  source: string;
  sourceTimestamp: string;
  detectedAgo: string;
  whaleInflowUsd: number;
  sentimentVelocity: string;
  reason: string;
}

export interface PaperTradeRecord {
  id: number;
  mintAddress: string;
  symbol: string;
  status: 'OPEN' | 'CLOSED' | 'FILTERED' | 'ERROR';
  riskLevel: string;
  referencePriceUsd: number;
  entryPriceSimUsd: number;
  exitPriceSimUsd: number | null;
  quantitySim: number;
  equityAllocatedUsd: number;
  equityPct: number;
  feeSimUsd: number;
  slippagePct: number;
  pnlUsd: number;
  multiplier: number;
  mcapUsd: number;
  liquidityUsd: number;
  bondingCurvePct: number;
  holdersCount: number;
  reason: string;
  exitReason: string | null;
  sparkline: number[];
  openedAt: string;
  closedAt: string | null;
}

export interface EquityPoint {
  id: number;
  timestamp: string;
  label: string;
  balanceUsd: number;
  pnlDeltaUsd: number;
  note: string;
}

export interface SystemLogEntry {
  id: number;
  timestamp: string;
  timeShort: string;
  agentId: AgentId | 'YOU' | 'SYSTEM';
  agentName: string;
  tokenSymbol: string | null;
  mintAddress: string | null;
  eventType: 'SCAN' | 'TRACK' | 'READ' | 'AUDIT' | 'MAP' | 'SIZE' | 'BUY_SIM' | 'SELL_SIM' | 'STOP_SIM' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  reason: string;
  resultBadge: string;
  isPositive: boolean | null;
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  severity: 'INFO' | 'WARN' | 'ALERT';
  isRead: boolean;
  createdAt: string;
}

export interface TokenAccountInfo {
  tokenAccount: string;
  mint: string;
  symbol: string;
  amount: number;
  decimals: number;
  program: 'SPL Token' | 'Token-2022';
}

export interface WalletReadOnlyState {
  connected: boolean;
  connectionMethod: 'NONE' | 'PHANTOM_EXTENSION' | 'PHANTOM_MOBILE_QR' | 'PUBLIC_ADDRESS';
  deviceType: string;
  publicAddress: string | null;
  shortAddress: string | null;
  network: string;
  solBalance: number | null;
  rpcStatus: 'OK' | 'ERROR' | 'DISCONNECTED' | 'RATE_LIMITED';
  rpcError: string | null;
  tokenAccounts: TokenAccountInfo[];
  lastSyncedAt: string | null;
}

export interface DashboardStats {
  paperStartBalanceUsd: number;
  paperBalanceUsd: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  tokensChecked: number;
  blockedCount: number;
  blockedPct: number;
  bestMultiplier: number;
  bestSymbol: string;
  bestPnlUsd: number;
  lastSellPnlUsd: number;
  lastSellSymbol: string;
  lastSellReason: string;
  lastSellTime: string;
}

export interface BacktestDatasetRecord {
  id: string;
  poolAddress: string;
  tokenSymbol: string;
  tokenName: string;
  timeframe: string;
  source: string;
  datasetHash: string;
  recordCount: number;
  startTime: string;
  endTime: string;
  qualityStatus: 'VERIFIED' | 'WARNING' | 'FAILED';
  qualityNotes: string;
  createdAt: string;
}

export interface BacktestSessionRecord {
  id: string;
  datasetId: string;
  tokenSymbol: string;
  softwareVersion: string;
  initialCapitalUsd: number;
  finalCapitalUsd: number;
  totalReturnPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  maxDrawdownPct: number;
  stopLossPct: number;
  takeProfitX: number;
  trailingStopPct: number;
  feePct: number;
  slippagePct: number;
  status: 'COMPLETED' | 'NO_TRADES' | 'ERROR';
  notes: string;
  tradesJson: string;
  createdAt: string;
}

export type VolatilityWindow = '5m' | '1h' | '24h';
export type VolatilityDirection = 'ANY' | 'UP' | 'DOWN';

export interface VolatilityAlertRule {
  id: number;
  agentId: AgentId;
  agentName: string;
  window: VolatilityWindow;
  direction: VolatilityDirection;
  thresholdPct: number;
  enabled: boolean;
  isTriggered: boolean;
  triggeredSymbol: string | null;
  triggeredChangePct: number | null;
  lastTriggeredAt: string | null;
  acknowledged: boolean;
  createdAt: string;
}

export interface OvernightStrategyConfig {
  enabled: boolean;
  promptName: string;
  startTime: string;
  endTime: string;
  sessionWindow: string;
  startBalanceUsd: number;
  dexAllowlist: string[];
  maxPairAgeHours: number;
  minLiquidityUsd: number;
  minVol5mUsd: number;
  minHolders: number;
  minBuyRatioPct: number;
  minScannerSignals: number;
  noChase1hPct: number;
  sizerMinPct: number;
  sizerMaxPct: number;
  maxOpenPositions: number;
  scaleDownAfterLosses: number;
  maxSlippagePct: number;
  splitEntryParts: number;
  tpLadderDesc: string;
  trailingStopPct: number;
  hardStopPct: number;
  timeStopMinutes: number;
  dailyDrawdownLimitPct: number;
}

export interface OvernightTopCoin {
  symbol: string;
  pnlUsd: number;
  tradesCount: number;
  bestMultiplier: number;
}

export interface OvernightRecap {
  startBalanceUsd: number;
  endBalanceUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  peakEquityUsd: number;
  drawdownFromPeakPct: number;
  drawdownPaused: boolean;
  openPositionsCount: number;
  consecutiveLosses: number;
  sizeScaledDownHalf: boolean;
  effectivePositionPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  bestTrade: { symbol: string; pnlUsd: number; multiplier: number } | null;
  worstTrade: { symbol: string; pnlUsd: number; multiplier: number } | null;
  topThreeCoins: OvernightTopCoin[];
}

export interface DailyDrawdownGuardState {
  enabled: boolean;
  maxDailyDrawdownPct: number;
  minEquityThresholdUsd: number | null;
  dailyStartEquityUsd: number;
  dailyPeakEquityUsd: number;
  realizedBalanceUsd: number;
  unrealizedPnlUsd: number;
  totalPortfolioEquityUsd: number;
  currentDailyDrawdownPct: number;
  effectiveHaltThresholdUsd: number;
  isHalted: boolean;
  haltedAt: string | null;
  haltReason: string | null;
}

export type DexRouterOption = 'AUTO' | 'RAYDIUM' | 'ORCA' | 'METEORA' | 'PUMP_FUN';

export interface DexTokenOption {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  source: string;
}

export interface JupiterQuoteSummary {
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  otherAmountThresholdRaw: string;
  inAmountUi: number;
  outAmountUi: number;
  minOutAmountUi: number;
  inputDecimals: number;
  outputDecimals: number;
  slippageBps: number;
  priceImpactPct: number;
  routeLabels: string[];
  rawQuoteResponse: Record<string, unknown>;
  quotedAt: string;
}

export interface LiveTradeRecord {
  id: number;
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
  errorMessage: string | null;
  solscanUrl: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface WalletTransferRecord {
  id: number;
  direction: 'DEPOSIT' | 'WITHDRAW';
  assetSymbol: string;
  mintAddress: string;
  amount: number;
  fromAddress: string;
  toAddress: string;
  signature: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  note: string | null;
  solscanUrl: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface TerminalSnapshot {
  appName: string;
  version: string;
  isRunning: boolean;
  mode: 'HYBRID: PAPER SIM + PHANTOM DEX';
  startedAt: string;
  solPriceUsd: number;
  solPriceSource: string;
  rpcLatencyMs: number | null;
  rpcSlot: number | null;
  rpcEndpoint: string;
  totalLaunchesTracked: number;
  throughputMsgPerSec: number;
  latestTicker: string;
  agents: AgentRecord[];
  tokens: TokenFlowItem[];
  trades: PaperTradeRecord[];
  liveTrades: LiveTradeRecord[];
  walletTransfers: WalletTransferRecord[];
  equityHistory: EquityPoint[];
  logs: SystemLogEntry[];
  notifications: NotificationItem[];
  unreadNotifications: number;
  volatilityAlerts: VolatilityAlertRule[];
  stats: DashboardStats;
  wallet: WalletReadOnlyState;
  backtestDatasets: BacktestDatasetRecord[];
  backtestSessions: BacktestSessionRecord[];
  overnightConfig: OvernightStrategyConfig;
  overnightRecap: OvernightRecap;
  dailyDrawdownGuard: DailyDrawdownGuardState;
}

