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

export async function fetchLiveTokenPriceUsd(
  mintAddress: string
): Promise<{ priceUsd: number; source: string } | null> {
  if (!isValidSolanaBase58(mintAddress)) return null;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mintAddress)}`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      pairs?: Array<{ chainId?: string; priceUsd?: string; liquidity?: { usd?: number } }>;
    };
    assertReadOnlyPayload(json, 'DexScreener Token Price');
    const bestPair = (json.pairs ?? [])
      .filter((p) => p.chainId === 'solana' && safeNum(p.priceUsd, 0) > 0)
      .sort((a, b) => safeNum(b.liquidity?.usd, 0) - safeNum(a.liquidity?.usd, 0))[0];

    const price = bestPair ? safeNum(bestPair.priceUsd, 0) : 0;
    if (price > 0) {
      return { priceUsd: price, source: 'DexScreener Solana Live' };
    }
  } catch {
    // Caller handles null fallback to latest verified TokenMetadata price
  }
  return null;
}

const EXCLUDED_BASE_MINTS = new Set<string>([
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

function safeNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function mapDexScreenerPair(
  p: Record<string, unknown>,
  source: string,
  nowIso: string
): DexPairQuote | null {
  if (p.chainId !== 'solana') return null;
  const base = p.baseToken as { address?: string; symbol?: string; name?: string } | undefined;
  if (!base?.address || !isValidSolanaBase58(base.address) || EXCLUDED_BASE_MINTS.has(base.address)) {
    return null;
  }
  const priceUsd = safeNum(p.priceUsd, 0);
  if (priceUsd <= 0) return null;

  const pc = (p.priceChange ?? {}) as Record<string, unknown>;
  const liq = (p.liquidity ?? {}) as Record<string, unknown>;
  const vol = (p.volume ?? {}) as Record<string, unknown>;
  const txns = (p.txns ?? {}) as {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
  };
  const buys = safeNum(txns.h1?.buys ?? txns.m5?.buys, 0);
  const sells = safeNum(txns.h1?.sells ?? txns.m5?.sells, 0);
  const totalTx = buys + sells;
  const buyRatioPct = totalTx > 0 ? Number(((buys / totalTx) * 100).toFixed(1)) : 50;
  const createdMs = typeof p.pairCreatedAt === 'number' && Number.isFinite(p.pairCreatedAt) ? p.pairCreatedAt : null;
  const pairAgeHours = createdMs ? Number(Math.max(0, (Date.now() - createdMs) / 3600000).toFixed(2)) : null;

  return {
    mintAddress: base.address,
    symbol: `$${String(base.symbol ?? 'TOKEN').replace(/^\$/, '').slice(0, 18)}`,
    name: String(base.name ?? base.symbol ?? 'Solana Token').slice(0, 64),
    pairAddress: String(p.pairAddress ?? ''),
    dexId: String(p.dexId ?? 'raydium'),
    priceUsd,
    priceChange5m: safeNum(pc.m5, 0),
    priceChange1h: safeNum(pc.h1, 0),
    priceChange24h: safeNum(pc.h24, 0),
    liquidityUsd: safeNum(liq.usd, 0),
    volume5mUsd: safeNum(vol.m5, 0),
    volume1hUsd: safeNum(vol.h1, 0),
    volume24hUsd: safeNum(vol.h24, 0),
    buyRatioPct,
    pairAgeHours,
    fdvUsd: safeNum(p.fdv ?? p.marketCap, 0),
    source,
    sourceTimestamp: nowIso,
  };
}

export async function fetchLiveSolanaDexPairs(query = 'solana'): Promise<DexPairQuote[]> {
  // Fetch latest Solana token boosts + active search results concurrently
  const byMint = new Map<string, DexPairQuote>();
  const nowIso = new Date().toISOString();

  const upsertCandidate = (cand: DexPairQuote | null) => {
    if (!cand) return;
    const prev = byMint.get(cand.mintAddress);
    if (!prev || cand.liquidityUsd > prev.liquidityUsd) {
      byMint.set(cand.mintAddress, cand);
    }
  };

  const fetchSearchPairs = async (q: string) => {
    try {
      const searchRes = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(7000) }
      );
      if (searchRes.ok) {
        const searchJson = (await searchRes.json()) as { pairs?: Array<Record<string, unknown>> };
        assertReadOnlyPayload(searchJson, 'DexScreener Search');
        for (const p of searchJson.pairs ?? []) {
          upsertCandidate(mapDexScreenerPair(p, 'DexScreener Search API', nowIso));
        }
      }
    } catch {
      // Non-fatal fallback
    }
  };

  const fetchBoostPairs = async () => {
    try {
      const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', {
        signal: AbortSignal.timeout(7000),
      });
      if (boostsRes.ok) {
        const boosts = (await boostsRes.json()) as Array<{ chainId?: string; tokenAddress?: string }>;
        assertReadOnlyPayload(boosts, 'DexScreener Boosts');
        const solMints = Array.from(
          new Set(
            boosts
              .filter(
                (b) =>
                  b.chainId === 'solana' &&
                  b.tokenAddress &&
                  isValidSolanaBase58(b.tokenAddress) &&
                  !EXCLUDED_BASE_MINTS.has(b.tokenAddress)
              )
              .map((b) => b.tokenAddress as string)
          )
        ).slice(0, 10);

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
              upsertCandidate(mapDexScreenerPair(p, 'DexScreener Live API', nowIso));
            }
          }
        }
      }
    } catch {
      // Non-fatal fallback
    }
  };

  await Promise.all([
    fetchBoostPairs(),
    fetchSearchPairs(query),
    fetchSearchPairs('pumpswap solana'),
  ]);

  return Array.from(byMint.values())
    .sort((a, b) => {
      const scoreA = a.volume5mUsd * 4 + a.volume1hUsd + Math.min(a.liquidityUsd, 300000);
      const scoreB = b.volume5mUsd * 4 + b.volume1hUsd + Math.min(b.liquidityUsd, 300000);
      return scoreB - scoreA;
    })
    .slice(0, 14);
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

  const ohlcvUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=1&limit=${Math.min(Math.max(limit, 24), 300)}`;

  let ohlcvRes = await fetch(ohlcvUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
  });
  if (ohlcvRes.status === 429) {
    await new Promise((r) => setTimeout(r, 1800));
    ohlcvRes = await fetch(ohlcvUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
  }

  if (!ohlcvRes.ok) {
    throw new Error(
      ohlcvRes.status === 429
        ? 'GeckoTerminal đang giới hạn tần suất (HTTP 429). Vui lòng chờ vài giây rồi thử lại.'
        : `GECKOTERMINAL_HTTP_${ohlcvRes.status}: Không tải được dữ liệu OHLCV thật cho pool ${poolAddress}`
    );
  }

  const ohlcvJson = (await ohlcvRes.json()) as {
    data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
    meta?: {
      base?: { symbol?: string; name?: string };
      quote?: { symbol?: string };
    };
  };
  assertReadOnlyPayload(ohlcvJson, 'GeckoTerminal OHLCV');

  const baseSym = ohlcvJson.meta?.base?.symbol?.trim();
  const quoteSym = ohlcvJson.meta?.quote?.symbol?.trim();
  let tokenSymbol = baseSym ? `$${baseSym.replace(/^\$/, '')}` : 'SOL_POOL';
  let tokenName =
    baseSym && quoteSym
      ? `${baseSym} / ${quoteSym}`
      : ohlcvJson.meta?.base?.name || `Solana Pool ${poolAddress.slice(0, 6)}`;

  if (!baseSym) {
    try {
      const poolInfoUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}`;
      const poolRes = await fetch(poolInfoUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
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
    } catch {
      // Optional enrichment only
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
