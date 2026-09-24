/**
 * Identity: QuickSense ID creation, device sessions, restore, recovery, deletion.
 *
 * The server is the source of truth. The client only ever holds an opaque
 * session token; the database stores its hash.
 */
import express from 'express';
import config from '../config.js';
import { get, run, transaction } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler, rateLimit, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import {
  addDays,
  ageFromDob,
  generateQsId,
  generateRecoveryCode,
  generateToken,
  hashPassword,
  hashToken,
  newId,
  nowIso,
  verifyPassword,
} from '../lib/util.js';
import { listNotifications, unreadCount } from '../services/notifications.js';
import {
  assertActiveUser,
  deleteUserAccount,
  getPreferences,
  getProfile,
  getUserByEmail,
  getUserByQsId,
  getUserSettings,
  publicProfile,
} from '../services/users.js';

const router = express.Router();
const authLimiter = rateLimit({ limit: config.rateLimits.auth, name: 'auth' });

function uniqueQsId() {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = generateQsId();
    if (!get('SELECT id FROM users WHERE qs_id = ?', [candidate])) return candidate;
  }
  throw ApiError.internal('Could not allocate a QuickSense ID. Please try again.');
}

function createSession(userId, kind = 'device', req = null) {
  const token = generateToken();
  const now = nowIso();
  run(
    `INSERT INTO sessions (id, user_id, token_hash, kind, user_agent, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('ses'),
      userId,
      hashToken(token),
      kind,
      String(req?.headers?.['user-agent'] || '').slice(0, 300) || null,
      req?.ip || null,
      now,
      addDays(now, config.sessionTtlDays).toISOString(),
    ]
  );
  return token;
}

function setSessionCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/** POST /api/auth/register — creates an accountless QuickSense identity. */
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const id = newId('usr');
    const qsId = uniqueQsId();
    const now = nowIso();
    transaction(() => {
      run(
        `INSERT INTO users (id, qs_id, role, status, is_demo, settings, created_at, updated_at)
         VALUES (?, ?, 'user', 'active', 0, '{}', ?, ?)`,
        [id, qsId, now, now]
      );
    });
    const token = createSession(id, 'device', req);
    setSessionCookie(res, token);
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      now,
      id,
      'account_created',
      `QuickSense ID ${qsId}`,
      req.ip,
    ]);
    res.status(201).json({
      userId: id,
      qsId,
      token,
      message: 'Your QuickSense ID was created. Save it — it restores your profile on a new device.',
    });
  })
);

/** POST /api/auth/restore — "Restore My QuickSense" using a saved device token. */
router.post(
  '/restore',
  authLimiter,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const token = v.string('token', { required: true, max: 200 });
    v.assertValid();

    const session = get('SELECT * FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    if (!session || session.revoked_at) {
      throw ApiError.unauthorized('That QuickSense could not be found on this device. Use your recovery code instead.');
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw ApiError.unauthorized('That saved QuickSense has expired. Use your recovery code instead.');
    }
    const user = get('SELECT * FROM users WHERE id = ?', [session.user_id]);
    if (!user || user.status !== 'active') {
      throw ApiError.unauthorized('That QuickSense is no longer active.');
    }

    const freshToken = createSession(user.id, 'device', req);
    setSessionCookie(res, freshToken);
    res.json({ userId: user.id, qsId: user.qs_id, token: freshToken, restored: true });
  })
);

/** POST /api/auth/recovery-code — issues a recovery code (shown once). */
router.post(
  '/recovery-code',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const email = v.string('email', { required: false, max: 254 });
    v.assertValid();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw ApiError.badRequest('Enter a valid email address.', { email: 'Invalid email address.' });
    }
    if (email) {
      const taken = get('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?', [email, req.user.id]);
      if (taken) throw ApiError.conflict('That email is already linked to another QuickSense.');
      run('UPDATE users SET email = ?, updated_at = ? WHERE id = ?', [email, nowIso(), req.user.id]);
    }

    const code = generateRecoveryCode();
    run(
      `INSERT INTO recovery_codes (id, user_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      [
        newId('rcv'),
        req.user.id,
        hashToken(code.toUpperCase()),
        nowIso(),
        addDays(nowIso(), config.recoveryCodeTtlDays).toISOString(),
      ]
    );
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      nowIso(),
      req.user.id,
      'recovery_code_issued',
      email ? `Linked to ${email}` : 'No email linked',
      req.ip,
    ]);

    res.json({
      qsId: req.user.qs_id,
      recoveryCode: code,
      email: email || null,
      // Honest status: this deployment has no email transport configured.
      emailDelivery: 'not_configured',
      message:
        'Save this code somewhere safe. It is shown only once. Email delivery is not configured in this deployment, so the code is not sent anywhere.',
    });
  })
);

