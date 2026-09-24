/** Contact exchange endpoints. Contact values are only ever returned after mutual consent. */
import express from 'express';
import config from '../config.js';
import { asyncHandler, rateLimit, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import {
  getExchange,
  getExchangeDetails,
  listExchanges,
  requestExchange,
  respondExchange,
} from '../services/exchange.js';
import { getContactMethods } from '../services/users.js';

const router = express.Router();

/** GET /api/exchange — incoming, outgoing, unlocked and closed requests. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(listExchanges(req.user.id));
  })
);

/** POST /api/exchange/request — { recipientId } */
router.post(
  '/request',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'exchange' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const recipientId = v.string('recipientId', { required: true, max: 64 });
    v.assertValid();
    const result = requestExchange(req.user.id, recipientId);
    res.status(201).json({
      ...result,
      explanation:
        'Your request was sent. Nothing is revealed until the other person also accepts.',
    });
  })
);

/** POST /api/exchange/:id/respond — { action: 'accept' | 'decline' } */
router.post(
  '/:id/respond',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'exchange' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const action = v.enum('action', ['accept', 'decline'], { required: true });
    v.assertValid();
    res.json(respondExchange(req.user.id, req.params.id, action));
  })
);

/** GET /api/exchange/:id — status only, never contact values. */
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(getExchange(req.user.id, req.params.id));
  })
);

/**
 * GET /api/exchange/:id/details — the consent gate.
 * Returns contact values only when BOTH sides accepted; otherwise 403.
 */
router.get(
  '/:id/details',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'exchange-details' }),
  asyncHandler(async (req, res) => {
    res.json(getExchangeDetails(req.user.id, req.params.id));
  })
);

/** GET /api/exchange/shareable/mine — what I have offered to share. */
router.get(
  '/shareable/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      contactMethods: getContactMethods(req.user.id).map((row) => ({
        id: row.id,
        type: row.type,
        label: row.label,
        value: row.value,
        shareable: Boolean(row.shareable),
      })),
    });
  })
);

export default router;
