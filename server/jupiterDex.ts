import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { DexRouterOption, DexTokenOption, JupiterQuoteSummary } from '../src/types/terminal.ts';
import { auditMintAuthoritiesOnChain, isValidSolanaBase58, looksLikeSecretOrMnemonic } from './solanaRpc.ts';

const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

const JUPITER_QUOTE_ENDPOINTS = [
  'https://lite-api.jup.ag/swap/v1/quote',
  'https://quote-api.jup.ag/v6/quote',
];

const JUPITER_SWAP_ENDPOINTS = [
  'https://lite-api.jup.ag/swap/v1/swap',
  'https://quote-api.jup.ag/v6/swap',
];

export const CURATED_SOLANA_TOKENS: DexTokenOption[] = [
  {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    verified: true,
    source: 'Solana Native',
  },
  {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    verified: true,
    source: 'Circle Solana',
  },
  {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    verified: true,
    source: 'Tether Solana',
  },
  {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    verified: true,
    source: 'Jupiter DAO',
  },
  {
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    symbol: 'RAY',
    name: 'Raydium',
    decimals: 6,
    verified: true,
    source: 'Raydium DEX',
  },
  {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    verified: true,
    source: 'Solana Community',
  },
  {
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: 'WIF',
    name: 'dogwifhat',
    decimals: 6,
    verified: true,
    source: 'Solana Meme',
  },
  {
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    symbol: 'POPCAT',
    name: 'Popcat (SOL)',
    decimals: 9,
    verified: true,
    source: 'Solana Meme',
  },
];

const CURATED_BY_MINT = new Map(CURATED_SOLANA_TOKENS.map((t) => [t.mint, t]));

export async function resolveTokenDecimalsAndAudit(mintAddress: string): Promise<{
  mint: string;
  decimals: number;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  verified: boolean;
}> {
  const mint = mintAddress.trim();
  if (!isValidSolanaBase58(mint)) {
    throw new Error('Địa chỉ Mint Solana không hợp lệ (Base58).');
  }

  const curated = CURATED_BY_MINT.get(mint);
  if (curated) {
    return {
      mint,
      decimals: curated.decimals,
      mintAuthorityRevoked: mint === 'So11111111111111111111111111111111111111112' ? true : null,
      freezeAuthorityRevoked: mint === 'So11111111111111111111111111111111111111112' ? true : null,
      verified: true,
    };
  }

  const audit = await auditMintAuthoritiesOnChain(mint);
  if (!audit.checked || audit.decimals === null) {
    throw new Error(audit.error || 'Không tìm thấy thông tin Mint trên Solana Mainnet.');
  }

  return {
    mint,
    decimals: audit.decimals,
    mintAuthorityRevoked: audit.mintAuthorityRevoked,
    freezeAuthorityRevoked: audit.freezeAuthorityRevoked,
    verified: false,
  };
}

function mapDexFilterToJupiterParam(dexFilter: DexRouterOption): string | null {
  switch (dexFilter) {
    case 'RAYDIUM':
      return 'Raydium,Raydium CLMM,Raydium CP';
    case 'ORCA':
      return 'Whirlpool,Orca V2';
    case 'METEORA':
      return 'Meteora,Meteora DLMM';
    case 'PUMP_FUN':
      return 'Pump.fun,Pump.fun Amm';
    default:
      return null;
  }
}

function uiToAtomicAmountString(amountUi: number, decimals: number): string {
  if (!Number.isFinite(amountUi) || amountUi <= 0) {
    throw new Error('Số lượng hoán đổi phải lớn hơn 0.');
  }
  const factor = Math.pow(10, Math.min(12, Math.max(0, decimals)));
  const atomic = Math.floor(amountUi * factor);
  if (!Number.isFinite(atomic) || atomic <= 0) {
    throw new Error('Số lượng quá nhỏ sau khi quy đổi đơn vị tối thiểu.');
  }
  return String(atomic);
}

function atomicToUi(raw: string | number, decimals: number): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, Math.min(12, Math.max(0, decimals)));
  return Number((num / factor).toFixed(Math.min(8, Math.max(4, decimals))));
}

