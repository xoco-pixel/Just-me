/** Notifications: listing, read state, and per-type delivery preferences. */
import express from 'express';
import { get, run } from '../db/index.js';
import { asyncHandler, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { ApiError } from '../lib/errors.js';
import { nowIso } from '../lib/util.js';
import { NOTIFICATION_TYPES, listNotifications, markAllRead, markRead, unreadCount } from '../services/notifications.js';
import { getUserSettings } from '../services/users.js';

const router = express.Router();

const SETTING_KEYS = [
  'notifyNewMatch',
  'notifyMutualMatch',
  'notifyProfileView',
  'notifyContactRequest',
  'notifyExchangeUnlocked',
  'notifySafety',
];

/** GET /api/notifications */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.query);
    const limit = v.integer('limit', { min: 1, max: 100, fallback: 50 });
    const unreadOnly = v.boolean('unreadOnly', { fallback: false });
    v.assertValid();
    res.json({
      notifications: listNotifications(req.user.id, { limit, unreadOnly }),
      unread: unreadCount(req.user.id),
      knownTypes: NOTIFICATION_TYPES,
    });
  })
);

/** POST /api/notifications/:id/read */
router.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const updated = markRead(req.user.id, req.params.id);
    if (!updated) throw ApiError.notFound('That notification does not exist or is already read.');
    res.json({ read: true, unread: unreadCount(req.user.id) });
  })
);

/** POST /api/notifications/read-all */
router.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const updated = markAllRead(req.user.id);
    res.json({ updated, unread: unreadCount(req.user.id) });
  })
);

/** GET /api/notifications/preferences */
router.get(
  '/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = getUserSettings(req.user);
    res.json({ preferences: Object.fromEntries(SETTING_KEYS.map((key) => [key, settings[key] !== false])) });
  })
);

/** PUT /api/notifications/preferences — genuinely controls notification delivery. */
router.put(
  '/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const updates = {};
    for (const key of SETTING_KEYS) updates[key] = v.boolean(key, { fallback: getUserSettings(req.user)[key] !== false });
    v.assertValid();

    const settings = { ...getUserSettings(req.user), ...updates };
    run('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(settings),
      nowIso(),
      req.user.id,
    ]);
    res.json({ preferences: Object.fromEntries(SETTING_KEYS.map((key) => [key, settings[key] !== false])) });
  })
);

export default router;
