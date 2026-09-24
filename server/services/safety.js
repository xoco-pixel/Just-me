/** Blocking and reporting. All state is persisted server-side. */
import { all, get, run, transaction } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { isKnownReportCategory } from '../lib/taxonomy.js';
import { newId, normaliseText, nowIso } from '../lib/util.js';
import { notify } from './notifications.js';
import { getUserById, publicProfile } from './users.js';

export function blockUser(blockerId, blockedId, reason = '') {
  if (blockerId === blockedId) throw ApiError.badRequest('You cannot block yourself.');
  const target = getUserById(blockedId);
  if (!target) throw ApiError.notFound('That person does not exist.');

  const existing = get('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]);
  if (existing) throw ApiError.conflict('You have already blocked this person.');

  const id = newId('blk');
  transaction(() => {
    run('INSERT INTO blocks (id, blocker_id, blocked_id, reason, created_at) VALUES (?, ?, ?, ?, ?)', [
      id,
      blockerId,
      blockedId,
      normaliseText(reason, 300),
      nowIso(),
    ]);
    // Existing interactions are torn down: pending contact exchanges are cancelled
    // and any in-flight match is cancelled, so a block immediately stops contact flow.
    run(
      `UPDATE contact_exchanges
          SET status = 'cancelled', cancelled_reason = 'blocked', updated_at = ?
        WHERE status = 'pending'
          AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))`,
      [nowIso(), blockerId, blockedId, blockedId, blockerId]
    );
    run(
      `UPDATE matches
          SET status = 'cancelled', updated_at = ?
        WHERE status IN ('pending', 'mutual')
          AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))`,
      [nowIso(), blockerId, blockedId, blockedId, blockerId]
    );
  });

  notify(blockedId, {
    type: 'safety',
    title: 'A connection was ended',
    body: 'Someone you were connected with ended the connection. Their details are no longer visible to you.',
    refType: 'block',
    refId: id,
  });

  return { id, blockedId };
}

export function unblockUser(blockerId, blockedId) {
  const result = run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]);
  if (result.changes === 0) throw ApiError.notFound('That person is not on your blocked list.');
  return { unblocked: true };
}

export function listBlocks(blockerId) {
  return all(
    `SELECT b.id, b.blocked_id, b.reason, b.created_at
       FROM blocks b WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
    [blockerId]
  ).map((row) => {
    const profile = publicProfile(row.blocked_id);
    return {
      id: row.id,
      userId: row.blocked_id,
      displayName: profile?.displayName || 'Removed user',
      reason: row.reason,
      createdAt: row.created_at,
    };
  });
}

/** Ids that must be excluded from matching for `userId`, in either direction. */
export function blockedIdsFor(userId) {
  const rows = all('SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [
    userId,
    userId,
  ]);
  return new Set(rows.map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id)));
}

export function isBlocked(userA, userB) {
  const row = get(
    'SELECT id FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    [userA, userB, userB, userA]
  );
  return Boolean(row);
}

export function reportUser(reporterId, reportedId, category, description = '') {
  if (reporterId === reportedId) throw ApiError.badRequest('You cannot report yourself.');
  if (!isKnownReportCategory(category)) {
    throw ApiError.badRequest('Choose a valid report category.', { category });
  }
  const target = getUserById(reportedId);
  if (!target) throw ApiError.notFound('That person does not exist.');

  const duplicate = get(
    `SELECT id FROM reports
      WHERE reporter_id = ? AND reported_id = ? AND status = 'pending'`,
    [reporterId, reportedId]
  );
  if (duplicate) throw ApiError.conflict('You already reported this person. Our team is reviewing it.');

  const id = newId('rpt');
  run(
    `INSERT INTO reports (id, reporter_id, reported_id, category, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, reporterId, reportedId, category, normaliseText(description, 1000), nowIso()]
  );
  run(
    `INSERT INTO moderation_flags (id, user_id, kind, detail, severity, status, created_at)
     VALUES (?, ?, 'user_report', ?, 'medium', 'open', ?)`,
    [newId('flg'), reportedId, `Report ${category} (report ${id})`, nowIso()]
  );
  return { id, status: 'pending' };
}

export function listReportsFor(reportedId) {
  return all('SELECT * FROM reports WHERE reported_id = ? ORDER BY created_at DESC', [reportedId]);
}