/** POST /api/auth/recover — restore on a new device with QS ID or email + code. */
router.post(
  '/recover',
  authLimiter,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const identifier = v.string('identifier', { required: true, max: 254 });
    const code = v.string('code', { required: true, max: 40 });
    v.assertValid();

    const user = identifier.includes('@') ? getUserByEmail(identifier) : getUserByQsId(identifier);
    if (!user || user.status !== 'active') {
      throw ApiError.unauthorized('We could not find a QuickSense matching those details.');
    }
    const candidate = hashToken(String(code).toUpperCase().trim());
    const record = get(
      `SELECT * FROM recovery_codes WHERE user_id = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`,
      [user.id, nowIso()]
    );
    if (!record || record.code_hash !== candidate) {
      run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
        newId('log'),
        nowIso(),
        user.id,
        'recovery_failed',
        'Invalid recovery code',
        req.ip,
      ]);
      throw ApiError.unauthorized('That recovery code is not valid.');
    }

    run('UPDATE recovery_codes SET used_at = ? WHERE id = ?', [nowIso(), record.id]);
    const token = createSession(user.id, 'device', req);
    setSessionCookie(res, token);
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      nowIso(),
      user.id,
      'recovery_succeeded',
      '',
      req.ip,
    ]);
    res.json({ userId: user.id, qsId: user.qs_id, token, restored: true });
  })
);

/** POST /api/auth/login — for users/admins who set a password. */
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const identifier = v.string('identifier', { required: true, max: 254 });
    const password = v.string('password', { required: true, max: 200 });
    v.assertValid();

    const user = identifier.includes('@') ? getUserByEmail(identifier) : getUserByQsId(identifier);
    if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
      throw ApiError.unauthorized('Those details do not match an account.');
    }
    if (user.status !== 'active') throw ApiError.forbidden('This account is not active.');
    const token = createSession(user.id, user.role === 'admin' ? 'admin' : 'device', req);
    setSessionCookie(res, token);
    res.json({ userId: user.id, qsId: user.qs_id, role: user.role, token });
  })
);

/** POST /api/auth/password — set or change a password. */
router.post(
  '/password',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const password = v.string('password', { required: true, min: 8, max: 200 });
    const currentPassword = v.string('currentPassword', { required: false, max: 200 });
    v.assertValid();
    if (req.user.password_hash && !verifyPassword(currentPassword || '', req.user.password_hash)) {
      throw ApiError.forbidden('Your current password is not correct.');
    }
    run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
      hashPassword(password),
      nowIso(),
      req.user.id,
    ]);
    res.json({ passwordSet: true });
  })
);

/** GET /api/auth/me — the full state the app needs on boot. */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    assertActiveUser(req.user);
    const profile = getProfile(req.user.id);
    res.json({
      user: {
        userId: req.user.id,
        qsId: req.user.qs_id,
        email: req.user.email,
        role: req.user.role,
        isDemo: Boolean(req.user.is_demo),
        createdAt: req.user.created_at,
      },
      profile: profile ? publicProfile(req.user.id, { includePrivate: true }) : null,
      preferences: getPreferences(req.user.id) || null,
      settings: getUserSettings(req.user),
      notifications: {
        unread: unreadCount(req.user.id),
        recent: listNotifications(req.user.id, { limit: 10 }),
      },
      setupComplete: Boolean(profile?.setup_complete),
      serverTime: nowIso(),
    });
  })
);

/** POST /api/auth/logout — revokes only the current session. */
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), req.session.id]);
    res.clearCookie(config.cookieName, { path: '/' });
    res.json({ signedOut: true });
  })
);

/** DELETE /api/auth/account — permanent deletion of all account data. */
router.delete(
  '/account',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const confirm = v.string('confirm', { required: true, max: 20 });
    v.assertValid();
    if (confirm !== 'DELETE') {
      throw ApiError.badRequest('Type DELETE to confirm permanent account deletion.');
    }
    if (req.user.role === 'admin') throw ApiError.forbidden('Admin accounts cannot be deleted from the app.');
    deleteUserAccount(req.user.id);
    res.clearCookie(config.cookieName, { path: '/' });
    res.json({ deleted: true });
  })
);

export default router;
