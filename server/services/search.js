/**
 * Candidate discovery: loads real users from the database, runs the matching
 * engine over them, and persists the results as discoveries.
 *
 * Nothing here fabricates a candidate. If nobody qualifies, the result list is
 * empty and the UI is told exactly how many profiles were considered.
 */
import { all, get, run } from '../db/index.js';
import config from '../config.js';
import { ApiError } from '../lib/errors.js';
import { listTaxonomy } from '../lib/taxonomy.js';
import { nowIso, parseJson } from '../lib/util.js';
import { newId } from '../lib/util.js';
import { computeCompatibility, rankCandidates } from './matching.js';
import { blockedIdsFor } from './safety.js';
import { getUserSettings, publicProfile, toParticipant } from './users.js';

let labelCache = null;

function labels() {
  if (!labelCache) {
    const map = {};
    for (const kind of ['interest', 'intention', 'country', 'language', 'gender']) {
      map[kind] = Object.fromEntries(listTaxonomy(kind).map((row) => [row.value, row.label]));
    }
    labelCache = map;
  }
  return labelCache;
}

export function resetSearchCache() {
  labelCache = null;
}

/**
 * Partners I can no longer see in search.
 *
 * The rule is per-direction, not per-pair. If I have already liked or passed on
 * someone, they drop out of my search. But if THEY liked me and I have not acted
 * yet, they must still appear — otherwise the other person could never like back
 * and a mutual match would be impossible. A pass by either side ends it.
 */
function settledPartnerIds(userId) {
  const rows = all(
    `SELECT m.user_a, m.user_b, m.status,
            (SELECT a.action FROM match_actions a WHERE a.match_id = m.id AND a.user_id = ?) AS my_action,
            (SELECT b.action FROM match_actions b WHERE b.match_id = m.id AND b.user_id != ?) AS their_action
       FROM matches m
      WHERE m.user_a = ? OR m.user_b = ?`,
    [userId, userId, userId, userId]
  );
  const out = new Set();
  for (const row of rows) {
    const other = row.user_a === userId ? row.user_b : row.user_a;
    const iActed = row.my_action !== null && row.my_action !== undefined;
    const theyPassed = row.their_action === 'pass';
    if (iActed || theyPassed) out.add(other);
  }
  return out;
}

/** Partners who liked me and are still waiting for my response. */
function admirerIds(userId) {
  const rows = all(
    `SELECT m.user_a, m.user_b
       FROM matches m
       JOIN match_actions a ON a.match_id = m.id AND a.user_id != ? AND a.action = 'like'
      WHERE (m.user_a = ? OR m.user_b = ?)
        AND m.status != 'mutual'
        AND NOT EXISTS (SELECT 1 FROM match_actions x WHERE x.match_id = m.id AND x.user_id = ?)`,
    [userId, userId, userId, userId]
  );
  return new Set(rows.map((row) => (row.user_a === userId ? row.user_b : row.user_a)));
}

function candidateRows(userId, excluded) {
  const rows = all(
    `SELECT u.id, u.last_seen_at, u.created_at, u.settings
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'active'
        AND u.id != ?
        AND p.setup_complete = 1`
  , [userId]);

  return rows.filter((row) => {
    if (excluded.has(row.id)) return false;
    const settings = getUserSettings({ settings: row.settings });
    return settings.showInSearch !== false;
  });
}

/**
 * Runs a real search for `userId`.
 * @returns {{results:Array, scanned:number, eligible:number, excluded:number, preferences:object}}
 */
export function findCandidates(userId) {
  // Check completeness FIRST: a brand-new account has no profile row at all,
  // and that must read as "finish your profile", not "profile not found".
  const profile = get('SELECT setup_complete FROM profiles WHERE user_id = ?', [userId]);
  if (!profile?.setup_complete) {
    throw ApiError.badRequest('Finish creating your profile before searching for matches.', {
      code: 'profile_incomplete',
    });
  }
  const me = toParticipant(userId);
  if (!me) throw ApiError.notFound('Your profile could not be loaded.');

  const blocked = blockedIdsFor(userId);
  const settled = settledPartnerIds(userId);
  const admirers = admirerIds(userId);
  const excluded = new Set([...blocked, ...settled, userId]);

  const candidates = candidateRows(userId, excluded);
  const results = [];
  let eligible = 0;

  for (const candidate of candidates) {
    const other = toParticipant(candidate.id);
    if (!other) continue;
    const outcome = computeCompatibility(me, other, { labels: labels() });
    if (!outcome.eligible) continue;
    eligible += 1;
    if (outcome.score < config.matching.minResultScore) continue;
    results.push({
      userId: other.userId,
      score: outcome.score,
      reasons: outcome.reasons,
      components: outcome.components,
      mutual: outcome.mutual,
      shared: outcome.shared,
      appliedCaps: outcome.appliedCaps,
      theyLikedYou: admirers.has(other.userId),
      lastSeenAt: candidate.last_seen_at,
      createdAt: candidate.created_at,
    });
  }

  const ranked = rankCandidates(results).slice(0, config.matching.maxResultsPerSearch);
  persistDiscoveries(userId, ranked);

  return {
    results: ranked.map((item) => ({ ...item, profile: publicProfile(item.userId) })),
    scanned: candidates.length,
    eligible,
    excluded: excluded.size,
    preferences: me.preferences,
  };
}

function persistDiscoveries(userId, ranked) {
  const now = nowIso();
  for (const item of ranked) {
    const existing = get('SELECT id FROM discoveries WHERE user_id = ? AND candidate_id = ?', [userId, item.userId]);
    if (existing) {
      run(
        `UPDATE discoveries SET score = ?, reasons = ?, components = ?, created_at = ? WHERE id = ?`,
        [item.score, JSON.stringify(item.reasons), JSON.stringify(item.components), now, existing.id]
      );
    } else {
      run(
        `INSERT INTO discoveries (id, user_id, candidate_id, score, reasons, components, seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          newId('dsc'),
          userId,
          item.userId,
          item.score,
          JSON.stringify(item.reasons),
          JSON.stringify(item.components),
          now,
        ]
      );
    }
  }
}

/** Potential matches = persisted discoveries for users still eligible to see. */
export function listPotentialMatches(userId) {
  const blocked = blockedIdsFor(userId);
  const rows = all(
    `SELECT d.* FROM discoveries d
      JOIN users u ON u.id = d.candidate_id
      JOIN profiles p ON p.user_id = d.candidate_id
     WHERE d.user_id = ? AND u.status = 'active' AND p.setup_complete = 1
     ORDER BY d.score DESC, d.created_at DESC`,
    [userId]
  );
  return rows
    .filter((row) => !blocked.has(row.candidate_id))
    .map((row) => ({
      userId: row.candidate_id,
      score: row.score,
      reasons: parseJson(row.reasons, []),
      components: parseJson(row.components, {}),
      seen: Boolean(row.seen),
      discoveredAt: row.created_at,
      profile: publicProfile(row.candidate_id),
    }))
    .filter((item) => item.profile);
}

export function markDiscoverySeen(userId, candidateId) {
  run('UPDATE discoveries SET seen = 1 WHERE user_id = ? AND candidate_id = ?', [userId, candidateId]);
}

export function clearDiscoveries(userId) {
  run('DELETE FROM discoveries WHERE user_id = ?', [userId]);
}
