/** Match actions: like / pass, and the transition into a mutual match. */
import { all, get, run, transaction } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso, parseJson } from '../lib/util.js';
import { listTaxonomy } from '../lib/taxonomy.js';
import { computeCompatibility } from './matching.js';
import { notify } from './notifications.js';
import { blockedIdsFor } from './safety.js';
import { publicProfile, toParticipant } from './users.js';

function labelMap() {
  const map = {};
  for (const kind of ['interest', 'intention', 'country', 'language', 'gender']) {
    map[kind] = Object.fromEntries(listTaxonomy(kind).map((row) => [row.value, row.label]));
  }
  return map;
}

function matchRow(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return { lo, hi, row: get('SELECT * FROM matches WHERE user_a = ? AND user_b = ?', [lo, hi]) };
}

/**
 * Records a match action. The compatibility score stored with the match is
 * recomputed here from database data — never taken from the client.
 */
export function actOnCandidate(userId, candidateId, action) {
  if (!['like', 'pass'].includes(action)) throw ApiError.badRequest("Action must be 'like' or 'pass'.");
  if (userId === candidateId) throw ApiError.badRequest('You cannot match with yourself.');

  const candidate = get('SELECT id, status FROM users WHERE id = ?', [candidateId]);
  if (!candidate || candidate.status !== 'active') throw ApiError.notFound('That person is not available.');
  if (blockedIdsFor(userId).has(candidateId)) {
    throw ApiError.forbidden('You cannot match with this person.');
  }

  const me = toParticipant(userId);
  const other = toParticipant(candidateId);
  if (!me || !other) throw ApiError.badRequest('Profiles are incomplete, so compatibility cannot be calculated.');

  const outcome = computeCompatibility(me, other, { labels: labelMap() });
  if (!outcome.eligible) {
    throw ApiError.badRequest(outcome.message || 'You two are not compatible according to your preferences.', {
      gate: outcome.gate,
    });
  }

  const { lo, hi, row } = matchRow(userId, candidateId);
  const now = nowIso();

  // Only look for a prior action when a match row exists; binding `undefined`
  // would otherwise reach SQLite and throw.
  const existingAction = row
    ? get('SELECT * FROM match_actions WHERE match_id = ? AND user_id = ?', [row.id, userId])
    : null;
  if (row && existingAction) {
    throw ApiError.conflict(
      existingAction.action === action
        ? `You already ${action === 'like' ? 'liked' : 'passed on'} this person.`
        : 'You have already responded to this person.'
    );
  }

  let matchId = row?.id;
  let status = row?.status || 'pending';

  transaction(() => {
    if (!row) {
      matchId = newId('mtc');
      run(
        `INSERT INTO matches (id, user_a, user_b, initiated_by, score, reasons, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          matchId,
          lo,
          hi,
          userId,
          outcome.score,
          JSON.stringify(outcome.reasons),
          action === 'pass' ? 'cancelled' : 'pending',
          now,
          now,
        ]
      );
    }
    run('INSERT INTO match_actions (id, match_id, user_id, action, created_at) VALUES (?, ?, ?, ?, ?)', [
      newId('act'),
      matchId,
      userId,
      action,
      now,
    ]);

    if (action === 'like') {
      const bothLiked =
        get("SELECT id FROM match_actions WHERE match_id = ? AND user_id = ? AND action = 'like'", [
          matchId,
          userId,
        ]) &&
        get("SELECT id FROM match_actions WHERE match_id = ? AND user_id = ? AND action = 'like'", [
          matchId,
          candidateId,
        ]);
      if (bothLiked) {
        status = 'mutual';
        run("UPDATE matches SET status='mutual', score=?, reasons=?, updated_at=? WHERE id=?", [
          outcome.score,
          JSON.stringify(outcome.reasons),
          now,
          matchId,
        ]);
      } else {
        run("UPDATE matches SET score=?, reasons=?, updated_at=? WHERE id=?", [
          outcome.score,
          JSON.stringify(outcome.reasons),
          now,
          matchId,
        ]);
      }
    } else if (!row) {
      status = 'cancelled';
    }
  });

  const meName = publicProfile(userId)?.displayName || 'Someone';
  const otherName = publicProfile(candidateId)?.displayName || 'Someone';
  let mutual = false;

  if (action === 'like' && status === 'mutual') {
    mutual = true;
    notify(candidateId, {
      type: 'mutual_match',
      title: `💜 You and ${meName} matched!`,
      body: 'You both chose each other. You can now request a contact exchange.',
      refType: 'match',
      refId: matchId,
    });
    notify(userId, {
      type: 'mutual_match',
      title: `💜 You and ${otherName} matched!`,
      body: 'You both chose each other. You can now request a contact exchange.',
      refType: 'match',
      refId: matchId,
    });
  } else if (action === 'like') {
    notify(candidateId, {
      type: 'new_match',
      title: `❤️ ${meName} is interested in you`,
      body: 'Open your matches to see the compatibility breakdown.',
      refType: 'match',
      refId: matchId,
    });
  }

  return {
    matchId,
    action,
    status,
    mutual,
    score: outcome.score,
    reasons: outcome.reasons,
  };
}

export function listMutualMatches(userId) {
  const rows = all(
    `SELECT m.* FROM matches m WHERE m.status = 'mutual' AND (m.user_a = ? OR m.user_b = ?)
     ORDER BY m.updated_at DESC`,
    [userId, userId]
  );
  return rows.map((row) => {
    const otherId = row.user_a === userId ? row.user_b : row.user_a;
    return {
      matchId: row.id,
      userId: otherId,
      score: row.score,
      reasons: parseJson(row.reasons, []),
      matchedAt: row.updated_at,
      profile: publicProfile(otherId),
    };
  });
}

export function getMatch(userId, otherUserId) {
  const { row } = matchRow(userId, otherUserId);
  if (!row) return null;
  return {
    matchId: row.id,
    status: row.status,
    score: row.score,
    reasons: parseJson(row.reasons, []),
    actions: all('SELECT user_id, action, created_at FROM match_actions WHERE match_id = ?', [row.id]),
  };
}

export function hasLiked(userId, otherUserId) {
  const { row } = matchRow(userId, otherUserId);
  if (!row) return false;
  return Boolean(
    get("SELECT id FROM match_actions WHERE match_id = ? AND user_id = ? AND action = 'like'", [row.id, userId])
  );
}
