import crypto from 'node:crypto';
import { db } from './db.ts';

const ADMIN_CREDENTIAL_ID = 'admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getEnvPasscode(): string {
  return (process.env.TERMINAL_ACCESS_PASSCODE ?? '').trim();
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function hashPasscodeScrypt(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPasscodeScrypt(passcode: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = crypto.scryptSync(passcode, salt, expectedBuf.length);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function safeEqualText(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function hasStoredAdminCredential(): boolean {
  const row = db
    .prepare('SELECT id FROM AuthCredentials WHERE id = ?')
    .get(ADMIN_CREDENTIAL_ID) as { id: string } | undefined;
  return Boolean(row);
}

function createSessionToken(): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare('DELETE FROM AuthSessions WHERE expires_at <= ?').run(now);
  db.prepare(
    'INSERT INTO AuthSessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)'
  ).run(tokenHash, expiresAt, new Date(now).toISOString());
  return rawToken;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}

export function verifyBearerToken(authHeader: string | undefined): boolean {
  const rawToken = extractBearerToken(authHeader);
  if (!rawToken) return false;
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const row = db
    .prepare('SELECT token_hash, expires_at FROM AuthSessions WHERE token_hash = ?')
    .get(tokenHash) as { token_hash: string; expires_at: number } | undefined;
  if (!row) return false;
  if (Number(row.expires_at) <= now) {
    db.prepare('DELETE FROM AuthSessions WHERE token_hash = ?').run(tokenHash);
    return false;
  }
  return true;
}

export function revokeBearerToken(authHeader: string | undefined): void {
  const rawToken = extractBearerToken(authHeader);
  if (!rawToken) return;
  db.prepare('DELETE FROM AuthSessions WHERE token_hash = ?').run(hashToken(rawToken));
}

export function getAuthStatus(authHeader?: string): {
  authenticated: boolean;
  needsSetup: boolean;
  envConfigured: boolean;
} {
  const envConfigured = Boolean(getEnvPasscode());
  const needsSetup = !envConfigured && !hasStoredAdminCredential();
  const authenticated = verifyBearerToken(authHeader);
  return { authenticated, needsSetup, envConfigured };
}

export function setupFirstAdminPasscode(passcode: unknown): { token: string } {
  if (getEnvPasscode()) {
    throw new Error('Máy chủ đã cấu hình mã truy cập qua biến môi trường. Vui lòng đăng nhập.');
  }
  if (typeof passcode !== 'string' || passcode.length < 8 || passcode.length > 128) {
    throw new Error('Mật khẩu quản trị phải có độ dài từ 8 đến 128 ký tự.');
  }
  const hashed = hashPasscodeScrypt(passcode);
  const nowIso = new Date().toISOString();
  const result = db
    .prepare(
      'INSERT OR IGNORE INTO AuthCredentials (id, password_hash, updated_at) VALUES (?, ?, ?)'
    )
    .run(ADMIN_CREDENTIAL_ID, hashed, nowIso);

  if (Number(result.changes) !== 1) {
    throw new Error('Tài khoản quản trị đã được thiết lập trước đó. Vui lòng đăng nhập.');
  }

  return { token: createSessionToken() };
}

export function loginWithPasscode(passcode: unknown): { token: string } {
  if (typeof passcode !== 'string' || passcode.length === 0 || passcode.length > 128) {
    throw new Error('Mật khẩu truy cập không hợp lệ.');
  }

  const envPass = getEnvPasscode();
  if (envPass) {
    if (!safeEqualText(passcode, envPass)) {
      throw new Error('Mật khẩu truy cập không đúng.');
    }
    return { token: createSessionToken() };
  }

  const row = db
    .prepare('SELECT password_hash FROM AuthCredentials WHERE id = ?')
    .get(ADMIN_CREDENTIAL_ID) as { password_hash: string } | undefined;

  if (!row) {
    throw new Error('Hệ thống chưa được thiết lập mật khẩu quản trị lần đầu.');
  }
  if (!verifyPasscodeScrypt(passcode, row.password_hash)) {
    throw new Error('Mật khẩu truy cập không đúng.');
  }
  return { token: createSessionToken() };
}
