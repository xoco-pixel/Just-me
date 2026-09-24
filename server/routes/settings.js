/** Settings: privacy + visibility controls, and account recovery management. */
import express from 'express';
import { get, run } from '../db/index.js';
import { asyncHandler, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { nowIso, parseJson } from '../lib/util.js';
import { getUserSettings, publicProfile } from '../services/users.js';
import { clearDiscoveries } from '../services/search.js';

const router = express.Router();

const SETTING_KEYS = [
  'profileVisibility',
  'showInSearch',
  'notifyNewMatch',
  'notifyMutualMatch',
  'notifyProfileView',
  'notifyContactRequest',
  'notifyExchangeUnlocked',
  'notifySafety',
];

const DEFAULTS = {
  profileVisibility: 'public',
  showInSearch: true,
  notifyNewMatch: true,
  notifyMutualMatch: true,
  notifyProfileView: true,
  notifyContactRequest: true,
  notifyExchangeUnlocked: true,
  notifySafety: true,
};

/** GET /api/settings */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = getUserSettings(req.user);
    const profile = get('SELECT visibility FROM profiles WHERE user_id = ?', [req.user.id]);
    res.json({
      settings: Object.fromEntries(SETTING_KEYS.map((key) => [key, settings[key] ?? DEFAULTS[key]])),
      fieldVisibility: parseJson(profile?.visibility, {}),
      account: {
        qsId: req.user.qs_id,
        email: req.user.email,
        passwordSet: Boolean(req.user.password_hash),
        recoveryCodesActive: get(
          'SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL AND expires_at > ?',
          [req.user.id, nowIso()]
        ).count,
        createdAt: req.user.created_at,
      },
    });
  })
);

/** PUT /api/settings — every key here is actually read by the relevant service. */
router.put(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const current = getUserSettings(req.user);
    const v = new Validator(req.body);
    const updates = {};
    for (const key of SETTING_KEYS) {
      updates[key] =
        key === 'profileVisibility'
          ? v.enum('profileVisibility', ['public', 'hidden'], { fallback: current.profileVisibility })
          : v.boolean(key, { fallback: current[key] ?? DEFAULTS[key] });
    }
    v.assertValid();

    const next = { ...current, ...updates };
    run('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(next),
      nowIso(),
      req.user.id,
    ]);

    // Hiding from search must change what other people's searches return.
    if (updates.showInSearch === false) clearDiscoveries(req.user.id);

    res.json({ settings: Object.fromEntries(SETTING_KEYS.map((key) => [key, next[key]])), saved: true });
  })
);

/** PUT /api/settings/visibility — per-field public/private control. */
router.put(
  '/visibility',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = get('SELECT visibility FROM profiles WHERE user_id = ?', [req.user.id]);
    if (!profile) throw new Error('Profile not found');
    const current = parseJson(profile.visibility, {});
    const v = new Validator(req.body);
    const fields = ['bio', 'city', 'region', 'interests', 'languages', 'intentions', 'gender'];
    const updates = {};
    for (const field of fields) updates[field] = v.boolean(field, { fallback: current[field] !== false });
    v.assertValid();
    run('UPDATE profiles SET visibility = ?, updated_at = ? WHERE user_id = ?', [
      JSON.stringify({ ...current, ...updates }),
      nowIso(),
      req.user.id,
    ]);
    res.json({ visibility: { ...current, ...updates }, profile: publicProfile(req.user.id) });
  })
);

export default router;
