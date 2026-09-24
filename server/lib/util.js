/** Shared helpers: ids, tokens, password hashing, dates, JSON columns. */
import crypto from 'node:crypto';

export function newId(prefix = '') {
  const raw = crypto.randomBytes(12).toString('base64url');
  return prefix ? `${prefix}_${raw}` : raw;
}

/** Public QuickSense ID, e.g. QS-7F29K4. Unambiguous alphabet, 6 chars. */
export function generateQsId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `QS-${out}`;
}

/** A device/accountless session token. The client sees this; the DB stores only its hash. */
export function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Human-readable recovery code: QS-XXXX-XXXX-XXXX */
export function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `QS-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const derived = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(digest, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  return nowIso().slice(0, 10);
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Age in completed years at `reference` (defaults to now). */
export function ageFromDob(dateOfBirth, reference = new Date()) {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = reference.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = reference.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && reference.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function unique(values) {
  return [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))];
}

export function normaliseText(value, maxLength = 500) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
