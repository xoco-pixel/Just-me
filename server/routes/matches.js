/** Match search, match actions and the My Matches sections. */
import express from 'express';
import config from '../config.js';
import { asyncHandler, rateLimit, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { ApiError } from '../lib/errors.js';
import { actOnCandidate, listMutualMatches } from '../services/matches.js';
import { listExchanges } from '../services/exchange.js';
import { findCandidates, listPotentialMatches, markDiscoverySeen } from '../services/search.js';
import { clearDiscoveries } from '../services/search.js';

const router = express.Router();

/**
 * Explains an empty result truthfully.
 *
 * "Nobody is here" and "everyone is blocked" are different situations, and the
 * user needs to know which one they are in.
 */
function honestEmptyMessage(outcome) {
  if (outcome.scanned === 0) {
    const excluded = Math.max(0, outcome.excluded - 1); // minus yourself
    if (excluded > 0) {
      return `Everyone we could compare you with is already blocked or already matched (${excluded}). Unblock someone or widen your preferences to see more people.`;
    }
    return 'Nobody else has a complete profile yet, so there is no one to compare you with.';
  }
  return 'We couldn’t find a strong match right now. Try expanding your location or age preferences.';
}

/**
 * POST /api/matches/find — FIND MY MATCH.
 * Runs the real engine over real stored profiles and reports how many were
 * considered, so an empty result is an honest empty result.
 */
router.post(
  '/find',
  requireAuth,
  rateLimit({ limit: config.rateLimits.search, name: 'search' }),
  asyncHandler(async (req, res) => {
    const outcome = findCandidates(req.user.id);
    res.json({
      count: outcome.results.length,
      results: outcome.results.map((item) => ({
        userId: item.userId,
        profile: item.profile,
        score: item.score,
        reasons: item.reasons,
        components: item.components,
        mutual: item.mutual,
        shared: item.shared,
        theyLikedYou: Boolean(item.theyLikedYou),
      })),
      diagnostics: {
        profilesConsidered: outcome.scanned,
        passedHardGates: outcome.eligible,
        excludedBlockedOrMatched: outcome.excluded,
        minimumScoreShown: config.matching.minResultScore,
        preferencesUsed: outcome.preferences,
      },
      honestEmpty:
        outcome.results.length === 0
          ? honestEmptyMessage(outcome)
          : null,
    });
  })
);

/** GET /api/matches — all four My Matches sections, from real stored state. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const exchanges = listExchanges(req.user.id);
    res.json({
      potential: listPotentialMatches(req.user.id),
      mutual: listMutualMatches(req.user.id),
      contactRequests: exchanges.incoming,
      outgoingRequests: exchanges.outgoing,
      connections: exchanges.connections,
      closed: exchanges.closed,
    });
  })
);

/** GET /api/matches/potential — persisted discoveries only. */
router.get(
  '/potential',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ potential: listPotentialMatches(req.user.id) });
  })
);

/** POST /api/matches/:userId/action — { action: 'like' | 'pass' } */
router.post(
  '/:userId/action',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'match' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const action = v.enum('action', ['like', 'pass'], { required: true });
    v.assertValid();
    const result = actOnCandidate(req.user.id, req.params.userId, action);
    markDiscoverySeen(req.user.id, req.params.userId);
    res.status(201).json(result);
  })
);

/** POST /api/matches/refresh — clears stored discoveries so the next find recomputes. */
router.post(
  '/refresh',
  requireAuth,
  rateLimit({ limit: config.rateLimits.search, name: 'search' }),
  asyncHandler(async (req, res) => {
    clearDiscoveries(req.user.id);
    const outcome = findCandidates(req.user.id);
    res.json({ cleared: true, count: outcome.results.length });
  })
);

/** GET /api/matches/mutual */
router.get(
  '/mutual',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ mutual: listMutualMatches(req.user.id) });
  })
);

export default router;