export async function fetchJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amountUi: number;
  slippageBps: number;
  dexFilter?: DexRouterOption;
}): Promise<JupiterQuoteSummary> {
  const inputMint = params.inputMint.trim();
  const outputMint = params.outputMint.trim();

  if (!isValidSolanaBase58(inputMint) || !isValidSolanaBase58(outputMint)) {
    throw new Error('Địa chỉ Mint đầu vào/đầu ra không đúng định dạng Solana Base58.');
  }
  if (inputMint === outputMint) {
    throw new Error('Token đầu vào và token đầu ra không được trùng nhau.');
  }

  const slippageBps = Math.min(1500, Math.max(10, Math.round(params.slippageBps || 50)));
  const [inInfo, outInfo] = await Promise.all([
    resolveTokenDecimalsAndAudit(inputMint),
    resolveTokenDecimalsAndAudit(outputMint),
  ]);

  const atomicAmount = uiToAtomicAmountString(params.amountUi, inInfo.decimals);
  const dexParam = mapDexFilterToJupiterParam(params.dexFilter ?? 'AUTO');

  const query = new URLSearchParams({
    inputMint,
    outputMint,
    amount: atomicAmount,
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: 'true',
  });
  if (dexParam) {
    query.set('dexes', dexParam);
  }

  let lastError = 'Không thể kết nối Jupiter Aggregator API.';
  for (const endpoint of JUPITER_QUOTE_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}?${query.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastError = `Jupiter Quote HTTP ${res.status}${text ? `: ${text.slice(0, 140)}` : ''}`;
        continue;
      }
      const quote = (await res.json()) as Record<string, unknown>;
      if (!quote.outAmount || !quote.inAmount) {
        lastError = 'Jupiter không tìm thấy tuyến thanh khoản khả dụng cho cặp này.';
        continue;
      }

      const routePlan = Array.isArray(quote.routePlan)
        ? (quote.routePlan as Array<{ swapInfo?: { label?: string } }>)
        : [];
      const routeLabels = Array.from(
        new Set(
          routePlan
            .map((step) => step.swapInfo?.label)
            .filter((lbl): lbl is string => Boolean(lbl && lbl.trim().length > 0))
        )
      );

      const inAmountRaw = String(quote.inAmount);
      const outAmountRaw = String(quote.outAmount);
      const otherAmountThresholdRaw = String(quote.otherAmountThreshold ?? quote.outAmount);

      return {
        inputMint,
        outputMint,
        inAmountRaw,
        outAmountRaw,
        otherAmountThresholdRaw,
        inAmountUi: atomicToUi(inAmountRaw, inInfo.decimals),
        outAmountUi: atomicToUi(outAmountRaw, outInfo.decimals),
        minOutAmountUi: atomicToUi(otherAmountThresholdRaw, outInfo.decimals),
        inputDecimals: inInfo.decimals,
        outputDecimals: outInfo.decimals,
        slippageBps,
        priceImpactPct: Number((Number(quote.priceImpactPct ?? 0) * 100).toFixed(3)),
        routeLabels: routeLabels.length > 0 ? routeLabels : ['Jupiter Best Route'],
        rawQuoteResponse: quote,
        quotedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Lỗi kết nối Jupiter Quote';
    }
  }

  throw new Error(lastError);
}

export async function buildJupiterSwapTransaction(params: {
  userPublicKey: string;
  quoteResponse: Record<string, unknown>;
  priorityFeeLamports?: number;
}): Promise<{
  swapTransaction: string;
  lastValidBlockHeight: number | null;
  prioritizationFeeLamports: number;
}> {
  const userPublicKey = params.userPublicKey.trim();
  if (looksLikeSecretOrMnemonic(userPublicKey) || !isValidSolanaBase58(userPublicKey)) {
    throw new Error('Địa chỉ ví Phantom không hợp lệ (chỉ chấp nhận Public Key Base58).');
  }
  if (
    !params.quoteResponse ||
    typeof params.quoteResponse !== 'object' ||
    typeof params.quoteResponse.inAmount !== 'string' ||
    typeof params.quoteResponse.outAmount !== 'string'
  ) {
    throw new Error('Dữ liệu báo giá Jupiter không hợp lệ hoặc đã hết hạn. Vui lòng lấy báo giá lại.');
  }

  const priorityFeeLamports = Math.min(
    5_000_000,
    Math.max(0, Math.round(params.priorityFeeLamports ?? 100_000))
  );

  const body = {
    quoteResponse: params.quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: priorityFeeLamports,
  };

  let lastError = 'Không thể khởi tạo giao dịch hoán đổi trên Jupiter.';
  for (const endpoint of JUPITER_SWAP_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastError = `Jupiter Swap HTTP ${res.status}${text ? `: ${text.slice(0, 140)}` : ''}`;
        continue;
      }
      const json = (await res.json()) as {
        swapTransaction?: string;
        lastValidBlockHeight?: number;
        prioritizationFeeLamports?: number;
      };
      if (!json.swapTransaction || typeof json.swapTransaction !== 'string') {
        lastError = 'Jupiter không trả về swapTransaction hợp lệ.';
        continue;
      }
      return {
        swapTransaction: json.swapTransaction,
        lastValidBlockHeight: json.lastValidBlockHeight ?? null,
        prioritizationFeeLamports: json.prioritizationFeeLamports ?? priorityFeeLamports,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Lỗi khởi tạo giao dịch Jupiter';
    }
  }

  throw new Error(lastError);
}

