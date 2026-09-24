/** HTTP plumbing: async wrapper, rate limiting, auth, error handling. */
import config from '../config.js';
import { get, run } from '../db/index.js';
import { ApiError } from './errors.js';
import { clientIp, hashToken, nowIso } from './util.js';

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Per-IP sliding-window limiter. In-memory by design; documented as such. */
const buckets = new Map();

export function rateLimit({ limit, windowMs = config.rateLimits.windowMs, name = 'default' }) {
  return (req, res, next) => {
    if (!config.rateLimits.enabled) return next();
    const now = Date.now();
    const key = `${name}:${clientIp(req)}`;
    const bucket = buckets.get(key) || { hits: [], blockedUntil: 0 };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length >= limit) {
      const retrySeconds = Math.ceil((windowMs - (now - bucket.hits[0])) / 1000);
      buckets.set(key, bucket);
      return next(
        new ApiError(429, 'rate_limited', `Too many attempts. Try again in ${retrySeconds}s.`, {
          retryAfterSeconds: retrySeconds,
        })
      );
    }
    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}

export function extractToken(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.cookies?.[config.cookieName];
  return typeof cookie === 'string' && cookie.length ? cookie : null;
}

/** Resolves the session token on the request into req.user. */
export function loadSession(req) {
  const token = extractToken(req);
  if (!token) return null;
  const session = get(
    `SELECT s.id, s.user_id, s.kind, s.expires_at, s.revoked_at
       FROM sessions s WHERE s.token_hash = ?`,
    [hashToken(token)]
  );
  if (!session || session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  const user = get('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!user || user.status === 'deleted') return null;
  return { session, user, token };
}

export function requireAuth(req, res, next) {
  const loaded = loadSession(req);
  if (!loaded) return next(ApiError.unauthorized('Your session has expired. Please restore your QuickSense.'));
  req.user = loaded.user;
  req.session = loaded.session;
  req.token = loaded.token;

  // Refresh presence at most once a minute per session.
  const lastSeen = req.user.last_seen_at ? new Date(req.user.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeen > 60_000) {
    run('UPDATE users SET last_seen_at = ? WHERE id = ?', [nowIso(), req.user.id]);
  }

  if (req.user.status === 'suspended') {
    return next(
      ApiError.forbidden('This account has been suspended pending review. You can still contact support.')
    );
  }
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (req.user.role !== 'admin') {
      return next(ApiError.forbidden('Administrator access is required.'));
    }
    next();
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details ?? null },
    });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'payload_too_large', message: 'That request body is too large.', details: null },
    });
  }
  // Never leak internals to the client, but never hide the failure either.
  console.error('[quicksense] unhandled error:', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side. Please try again.',
      details: config.isProduction ? null : { type: error?.name, message: error?.message },
    },
  });
}
