/** Blocking, reporting and the safety centre summary. */
import express from 'express';
import config from '../config.js';
import { get, run } from '../db/index.js';
import { asyncHandler, rateLimit, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { listTaxonomy } from '../lib/taxonomy.js';
import { newId, nowIso } from '../lib/util.js';
import { blockUser, isBlocked, listBlocks, listReportsFor, reportUser, unblockUser } from '../services/safety.js';
import { flagCountFor } from '../services/moderation.js';

const router = express.Router();

/** POST /api/safety/block — { userId, reason? } */
router.post(
  '/block',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'block' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const userId = v.string('userId', { required: true, max: 64 });
    const reason = v.string('reason', { required: false, max: 300, allowEmpty: true });
    v.assertValid();
    const result = blockUser(req.user.id, userId, reason ?? '');
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      nowIso(),
      req.user.id,
      'user_blocked',
      `blocked ${userId}`,
      req.ip,
    ]);
    res.status(201).json({ ...result, blocked: true });
  })
);

/** DELETE /api/safety/block/:userId */
router.delete(
  '/block/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(unblockUser(req.user.id, req.params.userId));
  })
);

/** GET /api/safety/blocks */
router.get(
  '/blocks',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ blocks: listBlocks(req.user.id) });
  })
);

/** POST /api/safety/report — { userId, category, description? } */
router.post(
  '/report',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'report' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const userId = v.string('userId', { required: true, max: 64 });
    const category = v.enum('category', listTaxonomy('report_category').map((r) => r.value), { required: true });
    const description = v.string('description', { required: false, max: 1000, allowEmpty: true });
    v.assertValid();
    const result = reportUser(req.user.id, userId, category, description ?? '');
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      nowIso(),
      req.user.id,
      'user_reported',
      `reported ${userId} (${category})`,
      req.ip,
    ]);
    res.status(201).json({
      ...result,
      message: 'Your report was recorded and is in the moderation queue.',
    });
  })
);

/** GET /api/safety/summary — real counts for the safety centre. */
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      blockedCount: listBlocks(req.user.id).length,
      myReports: listReportsFor(req.user.id).map((row) => ({
        id: row.id,
        category: row.category,
        status: row.status,
        createdAt: row.created_at,
      })),
      openFlagsOnMe: flagCountFor(req.user.id),
      minimumAge: config.minimumAge,
      moderationNote:
        'Automated checks are deterministic pattern rules (scam phrases, contact details in bios, duplicate profiles). Image content analysis is not implemented in this build; photos stay in the admin review queue.',
    });
  })
);

/** GET /api/safety/status/:userId — am I blocked by / have I blocked this person? */
router.get(
  '/status/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ blocked: isBlocked(req.user.id, req.params.userId) });
  })
);

export default router;
