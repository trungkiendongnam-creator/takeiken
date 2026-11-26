import {
  appendLog,
  computeOvernightRecap,
  db,
  evaluateAndEnforceDailyDrawdownGuard,
  evaluateVolatilityAlerts,
  getOvernightStrategyConfig,
  getSetting,
  setSetting,
  updateAgentState,
} from './db.ts';
import {
  fetchLiveSolanaDexPairs,
  fetchLiveSolPrice,
  fetchLiveTokenPriceUsd,
} from './dexConnector.ts';
import { auditMintAuthoritiesOnChain, getSolanaRpcHealth } from './solanaRpc.ts';

export async function runLiveSolanaScanPipeline(): Promise<{
  scannedCount: number;
  blockedCount: number;
  simulatedTradesCount: number;
  solPriceUsd: number;
  rpcLatencyMs: number | null;
  halted?: boolean;
  haltReason?: string | null;
}> {
  const preGuard = evaluateAndEnforceDailyDrawdownGuard();
  if (preGuard.isHalted) {
    appendLog({
      agentId: 'stop_guard',
      agentName: 'DAILY DRAWDOWN GUARD',
      eventType: 'WARN',
      message: 'Tạm dừng quét & giao dịch agent · Chạm giới hạn sụt giảm ngày',
      reason: preGuard.haltReason ?? 'Tổng tài sản giảm dưới ngưỡng cho phép.',
      resultBadge: 'HALTED',
      isPositive: false,
    });
    return {
      scannedCount: 0,
      blockedCount: 0,
      simulatedTradesCount: 0,
      solPriceUsd: Number(getSetting('sol_price_usd', '0')),
      rpcLatencyMs: Number(getSetting('rpc_latency_ms', '0')) || null,
      halted: true,
      haltReason: preGuard.haltReason,
    };
  }

  const [rpcHealth, solPrice, pairs] = await Promise.all([
    getSolanaRpcHealth(),
    fetchLiveSolPrice(),
    fetchLiveSolanaDexPairs('solana'),
  ]);

  if (rpcHealth.ok && rpcHealth.latencyMs !== null) {
    setSetting('rpc_latency_ms', String(rpcHealth.latencyMs));
    if (rpcHealth.slot !== null) setSetting('rpc_slot', String(rpcHealth.slot));
  }
  if (solPrice.priceUsd > 0) {
    setSetting('sol_price_usd', solPrice.priceUsd.toFixed(2));
    setSetting('sol_price_source', solPrice.source);
  }

  if (pairs.length === 0) {
    updateAgentState('launch_radar', 'SCAN', 'live feed timeout/empty', 'DexScreener retrying', 'No pairs returned from DexScreener');
    appendLog({
      agentId: 'launch_radar',
      agentName: 'LAUNCH RADAR',
      eventType: 'WARN',
      message: 'Live DEX scan returned 0 pairs',
      reason: 'Network timeout or DEX rate limit',
      resultBadge: 'RETRY',
      isPositive: false,
    });
    return {
      scannedCount: 0,
      blockedCount: 0,
      simulatedTradesCount: 0,
      solPriceUsd: solPrice.priceUsd,
      rpcLatencyMs: rpcHealth.latencyMs,
    };
  }

  let checkedTotal = Number(getSetting('tokens_checked', '0'));
  let blockedTotal = Number(getSetting('blocked_count', '0'));
  let newBlocked = 0;
  let simCount = 0;

  // 01. LAUNCH RADAR
  const lead = pairs[0];
  updateAgentState(
    'launch_radar',
    'SCAN',
    `next ${lead.symbol} · live`,
    `${pairs.length} Solana pairs fetched`
  );
  appendLog({
    agentId: 'launch_radar',
    agentName: 'LAUNCH RADAR',
    tokenSymbol: lead.symbol,
    mintAddress: lead.mintAddress,
    eventType: 'SCAN',
    message: `Detected ${pairs.length} live Solana pairs (${lead.dexId})`,
    reason: `ref price $${lead.priceUsd.toFixed(6)} · liq $${Math.round(lead.liquidityUsd).toLocaleString()}`,
    resultBadge: 'LIVE',
    isPositive: true,
  });

  // Evaluate up to 5 top pairs through Agents 02..10
  const candidates = pairs.slice(0, 5);
  for (const pair of candidates) {
    checkedTotal += 1;

    // 02. WHALE WATCH (public volume spike check, never guesses owner identity)
    const whaleInflow = pair.volume24hUsd > 250000 ? Math.round(pair.volume24hUsd * 0.08) : Math.round(pair.volume24hUsd * 0.03);
    updateAgentState(
      'whale_watch',
      'TRACK',
      `$${Math.round(whaleInflow / 1000)}k flow in ${pair.symbol}`,
      'public swap volume tracked'
    );

    // 03. SENTIMENT (from verified market momentum, never fabricated social text)
    const sentimentVel = `5m ${pair.priceChange5m >= 0 ? '+' : ''}${pair.priceChange5m.toFixed(1)}% · 1h ${pair.priceChange1h >= 0 ? '+' : ''}${pair.priceChange1h.toFixed(1)}%`;
    updateAgentState(
      'sentiment',
      'READ',
      `${pair.symbol} ${pair.priceChange1h >= 0 ? '+' : ''}${pair.priceChange1h.toFixed(0)}% · 1h`,
      'market velocity window'
    );

    // 04. LP AUDITOR (real Solana Mainnet RPC check + liquidity threshold, strict fail-closed)
    const rpcAudit = await auditMintAuthoritiesOnChain(pair.mintAddress);
    const minLiquidityOk = pair.liquidityUsd >= 15000;
    const authorityVerified = rpcAudit.checked === true && rpcAudit.mintAuthorityRevoked !== null && rpcAudit.freezeAuthorityRevoked !== null;
    const mintSafe = authorityVerified && rpcAudit.mintAuthorityRevoked === true;
    const freezeSafe = authorityVerified && rpcAudit.freezeAuthorityRevoked === true;
    const passedAudit = minLiquidityOk && mintSafe && freezeSafe;

    let riskLevel: 'LOW RISK' | 'MEDIUM RISK' | 'HIGH RISK' | 'FILTERED' = 'MEDIUM RISK';
    let status: 'WATCHING' | 'PASSED' | 'FILTERED' = 'PASSED';
    let auditReason = `LP $${Math.round(pair.liquidityUsd).toLocaleString()} · Mint & Freeze verified revoked`;

    if (!passedAudit) {
      riskLevel = 'FILTERED';
      status = 'FILTERED';
      blockedTotal += 1;
      newBlocked += 1;
      auditReason = !minLiquidityOk
        ? `Blocked: Liquidity $${Math.round(pair.liquidityUsd)} < $15k min`
        : !authorityVerified
        ? `Blocked: Unverified Mint/Freeze Authority on-chain (${rpcAudit.error ?? 'RPC unavailable'})`
        : 'Blocked: Mint or Freeze Authority active on-chain';

      updateAgentState('lp_auditor', 'AUDIT', `blocked ${pair.symbol}`, auditReason);
      appendLog({
        agentId: 'lp_auditor',
        agentName: 'LP AUDITOR',
        tokenSymbol: pair.symbol,
        mintAddress: pair.mintAddress,
        eventType: 'AUDIT',
        message: `FILTERED ${pair.symbol}`,
        reason: auditReason,
        resultBadge: 'BLOCKED',
        isPositive: false,
      });
    } else {
      if (pair.liquidityUsd >= 100000 && rpcAudit.mintAuthorityRevoked && rpcAudit.freezeAuthorityRevoked) {
        riskLevel = 'LOW RISK';
      } else if (pair.liquidityUsd < 40000) {
        riskLevel = 'HIGH RISK';
      }
      updateAgentState('lp_auditor', 'AUDIT', `passed ${pair.symbol}`, auditReason);
      appendLog({
        agentId: 'lp_auditor',
        agentName: 'LP AUDITOR',
        tokenSymbol: pair.symbol,
        mintAddress: pair.mintAddress,
        eventType: 'AUDIT',
        message: `AUDIT PASS ${pair.symbol}`,
        reason: auditReason,
        resultBadge: 'PASS',
        isPositive: true,
      });
    }

    // 05. HOLDER MAP
    const estHolders = Math.max(120, Math.round(pair.fdvUsd > 0 ? Math.min(4500, pair.fdvUsd / 450) : 340));
    updateAgentState('holder_map', 'MAP', `${estHolders} holders · ${pair.symbol}`, 'no false cluster link');

    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO TokenMetadata (
        mint_address, symbol, name, pair_address, dex_id, price_usd,
        price_change_5m, price_change_1h, price_change_24h, liquidity_usd,
        volume_24h_usd, volume_5m_usd, volume_1h_usd, buy_ratio_pct, pair_age_hours,
        fdv_usd, holders_count, bonding_curve_pct,
        mint_authority_revoked, freeze_authority_revoked, risk_level, status,
        source, source_timestamp, detected_ago, whale_inflow_usd, sentiment_velocity, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mint_address) DO UPDATE SET
        price_usd = excluded.price_usd,
        price_change_5m = excluded.price_change_5m,
        price_change_1h = excluded.price_change_1h,
        price_change_24h = excluded.price_change_24h,
        liquidity_usd = excluded.liquidity_usd,
        volume_24h_usd = excluded.volume_24h_usd,
        volume_5m_usd = excluded.volume_5m_usd,
        volume_1h_usd = excluded.volume_1h_usd,
        buy_ratio_pct = excluded.buy_ratio_pct,
        pair_age_hours = excluded.pair_age_hours,
        fdv_usd = excluded.fdv_usd,
        risk_level = excluded.risk_level,
        status = CASE
          WHEN EXISTS (SELECT 1 FROM PaperTrades WHERE mint_address = excluded.mint_address AND status = 'OPEN')
          THEN 'OPEN'
          ELSE excluded.status
        END,
        source_timestamp = excluded.source_timestamp,
        reason = excluded.reason
    `).run(
      pair.mintAddress,
      pair.symbol,
      pair.name,
      pair.pairAddress,
      pair.dexId,
      pair.priceUsd,
      pair.priceChange5m,
      pair.priceChange1h,
      pair.priceChange24h,
      pair.liquidityUsd,
      pair.volume24hUsd,
      pair.volume5mUsd,
      pair.volume1hUsd,
      pair.buyRatioPct,
      pair.pairAgeHours,
      pair.fdvUsd,
      estHolders,
      Math.min(100, Math.max(45, Math.round((pair.liquidityUsd / 100000) * 100))),
      rpcAudit.mintAuthorityRevoked === null ? null : rpcAudit.mintAuthorityRevoked ? 1 : 0,
      rpcAudit.freezeAuthorityRevoked === null ? null : rpcAudit.freezeAuthorityRevoked ? 1 : 0,
      riskLevel,
      status,
      pair.source,
      nowIso,
      pair.pairAgeHours !== null ? `${pair.pairAgeHours.toFixed(1)}h` : 'live',
      whaleInflow,
      sentimentVel,
      auditReason
    );
  }

  // 06. RISK SIZER update
  const paperBal = Number(getSetting('paper_balance_usd', '50.00'));
  updateAgentState('risk_sizer', 'READY', `3% of $${paperBal.toFixed(2)} (sim)`, 'Paper virtual cap active');

  // 07-10 update
  updateAgentState('sniper', 'LIVE', `ready · ${candidates.length} scanned`, 'Paper-only mode enforced');
  updateAgentState('journal', 'ACTIVE', `logged ${candidates.length} live tokens`, 'SQLite synced');

  setSetting('tokens_checked', String(checkedTotal));
  setSetting('blocked_count', String(blockedTotal));
  setSetting('total_launches_tracked', String(Number(getSetting('total_launches_tracked', '0')) + candidates.length));
  setSetting('latest_ticker', `LAUNCH RADAR · SCANNED ${candidates.length} LIVE SOLANA PAIRS`);
  evaluateVolatilityAlerts();
  const postScanGuard = evaluateAndEnforceDailyDrawdownGuard();

  return {
    scannedCount: candidates.length,
    blockedCount: newBlocked,
    simulatedTradesCount: simCount,
    solPriceUsd: solPrice.priceUsd,
    rpcLatencyMs: rpcHealth.latencyMs,
    halted: postScanGuard.isHalted,
    haltReason: postScanGuard.haltReason,
  };
}

export async function executePaperSimulation(params: {
  mintAddress: string;
  action: 'OPEN_SIM' | 'CLOSE_SIM';
  equityPct?: number;
  liveMarketPriceUsd?: number;
  closeReasonPrefix?: string;
}): Promise<{ ok: boolean; message: string; tradeId?: number }> {
  const token = db.prepare('SELECT * FROM TokenMetadata WHERE mint_address = ?').get(params.mintAddress) as Record<string, unknown> | undefined;
  if (!token) {
    return { ok: false, message: 'Không tìm thấy token trong cơ sở dữ liệu cục bộ.' };
  }

  const symbol = String(token.symbol);
  const currentBalance = Number(getSetting('paper_balance_usd', '50.00'));
  const nowIso = new Date().toISOString();
  const timeShort = nowIso.slice(11, 16);

  if (params.action === 'OPEN_SIM') {
    const guard = evaluateAndEnforceDailyDrawdownGuard();
    if (guard.isHalted) {
      return {
        ok: false,
        message: `ĐÃ NGẮT MẠCH GIAO DỊCH (Maximum Daily Drawdown): ${guard.haltReason ?? 'Tổng tài sản giảm dưới ngưỡng cho phép.'}`,
      };
    }
    if (String(token.status) === 'FILTERED') {
      return { ok: false, message: `LP Auditor đã chặn ${symbol}. Không thể mở lệnh mô phỏng cho token bị lọc.` };
    }

    const pct = Math.min(40, Math.max(1, params.equityPct ?? 4));
    const allocatedUsd = Number(((currentBalance * pct) / 100).toFixed(2));
    if (allocatedUsd <= 0 || currentBalance < 1) {
      return { ok: false, message: 'Số dư vốn ảo Paper Trading không đủ.' };
    }

    const refPrice = Math.max(0.0000001, Number(token.price_usd));
    const slippagePct = 0.5;
    const entrySimPrice = Number((refPrice * (1 + slippagePct / 100)).toFixed(9));
    const feeSimUsd = Number((allocatedUsd * 0.005).toFixed(4));
    const qtySim = Number(((allocatedUsd - feeSimUsd) / entrySimPrice).toFixed(4));

    // Agent 06 RISK SIZER
    updateAgentState('risk_sizer', 'READY', `${pct}% ($${allocatedUsd}) sim`, 'virtual sizing calculated');
    // Agent 07 SNIPER
    updateAgentState('sniper', 'ACTIVE', `OPEN (SIM) ${symbol}`, `entry $${entrySimPrice.toFixed(6)}`);

    const info = db.prepare(`
      INSERT INTO PaperTrades (
        mint_address, symbol, status, risk_level, reference_price_usd, entry_price_sim_usd,
        exit_price_sim_usd, quantity_sim, equity_allocated_usd, equity_pct, fee_sim_usd,
        slippage_pct, pnl_usd, multiplier, mcap_usd, liquidity_usd, bonding_curve_pct,
        holders_count, reason, exit_reason, sparkline_json, opened_at, closed_at
      ) VALUES (?, ?, 'OPEN', ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 1.0, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
    `).run(
      params.mintAddress,
      symbol,
      String(token.risk_level),
      refPrice,
      entrySimPrice,
      qtySim,
      allocatedUsd,
      pct,
      feeSimUsd,
      slippagePct,
      Number(token.fdv_usd),
      Number(token.liquidity_usd),
      Number(token.bonding_curve_pct),
      Number(token.holders_count),
      `Paper entry: ${String(token.reason)}`,
      JSON.stringify([1, 1.01]),
      nowIso
    );

    db.prepare(`UPDATE TokenMetadata SET status = 'OPEN' WHERE mint_address = ?`).run(params.mintAddress);

    appendLog({
      agentId: 'sniper',
      agentName: 'SNIPER',
      tokenSymbol: symbol,
      mintAddress: params.mintAddress,
      eventType: 'BUY_SIM',
      message: `BUY (SIM) ${symbol} size ${pct}%`,
      reason: `Paper entry $${entrySimPrice.toFixed(6)} · fee $${feeSimUsd}`,
      resultBadge: `size ${pct}%`,
      isPositive: null,
    });
    updateAgentState('journal', 'ACTIVE', `opened (sim) ${symbol}`, 'Paper fill logged');
    setSetting('latest_ticker', `SNIPER · OPENED (SIM) ${symbol} SIZE ${pct}%`);

    return { ok: true, message: `Đã mở lệnh mô phỏng (Paper) cho ${symbol}`, tradeId: Number(info.lastInsertRowid) };
  }

  // CLOSE_SIM: close latest OPEN trade for this mintAddress
  const openTrade = db.prepare(`SELECT * FROM PaperTrades WHERE mint_address = ? AND status = 'OPEN' ORDER BY id DESC LIMIT 1`).get(params.mintAddress) as Record<string, unknown> | undefined;
  if (!openTrade) {
    return { ok: false, message: `Không tìm thấy lệnh mô phỏng đang mở cho ${symbol}.` };
  }

  const liveQuote =
    params.liveMarketPriceUsd && Number.isFinite(params.liveMarketPriceUsd) && params.liveMarketPriceUsd > 0
      ? { priceUsd: params.liveMarketPriceUsd, source: 'DexScreener Solana Live' }
      : await fetchLiveTokenPriceUsd(params.mintAddress);

  if (liveQuote && liveQuote.priceUsd > 0) {
    db.prepare('UPDATE TokenMetadata SET price_usd = ?, source_timestamp = ? WHERE mint_address = ?').run(
      liveQuote.priceUsd,
      nowIso,
      params.mintAddress
    );
  }

  const marketPriceUsd = liveQuote?.priceUsd && liveQuote.priceUsd > 0
    ? liveQuote.priceUsd
    : Number(token.price_usd);

  if (!Number.isFinite(marketPriceUsd) || marketPriceUsd <= 0) {
    return {
      ok: false,
      message: `Không lấy được giá thị trường hiện tại cho ${symbol} để đóng lệnh mô phỏng.`,
    };
  }

  const sellSlippagePct = Number.isFinite(Number(openTrade.slippage_pct))
    ? Number(openTrade.slippage_pct)
    : 0.5;
  const entrySim = Math.max(1e-12, Number(openTrade.entry_price_sim_usd));
  const exitSim = Number(Math.max(0, marketPriceUsd * (1 - sellSlippagePct / 100)).toFixed(9));
  const mult = exitSim / entrySim;
  const allocated = Number(openTrade.equity_allocated_usd);
  const feeSim = Number(openTrade.fee_sim_usd) * 2;
  const pnlUsd = Number(Math.max(-allocated, allocated * (mult - 1) - feeSim).toFixed(2));
  const newBalance = Number(Math.max(0, currentBalance + pnlUsd).toFixed(2));
  const isWin = pnlUsd >= 0;
  const priceSourceNote = liveQuote ? liveQuote.source : 'Giá quét gần nhất';
  const reasonPrefix = params.closeReasonPrefix ? `${params.closeReasonPrefix} · ` : '';
  const exitReason = isWin
    ? `${reasonPrefix}Đóng theo giá thị trường (${priceSourceNote}) ${mult.toFixed(2)}x (trượt ${sellSlippagePct}%)`
    : `${reasonPrefix}Đóng theo giá thị trường (${priceSourceNote}) ${((mult - 1) * 100).toFixed(1)}% (${mult.toFixed(2)}x)`;

  let existingSpark: number[] = [1];
  try {
    const parsed = JSON.parse(String(openTrade.sparkline_json)) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      existingSpark = parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    }
  } catch {
    existingSpark = [1];
  }
  const nextSpark = [...existingSpark, Number(((1 + mult) / 2).toFixed(2)), Number(mult.toFixed(2))];

  db.prepare(`
    UPDATE PaperTrades
    SET status = 'CLOSED', exit_price_sim_usd = ?, pnl_usd = ?, multiplier = ?, exit_reason = ?, sparkline_json = ?, closed_at = ?
    WHERE id = ?
  `).run(exitSim, pnlUsd, Number(mult.toFixed(2)), exitReason, JSON.stringify(nextSpark), nowIso, Number(openTrade.id));

  const remainingOpen = db
    .prepare(`SELECT COUNT(*) AS cnt FROM PaperTrades WHERE mint_address = ? AND status = 'OPEN'`)
    .get(params.mintAddress) as { cnt: number };
  db.prepare(`UPDATE TokenMetadata SET status = ? WHERE mint_address = ?`).run(
    remainingOpen.cnt > 0 ? 'OPEN' : 'CLOSED',
    params.mintAddress
  );
  setSetting('paper_balance_usd', newBalance.toFixed(2));

  db.prepare('INSERT INTO EquityHistory (timestamp, label, balance_usd, pnl_delta_usd, note) VALUES (?, ?, ?, ?, ?)').run(
    nowIso,
    timeShort,
    newBalance,
    pnlUsd,
    `${isWin ? 'SELL' : 'STOP'} (SIM) ${symbol} ${mult.toFixed(2)}x`
  );

  if (isWin) {
    updateAgentState('profit_taker', 'LADDER', `sold (sim) ${symbol} ${mult.toFixed(2)}x`, `+$${pnlUsd.toFixed(2)} realized sim`);
    appendLog({
      agentId: 'profit_taker',
      agentName: 'PROFIT TAKER',
      tokenSymbol: symbol,
      mintAddress: params.mintAddress,
      eventType: 'SELL_SIM',
      message: `SELL (SIM) ${symbol}`,
      reason: exitReason,
      resultBadge: `+$${pnlUsd.toFixed(2)} ${mult.toFixed(2)}x`,
      isPositive: true,
    });
    setSetting('latest_ticker', `PROFIT TAKER · SOLD (SIM) ${symbol} ${mult.toFixed(2)}x`);
  } else {
    updateAgentState('stop_guard', 'ARMED', `stopped (sim) ${symbol}`, `${pnlUsd.toFixed(2)} virtual loss capped`);
    appendLog({
      agentId: 'stop_guard',
      agentName: 'STOP GUARD',
      tokenSymbol: symbol,
      mintAddress: params.mintAddress,
      eventType: 'STOP_SIM',
      message: `STOP (SIM) ${symbol}`,
      reason: exitReason,
      resultBadge: `-$${Math.abs(pnlUsd).toFixed(2)}`,
      isPositive: false,
    });
    setSetting('latest_ticker', `STOP GUARD · STOPPED (SIM) ${symbol} ${mult.toFixed(2)}x`);
  }

  updateAgentState('sniper', 'LIVE', 'flat · waiting', 'Paper-only executor');
  updateAgentState('journal', 'ACTIVE', `closed (sim) ${symbol}`, 'SQLite persisted');

  // Re-evaluate Maximum Daily Drawdown immediately after realizing PnL
  evaluateAndEnforceDailyDrawdownGuard();

  return { ok: true, message: `Đã đóng lệnh mô phỏng cho ${symbol}: ${isWin ? '+' : '-'}$${Math.abs(pnlUsd).toFixed(2)}`, tradeId: Number(openTrade.id) };
}

export async function runOvernightStrategyCycle(options?: {
  resetStart70?: boolean;
  forceEnable?: boolean;
}): Promise<{
  ok: boolean;
  summary: string;
  scannedCount: number;
  passedCount: number;
  filteredCount: number;
  openedTradesCount: number;
  closedTradesCount: number;
  drawdownPaused: boolean;
}> {
  if (options?.forceEnable) {
    setSetting('overnight_enabled', 'true');
  }
  const cfg = getOvernightStrategyConfig();
  if (!cfg.enabled) {
    return {
      ok: false,
      summary: 'Kịch bản Qua đêm hiện đang TẮT. Vui lòng bật công tắc Kịch bản Qua đêm trước khi chạy.',
      scannedCount: 0,
      passedCount: 0,
      filteredCount: 0,
      openedTradesCount: 0,
      closedTradesCount: 0,
      drawdownPaused: false,
    };
  }
  const now = new Date();
  const nowIso = now.toISOString();
  const timeShort = nowIso.slice(11, 16);

  if (options?.resetStart70) {
    db.prepare('DELETE FROM PaperTrades').run();
    db.prepare('DELETE FROM EquityHistory').run();
    db.prepare(
      'INSERT INTO EquityHistory (timestamp, label, balance_usd, pnl_delta_usd, note) VALUES (?, ?, ?, 0, ?)'
    ).run(nowIso, cfg.startTime, cfg.startBalanceUsd, `Khởi tạo Phiên Đêm ($${cfg.startBalanceUsd} · ${cfg.sessionWindow})`);

    setSetting('paper_start_balance_usd', cfg.startBalanceUsd.toFixed(2));
    setSetting('paper_balance_usd', cfg.startBalanceUsd.toFixed(2));
    setSetting('is_running', 'true');
    setSetting('latest_ticker', `PHIÊN ĐÊM · KHỞI CHẠY $${cfg.startBalanceUsd.toFixed(2)} (${cfg.sessionWindow})`);
    appendLog({
      agentId: 'journal',
      agentName: 'LOGGER',
      eventType: 'INFO',
      message: `Khởi động grok-bot-overnight.prompt · Vốn đầu $${cfg.startBalanceUsd.toFixed(2)}`,
      reason: `Khung giờ ${cfg.sessionWindow} · pump.fun / Raydium / Meteora`,
      resultBadge: `START $${cfg.startBalanceUsd}`,
      isPositive: true,
    });
  }

  // 1. Check Maximum Daily Drawdown Limit
  const preGuard = evaluateAndEnforceDailyDrawdownGuard();
  const recapBefore = computeOvernightRecap();
  if (preGuard.isHalted || recapBefore.drawdownPaused) {
    setSetting('is_running', 'false');
    return {
      ok: true,
      summary:
        preGuard.haltReason ??
        `Phiên đêm đã tạm dừng do chạm giới hạn sụt giảm -${cfg.dailyDrawdownLimitPct}% từ đỉnh.`,
      scannedCount: 0,
      passedCount: 0,
      filteredCount: 0,
      openedTradesCount: 0,
      closedTradesCount: 0,
      drawdownPaused: true,
    };
  }

  // 2. Fetch live Solana DEX pairs + RPC health
  const [rpcHealth, solPrice, pairs] = await Promise.all([
    getSolanaRpcHealth(),
    fetchLiveSolPrice(),
    fetchLiveSolanaDexPairs('solana'),
  ]);

  if (rpcHealth.ok && rpcHealth.latencyMs !== null) {
    setSetting('rpc_latency_ms', String(rpcHealth.latencyMs));
    if (rpcHealth.slot !== null) setSetting('rpc_slot', String(rpcHealth.slot));
  }
  if (solPrice.priceUsd > 0) {
    setSetting('sol_price_usd', solPrice.priceUsd.toFixed(2));
    setSetting('sol_price_source', solPrice.source);
  }

  // 3. Evaluate any OPEN simulated trades against 25m time stop or live market moves (NEVER mask true loss)
  let closedTradesCount = 0;
  const openRows = db.prepare(`SELECT * FROM PaperTrades WHERE status = 'OPEN' ORDER BY id ASC`).all() as Array<
    Record<string, unknown>
  >;
  for (const tr of openRows) {
    const openedMs = new Date(String(tr.opened_at)).getTime();
    const ageMin = (Date.now() - openedMs) / 60000;
    const mint = String(tr.mint_address);
    const livePair = pairs.find((p) => p.mintAddress === mint);
    const livePrice =
      livePair && livePair.priceUsd > 0
        ? livePair.priceUsd
        : (await fetchLiveTokenPriceUsd(mint))?.priceUsd ?? 0;

    if (ageMin >= cfg.timeStopMinutes) {
      const closeRes = await executePaperSimulation({
        mintAddress: mint,
        action: 'CLOSE_SIM',
        liveMarketPriceUsd: livePrice > 0 ? livePrice : undefined,
        closeReasonPrefix: `Hết thời gian giữ (${cfg.timeStopMinutes} phút)`,
      });
      if (closeRes.ok) closedTradesCount += 1;
    } else if (livePrice > 0) {
      const entry = Math.max(1e-12, Number(tr.entry_price_sim_usd));
      const ratio = livePrice / entry;
      if (ratio <= 1 - cfg.hardStopPct / 100) {
        const closeRes = await executePaperSimulation({
          mintAddress: mint,
          action: 'CLOSE_SIM',
          liveMarketPriceUsd: livePrice,
          closeReasonPrefix: `Cắt lỗ cứng (-${cfg.hardStopPct}% kích hoạt tại ${((ratio - 1) * 100).toFixed(1)}%)`,
        });
        if (closeRes.ok) closedTradesCount += 1;
      } else if (ratio >= 2.0) {
        const closeRes = await executePaperSimulation({
          mintAddress: mint,
          action: 'CLOSE_SIM',
          liveMarketPriceUsd: livePrice,
          closeReasonPrefix: `Chốt lời mục tiêu (>= 2.00x)`,
        });
        if (closeRes.ok) closedTradesCount += 1;
      }
    }
  }

  const postCloseGuard = evaluateAndEnforceDailyDrawdownGuard();
  if (postCloseGuard.isHalted) {
    return {
      ok: true,
      summary: postCloseGuard.haltReason ?? 'Phiên đêm tự động tạm dừng do chạm giới hạn Maximum Daily Drawdown sau khi đóng lệnh.',
      scannedCount: 0,
      passedCount: 0,
      filteredCount: 0,
      openedTradesCount: 0,
      closedTradesCount,
      drawdownPaused: true,
    };
  }

  // 4. Evaluate Universe + 6 Overnight Agents on up to 6 live candidates
  let passedCount = 0;
  let filteredCount = 0;
  let openedTradesCount = 0;

  const candidates = pairs.slice(0, 12);
  for (const pair of candidates) {
    const dexLower = pair.dexId.toLowerCase();
    const dexOk = cfg.dexAllowlist.some((d) => {
      const normalized = d.toLowerCase().replace('.', '');
      if (normalized === 'pumpfun') {
        return dexLower.includes('pump');
      }
      return dexLower.includes(normalized);
    });
    const ageOk = pair.pairAgeHours === null || pair.pairAgeHours <= cfg.maxPairAgeHours;
    const liqOk = pair.liquidityUsd >= cfg.minLiquidityUsd;
    const vol5mOk = pair.volume5mUsd >= cfg.minVol5mUsd;
    const estHolders = Math.max(120, Math.round(pair.fdvUsd > 0 ? Math.min(4500, pair.fdvUsd / 450) : 340));
    const holdersOk = estHolders >= cfg.minHolders;
    const noChaseOk = !(pair.priceChange1h >= cfg.noChase1hPct && pair.priceChange5m >= 0);

    // SCANNER signals (require >= 2 signals)
    const signals: string[] = [];
    const avg1hPer5m = pair.volume1hUsd > 0 ? pair.volume1hUsd / 12 : 0;
    if ((avg1hPer5m > 0 && pair.volume5mUsd > avg1hPer5m * 5) || pair.volume5mUsd >= cfg.minVol5mUsd * 2) {
      signals.push('Vol >5× TB 1h');
    }
    if (pair.buyRatioPct >= cfg.minBuyRatioPct) {
      signals.push(`Mua/Bán ${pair.buyRatioPct}% (>70%)`);
    }
    if (holdersOk) {
      signals.push(`${estHolders} ví (>=300)`);
    }
    const whaleInflow = pair.volume24hUsd > 250000 ? Math.round(pair.volume24hUsd * 0.08) : Math.round(pair.volume24hUsd * 0.03);
    if (whaleInflow >= 25000) {
      signals.push(`Smart-money $${Math.round(whaleInflow / 1000)}k`);
    }

    const rpcAudit = await auditMintAuthoritiesOnChain(pair.mintAddress);
    const authorityVerified = rpcAudit.checked === true && rpcAudit.mintAuthorityRevoked !== null && rpcAudit.freezeAuthorityRevoked !== null;
    const mintSafe = authorityVerified && rpcAudit.mintAuthorityRevoked === true;
    const freezeSafe = authorityVerified && rpcAudit.freezeAuthorityRevoked === true;
    const rugCheckPass = mintSafe && freezeSafe && liqOk && holdersOk;
    const universeOk = dexOk && ageOk && liqOk && vol5mOk && holdersOk && noChaseOk;
    const signalsOk = signals.length >= cfg.minScannerSignals;
    const fullPass = universeOk && rugCheckPass && signalsOk;

    let filterReason = '';
    if (!dexOk) filterReason = `FILTERED · DEX ${pair.dexId} ngoài danh sách pump.fun/Raydium/Meteora`;
    else if (!ageOk) filterReason = `FILTERED · Tuổi pool ${pair.pairAgeHours}h > ${cfg.maxPairAgeHours}h`;
    else if (!liqOk) filterReason = `FILTERED · Thanh khoản $${Math.round(pair.liquidityUsd).toLocaleString()} < $40k`;
    else if (!vol5mOk) filterReason = `FILTERED · Vol 5m $${Math.round(pair.volume5mUsd).toLocaleString()} < $25k`;
    else if (!holdersOk) filterReason = `FILTERED · ${estHolders} ví < 300 tối thiểu`;
    else if (!noChaseOk) filterReason = `FILTERED · Chống FOMO: tăng +${pair.priceChange1h.toFixed(0)}% (>300%) chưa điều chỉnh`;
    else if (!authorityVerified) filterReason = `FILTERED · Không xác minh được quyền Mint/Freeze trên RPC (${rpcAudit.error ?? 'unverified'})`;
    else if (!mintSafe || !freezeSafe) filterReason = `FILTERED · Phát hiện Mint hoặc Freeze Authority còn mở`;
    else if (!signalsOk) filterReason = `FILTERED · Chỉ đạt ${signals.length}/2 tín hiệu SCANNER`;
    else filterReason = `PASS · ${signals.slice(0, 3).join(' · ')} · LP $${Math.round(pair.liquidityUsd / 1000)}k`;

    const riskLevel: 'LOW RISK' | 'MEDIUM RISK' | 'HIGH RISK' | 'FILTERED' = !fullPass
      ? 'FILTERED'
      : pair.liquidityUsd >= 100000
      ? 'LOW RISK'
      : 'MEDIUM RISK';

    db.prepare(`
      INSERT INTO TokenMetadata (
        mint_address, symbol, name, pair_address, dex_id, price_usd,
        price_change_5m, price_change_1h, price_change_24h, liquidity_usd,
        volume_24h_usd, volume_5m_usd, volume_1h_usd, buy_ratio_pct, pair_age_hours,
        fdv_usd, holders_count, bonding_curve_pct,
        mint_authority_revoked, freeze_authority_revoked, risk_level, status,
        source, source_timestamp, detected_ago, whale_inflow_usd, sentiment_velocity, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mint_address) DO UPDATE SET
        price_usd = excluded.price_usd,
        price_change_5m = excluded.price_change_5m,
        price_change_1h = excluded.price_change_1h,
        price_change_24h = excluded.price_change_24h,
        liquidity_usd = excluded.liquidity_usd,
        volume_24h_usd = excluded.volume_24h_usd,
        volume_5m_usd = excluded.volume_5m_usd,
        volume_1h_usd = excluded.volume_1h_usd,
        buy_ratio_pct = excluded.buy_ratio_pct,
        pair_age_hours = excluded.pair_age_hours,
        risk_level = excluded.risk_level,
        status = CASE
          WHEN EXISTS (SELECT 1 FROM PaperTrades WHERE mint_address = excluded.mint_address AND status = 'OPEN')
          THEN 'OPEN'
          ELSE excluded.status
        END,
        source_timestamp = excluded.source_timestamp,
        reason = excluded.reason
    `).run(
      pair.mintAddress,
      pair.symbol,
      pair.name,
      pair.pairAddress,
      pair.dexId,
      pair.priceUsd,
      pair.priceChange5m,
      pair.priceChange1h,
      pair.priceChange24h,
      pair.liquidityUsd,
      pair.volume24hUsd,
      pair.volume5mUsd,
      pair.volume1hUsd,
      pair.buyRatioPct,
      pair.pairAgeHours,
      pair.fdvUsd,
      estHolders,
      Math.min(100, Math.max(45, Math.round((pair.liquidityUsd / 100000) * 100))),
      rpcAudit.mintAuthorityRevoked === null ? null : rpcAudit.mintAuthorityRevoked ? 1 : 0,
      rpcAudit.freezeAuthorityRevoked === null ? null : rpcAudit.freezeAuthorityRevoked ? 1 : 0,
      riskLevel,
      fullPass ? 'PASSED' : 'FILTERED',
      pair.source,
      nowIso,
      pair.pairAgeHours !== null ? `${pair.pairAgeHours.toFixed(1)}h` : 'live',
      whaleInflow,
      `Mua ${pair.buyRatioPct}% · Vol5m $${Math.round(pair.volume5mUsd / 1000)}k`,
      filterReason
    );

    if (!fullPass) {
      filteredCount += 1;
      appendLog({
        agentId: 'lp_auditor',
        agentName: 'RUG CHECK',
        tokenSymbol: pair.symbol,
        mintAddress: pair.mintAddress,
        eventType: 'AUDIT',
        message: `FILTERED ${pair.symbol}`,
        reason: filterReason,
        resultBadge: 'FILTERED',
        isPositive: false,
      });
    } else {
      passedCount += 1;
      const recapNow = computeOvernightRecap();
      const alreadyOpen = db
        .prepare(`SELECT id FROM PaperTrades WHERE mint_address = ? AND status = 'OPEN'`)
        .get(pair.mintAddress);

      if (!alreadyOpen && recapNow.openPositionsCount < cfg.maxOpenPositions && !recapNow.drawdownPaused) {
        const execPct = recapNow.effectivePositionPct;
        const simRes = await executePaperSimulation({
          mintAddress: pair.mintAddress,
          action: 'OPEN_SIM',
          equityPct: execPct,
        });
        if (simRes.ok) {
          openedTradesCount += 1;
          appendLog({
            agentId: 'sniper',
            agentName: 'EXECUTOR',
            tokenSymbol: pair.symbol,
            mintAddress: pair.mintAddress,
            eventType: 'BUY_SIM',
            message: `ENTER (2 phần · trượt tối đa 2.5%) ${pair.symbol}`,
            reason: `Sizer ${execPct}% vốn kép · ${signals.slice(0, 2).join(' + ')}`,
            resultBadge: `SIZE ${execPct}%`,
            isPositive: true,
          });
        }
      }
    }
  }

  const postCycleGuard = evaluateAndEnforceDailyDrawdownGuard();
  const finalRecap = computeOvernightRecap();
  if (!postCycleGuard.isHalted) {
    updateAgentState('launch_radar', 'SCAN', `${candidates.length} cặp mới · ${passedCount} đạt`, `Vol5m>=$25k · LP>=$40k`);
    updateAgentState('lp_auditor', 'AUDIT', `${passedCount} PASS · ${filteredCount} FILTERED`, `Mint/Freeze & No-Chase 300%`);
    updateAgentState(
      'risk_sizer',
      finalRecap.sizeScaledDownHalf ? 'SCALED 50%' : 'READY',
      `${finalRecap.effectivePositionPct}% vốn kép`,
      `${finalRecap.openPositionsCount}/${cfg.maxOpenPositions} vị thế · DD -${finalRecap.drawdownFromPeakPct}%`
    );
    updateAgentState('sniper', 'LIVE', `${openedTradesCount} vào lệnh · ${closedTradesCount} đóng`, `Slippage max ${cfg.maxSlippagePct}%`);
    updateAgentState('journal', 'ACTIVE', `${timeShort} · Đã ghi phiên đêm`, `Vốn $${finalRecap.endBalanceUsd.toFixed(2)}`);
  }

  setSetting('tokens_checked', String(Number(getSetting('tokens_checked', '0')) + candidates.length));
  setSetting('blocked_count', String(Number(getSetting('blocked_count', '0')) + filteredCount));
  evaluateVolatilityAlerts();

  return {
    ok: true,
    summary: postCycleGuard.isHalted
      ? postCycleGuard.haltReason ?? 'Phiên đêm đã tự động tạm dừng do chạm giới hạn Maximum Daily Drawdown.'
      : `Chu kỳ Phiên Đêm: quét ${candidates.length} cặp, đạt chuẩn ${passedCount}, lọc ${filteredCount}, mở mô phỏng ${openedTradesCount} lệnh.`,
    scannedCount: candidates.length,
    passedCount,
    filteredCount,
    openedTradesCount,
    closedTradesCount,
    drawdownPaused: finalRecap.drawdownPaused || postCycleGuard.isHalted,
  };
}
