import { appendLog } from './db.ts';
import { isValidSolanaBase58 } from './solanaRpc.ts';

export interface DexPairQuote {
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
  volume5mUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buyRatioPct: number;
  pairAgeHours: number | null;
  fdvUsd: number;
  source: string;
  sourceTimestamp: string;
}

export interface OhlcvCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const FORBIDDEN_TX_FIELDS = ['swapTransaction', 'serializedTransaction', 'rawTransaction', 'transaction'];

function assertReadOnlyPayload(payload: unknown, sourceName: string) {
  if (!payload || typeof payload !== 'object') return;
  const serialized = JSON.stringify(payload);
  for (const field of FORBIDDEN_TX_FIELDS) {
    if (serialized.includes(`"${field}"`)) {
      appendLog({
        agentId: 'SYSTEM',
        agentName: 'SECURITY GUARD',
        eventType: 'WARN',
        message: `Rejected DEX payload from ${sourceName}`,
        reason: `Contains forbidden executable field: ${field}`,
        resultBadge: 'BLOCKED',
        isPositive: false,
      });
      throw new Error(`SECURITY_VIOLATION: Executable transaction field (${field}) rejected in Read-Only mode.`);
    }
  }
}

export async function fetchLiveSolPrice(): Promise<{ priceUsd: number; source: string }> {
  try {
    // DexScreener Wrapped SOL USDC/SOL pair (read-only market quote)
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112',
      { signal: AbortSignal.timeout(7000) }
    );
    if (res.ok) {
      const json = (await res.json()) as {
        pairs?: Array<{ chainId?: string; priceUsd?: string; liquidity?: { usd?: number } }>;
      };
      assertReadOnlyPayload(json, 'DexScreener SOL');
      const solPair = (json.pairs ?? [])
        .filter((p) => p.chainId === 'solana' && p.priceUsd && Number(p.priceUsd) > 10)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (solPair?.priceUsd) {
        return {
          priceUsd: Number(Number(solPair.priceUsd).toFixed(2)),
          source: 'DexScreener Solana Live',
        };
      }
    }
  } catch {
    // Fallback below
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const json = (await res.json()) as { solana?: { usd?: number } };
      if (json.solana?.usd) {
        return {
          priceUsd: Number(json.solana.usd.toFixed(2)),
          source: 'CoinGecko Live',
        };
      }
    }
  } catch {
    // Return fallback indicator
  }

  return { priceUsd: 0, source: 'Unavailable (Offline/Rate-Limited)' };
}

