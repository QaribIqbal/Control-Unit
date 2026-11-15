import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = '__Host-control_unit_session';
const SESSION_SECONDS = 12 * 60 * 60;
function digest(value: string) { return createHash('sha256').update(value).digest(); }
export function validPassword(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.length <= 1024 && timingSafeEqual(digest(value), digest(expected));
}
export function validBearer(value: string | undefined, token: string): boolean {
  if (!token || !value || value.length > 8192) return false;
  return timingSafeEqual(digest(value), digest(`Bearer ${token}`));
}
function signature(payload: string, secret: string) { return createHmac('sha256', secret).update(payload).digest('base64url'); }
export function sessionCookie(secret: string): string {
  const payload = Buffer.from(JSON.stringify({ expires: Math.floor(Date.now() / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return `${COOKIE_NAME}=${payload}.${signature(payload, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
export function authenticated(cookie: string | undefined, secret: string): boolean {
  if (!cookie || cookie.length > 8192 || !secret) return false;
  const values = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return false;
  const token = values[0].slice(COOKIE_NAME.length + 1);
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
  const expected = Buffer.from(signature(parts[0], secret)); const provided = Buffer.from(parts[1]);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { expires?: unknown; nonce?: unknown };
    const now = Math.floor(Date.now() / 1000);
    return typeof payload.expires === 'number' && Number.isInteger(payload.expires) && payload.expires > now && payload.expires <= now + SESSION_SECONDS && typeof payload.nonce === 'string' && /^[a-f0-9]{32}$/.test(payload.nonce);
  } catch { return false; }
}