export async function simulateSolanaTransaction(swapTransactionBase64: string): Promise<{
  ok: boolean;
  err: string | null;
  unitsConsumed: number | null;
  logs: string[];
}> {
  if (!swapTransactionBase64 || typeof swapTransactionBase64 !== 'string') {
    throw new Error('Thiếu dữ liệu giao dịch Base64 để mô phỏng.');
  }

  const res = await fetch(SOLANA_MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: [
        swapTransactionBase64,
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'processed',
        },
      ],
    }),
    signal: AbortSignal.timeout(9000),
  });

  if (!res.ok) {
    throw new Error(`Solana RPC simulate HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    result?: {
      value?: {
        err: unknown;
        logs?: string[];
        unitsConsumed?: number;
      };
    };
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(json.error.message || 'Solana RPC simulation error');
  }

  const val = json.result?.value;
  if (!val) {
    throw new Error('Phản hồi mô phỏng từ Solana RPC trống.');
  }

  return {
    ok: val.err === null,
    err: val.err ? JSON.stringify(val.err) : null,
    unitsConsumed: typeof val.unitsConsumed === 'number' ? val.unitsConsumed : null,
    logs: Array.isArray(val.logs) ? val.logs.slice(0, 12) : [],
  };
}

export async function broadcastSignedSolanaTx(signedTxBase64: string): Promise<string> {
  if (!signedTxBase64 || typeof signedTxBase64 !== 'string') {
    throw new Error('Thiếu giao dịch đã ký hợp lệ.');
  }
  const res = await fetch(SOLANA_MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        signedTxBase64,
        {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`Solana RPC sendTransaction HTTP ${res.status}`);
  }

  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error || !json.result) {
    throw new Error(json.error?.message || 'Gửi giao dịch lên Solana Mainnet thất bại.');
  }
  return json.result;
}

export async function verifySignatureOnChain(signature: string): Promise<{
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  confirmationStatus: string | null;
  errorMessage: string | null;
}> {
  const sig = signature.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(sig)) {
    throw new Error('Chữ ký giao dịch Solana (Signature) không hợp lệ.');
  }

  try {
    const res = await fetch(SOLANA_MAINNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignatureStatuses',
        params: [[sig], { searchTransactionHistory: true }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { status: 'PENDING', confirmationStatus: null, errorMessage: null };
    }
    const json = (await res.json()) as {
      result?: {
        value?: Array<{
          err: unknown;
          confirmationStatus?: string;
        } | null>;
      };
    };
    const info = json.result?.value?.[0];
    if (!info) {
      return { status: 'PENDING', confirmationStatus: null, errorMessage: null };
    }
    if (info.err) {
      return {
        status: 'FAILED',
        confirmationStatus: info.confirmationStatus ?? null,
        errorMessage: JSON.stringify(info.err),
      };
    }
    if (info.confirmationStatus === 'confirmed' || info.confirmationStatus === 'finalized') {
      return {
        status: 'CONFIRMED',
        confirmationStatus: info.confirmationStatus,
        errorMessage: null,
      };
    }
    return {
      status: 'PENDING',
      confirmationStatus: info.confirmationStatus ?? null,
      errorMessage: null,
    };
  } catch {
    return { status: 'PENDING', confirmationStatus: null, errorMessage: null };
  }
}

export async function buildSolanaTransferTransaction(params: {
  fromAddress: string;
  toAddress: string;
  mintAddress: string;
  amountUi: number;
}): Promise<{
  transactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
  decimals: number;
  feeEstimateSol: number;
}> {
  const fromAddr = params.fromAddress.trim();
  const toAddr = params.toAddress.trim();
  const mintAddr = params.mintAddress.trim() || SOL_NATIVE_MINT;

  if (
    looksLikeSecretOrMnemonic(fromAddr) ||
    looksLikeSecretOrMnemonic(toAddr) ||
    !isValidSolanaBase58(fromAddr) ||
    !isValidSolanaBase58(toAddr)
  ) {
    throw new Error('Địa chỉ ví gửi hoặc ví Phantom nhận không hợp lệ (chỉ dùng địa chỉ Base58 công khai).');
  }
  if (!isValidSolanaBase58(mintAddr)) {
    throw new Error('Địa chỉ Mint tài sản không hợp lệ.');
  }
  if (!Number.isFinite(params.amountUi) || params.amountUi <= 0) {
    throw new Error('Số lượng nạp/rút phải lớn hơn 0.');
  }

  const connection = new Connection(SOLANA_MAINNET_RPC, 'confirmed');
  const fromPubkey = new PublicKey(fromAddr);
  const toPubkey = new PublicKey(toAddr);

  const instructions: TransactionInstruction[] = [];
  let decimals = 9;

  if (mintAddr === SOL_NATIVE_MINT) {
    const lamports = Math.floor(params.amountUi * 1_000_000_000);
    if (lamports <= 0) {
      throw new Error('Số lượng SOL quá nhỏ (tối thiểu 1 lamport).');
    }
    const senderLamports = Number(await connection.getBalance(fromPubkey, 'confirmed'));
    if (senderLamports < lamports + 5000) {
      throw new Error(
        `Số dư SOL không đủ để thực hiện lệnh (hiện có ${(senderLamports / 1_000_000_000).toFixed(6)} SOL, cần chừa tối thiểu 0.000005 SOL phí mạng).`
      );
    }
    instructions.push(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      })
    );
  } else {
    const mintPubkey = new PublicKey(mintAddr);
    const mintInfoAccount = await connection.getAccountInfo(mintPubkey, 'confirmed');
    if (!mintInfoAccount) {
      throw new Error('Không tìm thấy tài khoản Mint của token này trên Solana Mainnet.');
    }
    const tokenProgramId = mintInfoAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : SPL_TOKEN_PROGRAM_ID;

    const resolved = await resolveTokenDecimalsAndAudit(mintAddr);
    decimals = resolved.decimals;
    const atomicAmount = BigInt(uiToAtomicAmountString(params.amountUi, decimals));

    const [fromAta] = await PublicKey.findProgramAddress(
      [fromPubkey.toBytes(), tokenProgramId.toBytes(), mintPubkey.toBytes()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [toAta] = await PublicKey.findProgramAddress(
      [toPubkey.toBytes(), tokenProgramId.toBytes(), mintPubkey.toBytes()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const fromAtaInfo = await connection.getAccountInfo(fromAta, 'confirmed');
    if (!fromAtaInfo) {
      throw new Error('Ví nguồn chưa có tài khoản token (ATA) cho tài sản này.');
    }

    const toAtaInfo = await connection.getAccountInfo(toAta, 'confirmed');
    if (!toAtaInfo) {
      // CreateAssociatedTokenAccountIdempotent (instruction index 1)
      instructions.push(
        new TransactionInstruction({
          programId: ASSOCIATED_TOKEN_PROGRAM_ID,
          keys: [
            { pubkey: fromPubkey, isSigner: true, isWritable: true },
            { pubkey: toAta, isSigner: false, isWritable: true },
            { pubkey: toPubkey, isSigner: false, isWritable: false },
            { pubkey: mintPubkey, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: tokenProgramId, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([1]),
        })
      );
    }

    // SPL Token TransferChecked (instruction index 12: [u8 cmd=12, u64 amount LE, u8 decimals])
    const data = Buffer.alloc(10);
    data.writeUInt8(12, 0);
    data.writeBigUInt64LE(atomicAmount, 1);
    data.writeUInt8(decimals, 9);

    instructions.push(
      new TransactionInstruction({
        programId: tokenProgramId,
        keys: [
          { pubkey: fromAta, isSigner: false, isWritable: true },
          { pubkey: mintPubkey, isSigner: false, isWritable: false },
          { pubkey: toAta, isSigner: false, isWritable: true },
          { pubkey: fromPubkey, isSigner: true, isWritable: false },
        ],
        data,
      })
    );
  }

  const latest = await connection.getLatestBlockhash('confirmed');
  const messageV0 = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(messageV0);
  const serialized = vtx.serialize();

  return {
    transactionBase64: Buffer.from(serialized).toString('base64'),
    blockhash: latest.blockhash,
    lastValidBlockHeight: Number(latest.lastValidBlockHeight),
    decimals,
    feeEstimateSol: 0.000005,
  };
}

