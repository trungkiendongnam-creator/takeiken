import crypto from 'node:crypto';
import { appendLog, db } from './db.ts';
import { fetchGeckoTerminalSolanaOhlcv, type OhlcvCandle } from './dexConnector.ts';
import type { BacktestDatasetRecord, BacktestSessionRecord } from '../src/types/terminal.ts';

export async function fetchAndValidateHistoricalDataset(params: {
  poolAddress: string;
  timeframe: 'minute' | 'hour' | 'day';
  limit?: number;
}): Promise<BacktestDatasetRecord> {
  const fetched = await fetchGeckoTerminalSolanaOhlcv(params.poolAddress, params.timeframe, params.limit ?? 120);
  const rawCandles = fetched.candles;

  if (rawCandles.length === 0) {
    throw new Error('NO_HISTORICAL_DATA: GeckoTerminal returned 0 OHLCV candles for this pool.');
  }

  // Quality checks: missing values, non-positive prices, duplicate timestamps, monotonic order
  const seenTs = new Set<number>();
  const cleanCandles: OhlcvCandle[] = [];
  let duplicatesRemoved = 0;
  let invalidPricesRemoved = 0;

  for (const c of rawCandles) {
    if (!Number.isFinite(c.ts) || !Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close) || c.close <= 0 || c.open <= 0) {
      invalidPricesRemoved += 1;
      continue;
    }
    if (seenTs.has(c.ts)) {
      duplicatesRemoved += 1;
      continue;
    }
    seenTs.add(c.ts);
    cleanCandles.push(c);
  }

  cleanCandles.sort((a, b) => a.ts - b.ts);

  // Check for large time gaps
  const expectedStepSec = params.timeframe === 'minute' ? 60 : params.timeframe === 'hour' ? 3600 : 86400;
  let gapCount = 0;
  for (let i = 1; i < cleanCandles.length; i++) {
    if (cleanCandles[i].ts - cleanCandles[i - 1].ts > expectedStepSec * 2.5) {
      gapCount += 1;
    }
  }

  const qualityStatus: BacktestDatasetRecord['qualityStatus'] =
    cleanCandles.length < 15 ? 'FAILED' : gapCount > 5 || duplicatesRemoved > 0 || invalidPricesRemoved > 0 ? 'WARNING' : 'VERIFIED';

  const qualityNotes = `Records: ${cleanCandles.length} · Duplicates removed: ${duplicatesRemoved} · Invalid rows: ${invalidPricesRemoved} · Time gaps: ${gapCount}`;

  const datasetHash = crypto.createHash('sha256').update(JSON.stringify(cleanCandles)).digest('hex').slice(0, 16);
  const datasetId = `DS-${fetched.tokenSymbol.replace(/[^A-Z0-9]/gi, '')}-${Date.now().toString(36).toUpperCase()}`;
  const startTime = new Date(cleanCandles[0].ts * 1000).toISOString();
  const endTime = new Date(cleanCandles[cleanCandles.length - 1].ts * 1000).toISOString();
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO BacktestDatasets (
      id, pool_address, token_symbol, token_name, timeframe, source, dataset_hash,
      record_count, start_time, end_time, quality_status, quality_notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    datasetId,
    fetched.poolAddress,
    fetched.tokenSymbol,
    fetched.tokenName,
    params.timeframe,
    fetched.source,
    datasetHash,
    cleanCandles.length,
    startTime,
    endTime,
    qualityStatus,
    qualityNotes,
    nowIso
  );

  const insertCandle = db.prepare(`
    INSERT INTO HistoricalMarketData (dataset_id, ts, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of cleanCandles) {
    insertCandle.run(datasetId, c.ts, c.open, c.high, c.low, c.close, c.volume);
  }

  appendLog({
    agentId: 'journal',
    agentName: 'BACKTEST DATA',
    tokenSymbol: fetched.tokenSymbol,
    eventType: 'INFO',
    message: `Imported real historical dataset ${datasetId}`,
    reason: qualityNotes,
    resultBadge: qualityStatus,
    isPositive: qualityStatus !== 'FAILED',
  });

  return {
    id: datasetId,
    poolAddress: fetched.poolAddress,
    tokenSymbol: fetched.tokenSymbol,
    tokenName: fetched.tokenName,
    timeframe: params.timeframe,
    source: fetched.source,
    datasetHash,
    recordCount: cleanCandles.length,
    startTime,
    endTime,
    qualityStatus,
    qualityNotes,
    createdAt: nowIso,
  };
}

export function runBacktestOnDataset(params: {
  datasetId: string;
  initialCapitalUsd?: number;
  positionSizePct?: number;
  stopLossPct?: number;
  takeProfitX?: number;
  trailingStopPct?: number;
  feePct?: number;
  slippagePct?: number;
}): BacktestSessionRecord {
  const dataset = db.prepare('SELECT * FROM BacktestDatasets WHERE id = ?').get(params.datasetId) as Record<string, unknown> | undefined;
  if (!dataset) {
    throw new Error('DATASET_NOT_FOUND: Invalid Backtest dataset ID.');
  }

  const candles = db
    .prepare('SELECT ts, open, high, low, close, volume FROM HistoricalMarketData WHERE dataset_id = ? ORDER BY ts ASC')
    .all(params.datasetId) as unknown as OhlcvCandle[];

  if (candles.length < 10) {
    throw new Error('INSUFFICIENT_CANDLES: Need at least 10 verified candles to run anti-lookahead backtest.');
  }

  const initialCapital = Math.max(10, params.initialCapitalUsd ?? 50);
  const sizePct = Math.min(25, Math.max(1, params.positionSizePct ?? 10));
  const stopLossPct = Math.min(50, Math.max(2, params.stopLossPct ?? 12));
  const takeProfitX = Math.max(1.1, params.takeProfitX ?? 1.8);
  const trailingStopPct = Math.min(50, Math.max(3, params.trailingStopPct ?? 22));
  const feePct = Math.max(0.05, params.feePct ?? 0.5);
  const slippagePct = Math.max(0.05, params.slippagePct ?? 0.5);

  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;

  let inPosition = false;
  let entryPrice = 0;
  let peakPriceSinceEntry = 0;
  let allocatedUsd = 0;
  let entryTs = 0;

  const trades: Array<{
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    multiplier: number;
    pnlUsd: number;
    reason: string;
  }> = [];

  // Strict anti-lookahead bar-by-bar loop (decisions at bar i use ONLY bars <= i-1 / bar i open)
  for (let i = 4; i < candles.length; i++) {
    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2];
    const prev3 = candles[i - 3];
    const bar = candles[i];

    let enteredThisBar = false;

    if (!inPosition) {
      // Entry signal based strictly on completed prior bars (momentum + volume expansion)
      const avgPriorVol = (prev1.volume + prev2.volume + prev3.volume) / 3;
      const momentumUp = prev1.close > prev2.close && prev1.close > prev3.close;
      const volExpansion = prev1.volume >= avgPriorVol * 1.1;

      if (momentumUp && volExpansion) {
        inPosition = true;
        enteredThisBar = true;
        entryPrice = bar.open * (1 + slippagePct / 100);
        peakPriceSinceEntry = entryPrice;
        allocatedUsd = equity * (sizePct / 100);
        entryTs = bar.ts;
      }
    }

    if (inPosition) {
      // Evaluate Stops & Take Profit conservatively within the same bar (including entry bar)
      const hardStopPrice = entryPrice * (1 - stopLossPct / 100);
      const tpPrice = entryPrice * takeProfitX;
      const priorTrailingStop =
        !enteredThisBar && peakPriceSinceEntry > entryPrice * 1.08
          ? peakPriceSinceEntry * (1 - trailingStopPct / 100)
          : 0;

      let exitPrice: number | null = null;
      let reason = '';

      if (!enteredThisBar && bar.open <= hardStopPrice) {
        // Gap down past hard stop at candle open: cannot fill at optimistic hardStopPrice
        exitPrice = bar.open * (1 - slippagePct / 100);
        reason = `Hard Stop Gap -${stopLossPct}%`;
      } else if (priorTrailingStop > 0 && bar.open <= priorTrailingStop) {
        // Gap down past prior trailing stop at candle open
        exitPrice = bar.open * (1 - slippagePct / 100);
        reason = `Trailing Stop Gap -${trailingStopPct}%`;
      } else if (bar.low <= hardStopPrice) {
        // Intraday hard stop checked conservatively before TP/trailing peak
        exitPrice = Math.min(hardStopPrice, bar.open) * (1 - slippagePct / 100);
        reason = enteredThisBar ? `Hard Stop Entry Bar -${stopLossPct}%` : `Hard Stop -${stopLossPct}%`;
      } else if (priorTrailingStop > 0 && bar.low <= priorTrailingStop) {
        exitPrice = Math.min(priorTrailingStop, bar.open) * (1 - slippagePct / 100);
        reason = `Trailing Stop -${trailingStopPct}%`;
      } else if (bar.high >= tpPrice) {
        // Conservative TP fill at target (never optimistic gap-up above target)
        exitPrice = tpPrice * (1 - slippagePct / 100);
        reason = `Profit Taker ${takeProfitX}x`;
      } else {
        if (bar.high > peakPriceSinceEntry) {
          peakPriceSinceEntry = bar.high;
        }
        const updatedTrailingStop = peakPriceSinceEntry * (1 - trailingStopPct / 100);
        if (peakPriceSinceEntry > entryPrice * 1.08 && bar.close <= updatedTrailingStop) {
          // Price peaked during bar and closed below trailing stop: pessimistic close fill
          exitPrice = Math.min(updatedTrailingStop, bar.close) * (1 - slippagePct / 100);
          reason = `Trailing Stop -${trailingStopPct}%`;
        } else if (i === candles.length - 1) {
          exitPrice = bar.close * (1 - slippagePct / 100);
          reason = 'End of historical dataset';
        }
      }

      if (exitPrice !== null) {
        const safeExitPrice = Math.max(1e-12, exitPrice);
        const grossMult = safeExitPrice / entryPrice;
        const feesUsd = allocatedUsd * (feePct / 100) * 2;
        const rawPnl = allocatedUsd * (grossMult - 1) - feesUsd;
        const pnlUsd = Number(Math.max(-allocatedUsd, rawPnl).toFixed(4));
        equity = Number(Math.max(0, equity + pnlUsd).toFixed(4));

        if (equity > peakEquity) peakEquity = equity;
        const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;

        trades.push({
          entryTime: new Date(entryTs * 1000).toISOString(),
          exitTime: new Date(bar.ts * 1000).toISOString(),
          entryPrice: Number(entryPrice.toFixed(8)),
          exitPrice: Number(safeExitPrice.toFixed(8)),
          multiplier: Number(grossMult.toFixed(3)),
          pnlUsd: Number(pnlUsd.toFixed(2)),
          reason,
        });

        inPosition = false;
      }
    }
  }

  // Failsafe: guarantee no open trade remains unclosed after the final candle
  if (inPosition && candles.length > 0) {
    const lastBar = candles[candles.length - 1];
    const safeExitPrice = Math.max(1e-12, lastBar.close * (1 - slippagePct / 100));
    const grossMult = safeExitPrice / entryPrice;
    const feesUsd = allocatedUsd * (feePct / 100) * 2;
    const pnlUsd = Number(Math.max(-allocatedUsd, allocatedUsd * (grossMult - 1) - feesUsd).toFixed(4));
    equity = Number(Math.max(0, equity + pnlUsd).toFixed(4));
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    trades.push({
      entryTime: new Date(entryTs * 1000).toISOString(),
      exitTime: new Date(lastBar.ts * 1000).toISOString(),
      entryPrice: Number(entryPrice.toFixed(8)),
      exitPrice: Number(safeExitPrice.toFixed(8)),
      multiplier: Number(grossMult.toFixed(3)),
      pnlUsd: Number(pnlUsd.toFixed(2)),
      reason: 'End of historical dataset',
    });
    inPosition = false;
  }

  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const losses = trades.filter((t) => t.pnlUsd <= 0).length;
  const totalTrades = trades.length;
  const winRatePct = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
  const totalReturnPct = Number((((equity - initialCapital) / initialCapital) * 100).toFixed(2));
  const status: BacktestSessionRecord['status'] = totalTrades > 0 ? 'COMPLETED' : 'NO_TRADES';

  const sessionId = `BT-${Date.now().toString(36).toUpperCase()}`;
  const nowIso = new Date().toISOString();
  const tokenSymbol = String(dataset.token_symbol);
  const notes = `Anti-lookahead bar-by-bar simulation on ${candles.length} real candles (${String(dataset.source)}).`;

  db.prepare(`
    INSERT INTO BacktestSessions (
      id, dataset_id, token_symbol, software_version, initial_capital_usd, final_capital_usd,
      total_return_pct, total_trades, wins, losses, win_rate_pct, max_drawdown_pct,
      stop_loss_pct, take_profit_x, trailing_stop_pct, fee_pct, slippage_pct, status, notes, trades_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    params.datasetId,
    tokenSymbol,
    'v1.0-night',
    initialCapital,
    Number(equity.toFixed(2)),
    totalReturnPct,
    totalTrades,
    wins,
    losses,
    winRatePct,
    Number(maxDrawdownPct.toFixed(2)),
    stopLossPct,
    takeProfitX,
    trailingStopPct,
    feePct,
    slippagePct,
    status,
    notes,
    JSON.stringify(trades),
    nowIso
  );

  appendLog({
    agentId: 'journal',
    agentName: 'BACKTEST ENGINE',
    tokenSymbol,
    eventType: 'INFO',
    message: `Backtest ${sessionId} ${status}: ${totalTrades} trades (${winRatePct}% WR)`,
    reason: `Return ${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct}% · MaxDD ${maxDrawdownPct.toFixed(2)}%`,
    resultBadge: `${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct}%`,
    isPositive: totalReturnPct >= 0,
  });

  return {
    id: sessionId,
    datasetId: params.datasetId,
    tokenSymbol,
    softwareVersion: 'v1.0-night',
    initialCapitalUsd: initialCapital,
    finalCapitalUsd: Number(equity.toFixed(2)),
    totalReturnPct,
    totalTrades,
    wins,
    losses,
    winRatePct,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    stopLossPct,
    takeProfitX,
    trailingStopPct,
    feePct,
    slippagePct,
    status,
    notes,
    tradesJson: JSON.stringify(trades),
    createdAt: nowIso,
  };
}