export async function fetchLiveSolanaDexPairs(query = 'solana pump'): Promise<DexPairQuote[]> {
  // Fetch latest Solana token boosts + search for active Solana pairs
  const results: DexPairQuote[] = [];
  const seenMints = new Set<string>();
  const nowIso = new Date().toISOString();

  try {
    const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', {
      signal: AbortSignal.timeout(7000),
    });
    if (boostsRes.ok) {
      const boosts = (await boostsRes.json()) as Array<{ chainId?: string; tokenAddress?: string }>;
      assertReadOnlyPayload(boosts, 'DexScreener Boosts');
      const solMints = boosts
        .filter((b) => b.chainId === 'solana' && b.tokenAddress && isValidSolanaBase58(b.tokenAddress))
        .slice(0, 6)
        .map((b) => b.tokenAddress as string);

      if (solMints.length > 0) {
        const pairRes = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${solMints.join(',')}`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (pairRes.ok) {
          const pairJson = (await pairRes.json()) as {
            pairs?: Array<Record<string, unknown>>;
          };
          assertReadOnlyPayload(pairJson, 'DexScreener Pairs');
          for (const p of pairJson.pairs ?? []) {
            if (p.chainId !== 'solana') continue;
            const base = p.baseToken as { address?: string; symbol?: string; name?: string } | undefined;
            if (!base?.address || seenMints.has(base.address)) continue;
            seenMints.add(base.address);
            const pc = (p.priceChange ?? {}) as Record<string, number>;
            const liq = (p.liquidity ?? {}) as Record<string, number>;
            const vol = (p.volume ?? {}) as Record<string, number>;
            const txns = (p.txns ?? {}) as { m5?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number } };
            const buys = Number(txns.h1?.buys ?? txns.m5?.buys ?? 0);
            const sells = Number(txns.h1?.sells ?? txns.m5?.sells ?? 0);
            const totalTx = buys + sells;
            const buyRatioPct = totalTx > 0 ? Number(((buys / totalTx) * 100).toFixed(1)) : 50;
            const createdMs = typeof p.pairCreatedAt === 'number' ? p.pairCreatedAt : null;
            const pairAgeHours = createdMs ? Number(((Date.now() - createdMs) / 3600000).toFixed(2)) : null;

            results.push({
              mintAddress: base.address,
              symbol: `$${String(base.symbol ?? 'TOKEN').replace(/^\$/, '')}`,
              name: String(base.name ?? base.symbol ?? 'Solana Token'),
              pairAddress: String(p.pairAddress ?? ''),
              dexId: String(p.dexId ?? 'raydium'),
              priceUsd: Number(p.priceUsd ?? 0),
              priceChange5m: Number(pc.m5 ?? 0),
              priceChange1h: Number(pc.h1 ?? 0),
              priceChange24h: Number(pc.h24 ?? 0),
              liquidityUsd: Number(liq.usd ?? 0),
              volume5mUsd: Number(vol.m5 ?? 0),
              volume1hUsd: Number(vol.h1 ?? 0),
              volume24hUsd: Number(vol.h24 ?? 0),
              buyRatioPct,
              pairAgeHours,
              fdvUsd: Number(p.fdv ?? p.marketCap ?? 0),
              source: 'DexScreener Live API',
              sourceTimestamp: nowIso,
            });
          }
        }
      }
    }
  } catch {
    // Continue to search fallback
  }

  if (results.length < 4) {
    try {
      const searchRes = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(7000) }
      );
      if (searchRes.ok) {
        const searchJson = (await searchRes.json()) as { pairs?: Array<Record<string, unknown>> };
        assertReadOnlyPayload(searchJson, 'DexScreener Search');
        for (const p of searchJson.pairs ?? []) {
          if (p.chainId !== 'solana') continue;
          const base = p.baseToken as { address?: string; symbol?: string; name?: string } | undefined;
          if (!base?.address || seenMints.has(base.address)) continue;
          seenMints.add(base.address);
          const pc = (p.priceChange ?? {}) as Record<string, number>;
          const liq = (p.liquidity ?? {}) as Record<string, number>;
          const vol = (p.volume ?? {}) as Record<string, number>;
          const txns = (p.txns ?? {}) as { m5?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number } };
          const buys = Number(txns.h1?.buys ?? txns.m5?.buys ?? 0);
          const sells = Number(txns.h1?.sells ?? txns.m5?.sells ?? 0);
          const totalTx = buys + sells;
          const buyRatioPct = totalTx > 0 ? Number(((buys / totalTx) * 100).toFixed(1)) : 50;
          const createdMs = typeof p.pairCreatedAt === 'number' ? p.pairCreatedAt : null;
          const pairAgeHours = createdMs ? Number(((Date.now() - createdMs) / 3600000).toFixed(2)) : null;

          results.push({
            mintAddress: base.address,
            symbol: `$${String(base.symbol ?? 'TOKEN').replace(/^\$/, '')}`,
            name: String(base.name ?? base.symbol ?? 'Solana Token'),
            pairAddress: String(p.pairAddress ?? ''),
            dexId: String(p.dexId ?? 'raydium'),
            priceUsd: Number(p.priceUsd ?? 0),
            priceChange5m: Number(pc.m5 ?? 0),
            priceChange1h: Number(pc.h1 ?? 0),
            priceChange24h: Number(pc.h24 ?? 0),
            liquidityUsd: Number(liq.usd ?? 0),
            volume5mUsd: Number(vol.m5 ?? 0),
            volume1hUsd: Number(vol.h1 ?? 0),
            volume24hUsd: Number(vol.h24 ?? 0),
            buyRatioPct,
            pairAgeHours,
            fdvUsd: Number(p.fdv ?? p.marketCap ?? 0),
            source: 'DexScreener Search API',
            sourceTimestamp: nowIso,
          });
          if (results.length >= 8) break;
        }
      }
    } catch {
      // Handled by caller
    }
  }

  return results;
}

export async function fetchGeckoTerminalSolanaOhlcv(
  poolAddress: string,
  timeframe: 'minute' | 'hour' | 'day' = 'hour',
  limit = 120
): Promise<{
  poolAddress: string;
  tokenSymbol: string;
  tokenName: string;
  candles: OhlcvCandle[];
  source: string;
}> {
  if (!isValidSolanaBase58(poolAddress)) {
    throw new Error('INVALID_POOL_ADDRESS: Must be a valid Solana Base58 pool address.');
  }

  const poolInfoUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}`;
  const ohlcvUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=1&limit=${Math.min(Math.max(limit, 24), 300)}`;

  const [poolRes, ohlcvRes] = await Promise.all([
    fetch(poolInfoUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) }),
    fetch(ohlcvUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) }),
  ]);

  if (!ohlcvRes.ok) {
    throw new Error(`GECKOTERMINAL_HTTP_${ohlcvRes.status}: Could not fetch real OHLCV for pool ${poolAddress}`);
  }

  const ohlcvJson = (await ohlcvRes.json()) as {
    data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
  };
  assertReadOnlyPayload(ohlcvJson, 'GeckoTerminal OHLCV');

  let tokenSymbol = 'SOL_POOL';
  let tokenName = `Solana Pool ${poolAddress.slice(0, 6)}`;
  if (poolRes.ok) {
    const poolJson = (await poolRes.json()) as {
      data?: { attributes?: { name?: string } };
    };
    const poolName = poolJson.data?.attributes?.name;
    if (poolName) {
      tokenName = poolName;
      tokenSymbol = `$${poolName.split('/')[0].trim()}`;
    }
  }

  const rawList = ohlcvJson.data?.attributes?.ohlcv_list ?? [];
  // GeckoTerminal returns newest first; sort ascending by timestamp to prevent look-ahead / order bias
  const candles: OhlcvCandle[] = rawList
    .map(([ts, open, high, low, close, volume]) => ({
      ts: Number(ts),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }))
    .sort((a, b) => a.ts - b.ts);

  return {
    poolAddress,
    tokenSymbol,
    tokenName,
    candles,
    source: `GeckoTerminal Solana Mainnet (${timeframe})`,
  };
}
