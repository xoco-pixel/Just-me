/**
 * Notification service.
 *
 * Notifications are only ever created from real events in the API layer. There is
 * no path that inserts a notification for display purposes. If the user has
 * switched a notification type off in Settings, it is genuinely not created.
 */
import { all, get, run } from '../db/index.js';
import { newId, nowIso } from '../lib/util.js';
import { getUserById, getUserSettings } from './users.js';

const TYPE_TO_SETTING = {
  new_match: 'notifyNewMatch',
  mutual_match: 'notifyMutualMatch',
  profile_view: 'notifyProfileView',
  contact_request: 'notifyContactRequest',
  exchange_unlocked: 'notifyExchangeUnlocked',
  exchange_declined: 'notifyContactRequest',
  safety: 'notifySafety',
  account: 'notifySafety',
};

export const NOTIFICATION_TYPES = Object.keys(TYPE_TO_SETTING);

/**
 * @returns {{delivered:boolean, id?:string, reason?:string}}
 */
export function notify(userId, { type, title, body = '', refType = null, refId = null }, recipient = null) {
  const targetUser = recipient || getUserById(userId);
  if (!targetUser || targetUser.status !== 'active') {
    return { delivered: false, reason: 'recipient_inactive' };
  }
  const settingKey = TYPE_TO_SETTING[type];
  if (!settingKey) throw new Error(`Unknown notification type: ${type}`);
  const settings = getUserSettings(targetUser);
  if (settings[settingKey] === false) {
    return { delivered: false, reason: 'disabled_in_settings' };
  }
  const id = newId('ntf');
  run(
    `INSERT INTO notifications (id, user_id, type, title, body, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, type, title, body, refType, refId, nowIso()]
  );
  return { delivered: true, id };
}

export function listNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const sql = unreadOnly
    ? 'SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?';
  return all(sql, [userId, limit]).map(shapeNotification);
}

export function shapeNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    refType: row.ref_type,
    refId: row.ref_id,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  };
}

export function unreadCount(userId) {
  return get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]).count;
}

export function markRead(userId, notificationId) {
  const result = run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', [
    nowIso(),
    notificationId,
    userId,
  ]);
  return result.changes > 0;
}

export function markAllRead(userId) {
  const result = run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [nowIso(), userId]);
  return result.changes;
}
