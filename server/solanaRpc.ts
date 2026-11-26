import type { TokenAccountInfo } from '../src/types/terminal.ts';

const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaBase58(value: string): boolean {
  return BASE58_REGEX.test(value.trim());
}

export function looksLikeSecretOrMnemonic(value: string): boolean {
  const trimmed = value.trim();
  const words = trimmed.split(/\s+/);
  if (words.length >= 12) return true;
  if (trimmed.length > 52) return true;
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return true;
  return false;
}

interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

async function callSolanaRpc<T>(method: string, params: unknown[] = []): Promise<{ data: T; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch(SOLANA_MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });

  const latencyMs = Date.now() - started;

  if (res.status === 429) {
    throw new Error('RATE_LIMITED: Solana Mainnet RPC rate limit reached (HTTP 429)');
  }
  if (!res.ok) {
    throw new Error(`RPC_HTTP_${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as RpcResponse<T>;
  if (json.error) {
    throw new Error(`RPC_ERROR_${json.error.code}: ${json.error.message}`);
  }
  if (json.result === undefined) {
    throw new Error('RPC_EMPTY_RESULT: Missing result payload');
  }
  return { data: json.result, latencyMs };
}

export async function getSolanaRpcHealth(): Promise<{
  ok: boolean;
  slot: number | null;
  latencyMs: number | null;
  error: string | null;
}> {
  try {
    const { data, latencyMs } = await callSolanaRpc<number>('getSlot', [{ commitment: 'confirmed' }]);
    return { ok: true, slot: data, latencyMs, error: null };
  } catch (err) {
    return {
      ok: false,
      slot: null,
      latencyMs: null,
      error: err instanceof Error ? err.message : 'Unknown RPC error',
    };
  }
}

export async function readWalletOnChain(publicAddress: string): Promise<{
  solBalance: number;
  tokenAccounts: TokenAccountInfo[];
  signatures: Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>;
  latencyMs: number;
}> {
  if (!isValidSolanaBase58(publicAddress)) {
    throw new Error('INVALID_ADDRESS: Provided string is not a valid Solana Base58 public address.');
  }

  const balRes = await callSolanaRpc<{ value: number }>('getBalance', [
    publicAddress,
    { commitment: 'confirmed' },
  ]);
  const solBalance = Number((balRes.data.value / 1_000_000_000).toFixed(6));

  const [splRes, t22Res, sigRes] = await Promise.all([
    callSolanaRpc<{ value: Array<{ pubkey: string; account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null; decimals: number } } } } } }> }>(
      'getTokenAccountsByOwner',
      [publicAddress, { programId: SPL_TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }]
    ),
    callSolanaRpc<{ value: Array<{ pubkey: string; account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null; decimals: number } } } } } }> }>(
      'getTokenAccountsByOwner',
      [publicAddress, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: 'jsonParsed' }]
    ).catch(() => ({ data: { value: [] }, latencyMs: 0 })),
    callSolanaRpc<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>>(
      'getSignaturesForAddress',
      [publicAddress, { limit: 10 }]
    ).catch(() => ({ data: [], latencyMs: 0 })),
  ]);

  const mapAccounts = (
    items: Array<{ pubkey: string; account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null; decimals: number } } } } } }>,
    program: TokenAccountInfo['program']
  ): TokenAccountInfo[] =>
    items.map((item) => {
      const info = item.account.data.parsed.info;
      return {
        tokenAccount: item.pubkey,
        mint: info.mint,
        symbol: `${info.mint.slice(0, 4)}..${info.mint.slice(-3)}`,
        amount: info.tokenAmount.uiAmount ?? 0,
        decimals: info.tokenAmount.decimals,
        program,
      };
    });

  const tokenAccounts = [
    ...mapAccounts(splRes.data.value, 'SPL Token'),
    ...mapAccounts(t22Res.data.value, 'Token-2022'),
  ];

  return {
    solBalance,
    tokenAccounts,
    signatures: sigRes.data,
    latencyMs: balRes.latencyMs,
  };
}

export async function auditMintAuthoritiesOnChain(mintAddress: string): Promise<{
  checked: boolean;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  decimals: number | null;
  supply: string | null;
  error: string | null;
}> {
  if (!isValidSolanaBase58(mintAddress)) {
    return {
      checked: false,
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      decimals: null,
      supply: null,
      error: 'Invalid Base58 mint address',
    };
  }

  try {
    const { data } = await callSolanaRpc<{
      value: {
        data: {
          parsed?: {
            info?: {
              mintAuthority?: string | null;
              freezeAuthority?: string | null;
              decimals?: number;
              supply?: string;
            };
          };
        };
      } | null;
    }>('getAccountInfo', [mintAddress, { encoding: 'jsonParsed' }]);

    const info = data.value?.data?.parsed?.info;
    if (!info) {
      return {
        checked: false,
        mintAuthorityRevoked: null,
        freezeAuthorityRevoked: null,
        decimals: null,
        supply: null,
        error: 'Mint account not parsed on Mainnet',
      };
    }

    return {
      checked: true,
      mintAuthorityRevoked: info.mintAuthority === null || info.mintAuthority === undefined,
      freezeAuthorityRevoked: info.freezeAuthority === null || info.freezeAuthority === undefined,
      decimals: info.decimals ?? null,
      supply: info.supply ?? null,
      error: null,
    };
  } catch (err) {
    return {
      checked: false,
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      decimals: null,
      supply: null,
      error: err instanceof Error ? err.message : 'RPC audit error',
    };
  }
}
