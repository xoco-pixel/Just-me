/**
 * Contact exchange.
 *
 * The single most important rule in QuickSense: contact details are revealed
 * ONLY when BOTH people have accepted. `getExchangeDetails` is the only place
 * that returns contact values, and it re-checks the stored statuses itself rather
 * than trusting the caller.
 */
import { all, get, run, transaction } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso } from '../lib/util.js';
import { notify } from './notifications.js';
import { isBlocked } from './safety.js';
import { getContactMethods, getUserById, publicProfile } from './users.js';

function activeExchangeBetween(a, b) {
  return get(
    `SELECT * FROM contact_exchanges
      WHERE status IN ('pending', 'unlocked')
        AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))`,
    [a, b, b, a]
  );
}

export function hasMutualMatch(a, b) {
  return Boolean(
    get(
      `SELECT id FROM matches
        WHERE status = 'mutual' AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))`,
      [a, b, b, a]
    )
  );
}

export function shareableMethods(userId) {
  return getContactMethods(userId).filter((m) => m.shareable === 1);
}

export function requestExchange(requesterId, recipientId) {
  if (requesterId === recipientId) throw ApiError.badRequest('You cannot exchange contact with yourself.');
  const recipient = getUserById(recipientId);
  if (!recipient || recipient.status !== 'active') throw ApiError.notFound('That person is not available.');
  if (isBlocked(requesterId, recipientId)) {
    throw ApiError.forbidden('Contact exchange is not available with this person.');
  }
  if (!hasMutualMatch(requesterId, recipientId)) {
    throw ApiError.forbidden('You can only exchange contact after a mutual match.');
  }
  if (activeExchangeBetween(requesterId, recipientId)) {
    throw ApiError.conflict('A contact exchange with this person is already in progress or unlocked.');
  }
  if (shareableMethods(requesterId).length === 0) {
    throw ApiError.badRequest(
      'Add at least one contact method and mark it shareable before requesting an exchange.',
      { code: 'no_shareable_contact' }
    );
  }
  if (shareableMethods(recipientId).length === 0) {
    throw ApiError.badRequest(
      'This person has not added a shareable contact method yet, so an exchange would reveal nothing.',
      { code: 'recipient_has_no_contact' }
    );
  }

  const id = newId('exc');
  const now = nowIso();
  run(
    `INSERT INTO contact_exchanges
       (id, requester_id, recipient_id, requester_status, recipient_status, status, created_at, updated_at)
     VALUES (?, ?, ?, 'accepted', 'pending', 'pending', ?, ?)`,
    [id, requesterId, recipientId, now, now]
  );

  const requester = publicProfile(requesterId);
  notify(recipientId, {
    type: 'contact_request',
    title: `${requester?.displayName || 'Someone'} wants to exchange contact information`,
    body: 'Nothing is shared until you both agree.',
    refType: 'exchange',
    refId: id,
  });

  return { id, status: 'pending' };
}

export function respondExchange(userId, exchangeId, action) {
  const exchange = get('SELECT * FROM contact_exchanges WHERE id = ?', [exchangeId]);
  if (!exchange) throw ApiError.notFound('That request does not exist.');
  if (exchange.recipient_id !== userId) {
    throw ApiError.forbidden('Only the person who received this request can respond to it.');
  }
  if (exchange.status !== 'pending') {
    throw ApiError.conflict(`This request has already been ${exchange.status}.`);
  }
  if (!['accept', 'decline'].includes(action)) {
    throw ApiError.badRequest("Response must be 'accept' or 'decline'.");
  }
  if (isBlocked(exchange.requester_id, exchange.recipient_id)) {
    throw ApiError.forbidden('Contact exchange is not available with this person.');
  }

  const accepted = action === 'accept';
  const now = nowIso();
  const nextStatus = accepted ? 'unlocked' : 'declined';

  transaction(() => {
    run(
      `UPDATE contact_exchanges
          SET recipient_status = ?, status = ?, updated_at = ?, unlocked_at = ?
        WHERE id = ? AND status = 'pending'`,
      [accepted ? 'accepted' : 'declined', nextStatus, now, accepted ? now : null, exchangeId]
    );
  });

  const requesterName = publicProfile(exchange.requester_id)?.displayName || 'Someone';
  const recipientName = publicProfile(exchange.recipient_id)?.displayName || 'Someone';

  if (accepted) {
    notify(exchange.requester_id, {
      type: 'exchange_unlocked',
      title: `🎉 ${recipientName} agreed to exchange contacts`,
      body: 'You both consented. Their contact details are now unlocked.',
      refType: 'exchange',
      refId: exchangeId,
    });
    notify(exchange.recipient_id, {
      type: 'exchange_unlocked',
      title: '🔓 Contact exchange unlocked',
      body: `You and ${requesterName} both agreed. Their contact details are now visible.`,
      refType: 'exchange',
      refId: exchangeId,
    });
  } else {
    notify(exchange.requester_id, {
      type: 'exchange_declined',
      title: `${recipientName} declined the contact exchange`,
      body: 'No contact information was shared.',
      refType: 'exchange',
      refId: exchangeId,
    });
  }

  return getExchange(userId, exchangeId);
}

/** Shape an exchange row for its owner. Never includes contact values. */
export function shapeExchange(exchange, viewerId) {
  const otherId = exchange.requester_id === viewerId ? exchange.recipient_id : exchange.requester_id;
  const other = publicProfile(otherId);
  return {
    id: exchange.id,
    otherUserId: otherId,
    otherName: other?.displayName || 'Removed user',
    otherPhoto: other?.photos?.[0]?.url || null,
    direction: exchange.requester_id === viewerId ? 'outgoing' : 'incoming',
    requesterStatus: exchange.requester_status,
    recipientStatus: exchange.recipient_status,
    status: exchange.status,
    unlocked: exchange.status === 'unlocked',
    createdAt: exchange.created_at,
    updatedAt: exchange.updated_at,
  };
}

export function getExchange(userId, exchangeId) {
  const exchange = get('SELECT * FROM contact_exchanges WHERE id = ?', [exchangeId]);
  if (!exchange) throw ApiError.notFound('That request does not exist.');
  if (exchange.requester_id !== userId && exchange.recipient_id !== userId) {
    throw ApiError.forbidden('This request does not belong to you.');
  }
  return shapeExchange(exchange, userId);
}

/**
 * THE consent gate. Returns contact values only when both sides accepted.
 * Anyone else — including either party before mutual consent — gets 403.
 */
export function getExchangeDetails(userId, exchangeId) {
  const exchange = get('SELECT * FROM contact_exchanges WHERE id = ?', [exchangeId]);
  if (!exchange) throw ApiError.notFound('That request does not exist.');
  if (exchange.requester_id !== userId && exchange.recipient_id !== userId) {
    throw ApiError.forbidden('This request does not belong to you.');
  }
  const bothAccepted =
    exchange.status === 'unlocked' &&
    exchange.requester_status === 'accepted' &&
    exchange.recipient_status === 'accepted';

  if (!bothAccepted) {
    throw ApiError.forbidden(
      exchange.status === 'declined'
        ? 'This exchange was declined, so no contact information is shared.'
        : 'Contact information unlocks only after both people accept.'
    );
  }

  const otherId = exchange.requester_id === userId ? exchange.recipient_id : exchange.requester_id;
  const methods = shareableMethods(otherId).map((m) => ({ type: m.type, label: m.label, value: m.value }));
  return {
    id: exchange.id,
    status: 'unlocked',
    unlockedAt: exchange.unlocked_at,
    otherUserId: otherId,
    otherName: publicProfile(otherId)?.displayName || 'Removed user',
    contactMethods: methods,
  };
}

export function listExchanges(userId) {
  const rows = all(
    `SELECT * FROM contact_exchanges
      WHERE requester_id = ? OR recipient_id = ?
      ORDER BY created_at DESC`,
    [userId, userId]
  );
  return {
    incoming: rows.filter((r) => r.recipient_id === userId && r.status === 'pending').map((r) => shapeExchange(r, userId)),
    outgoing: rows.filter((r) => r.requester_id === userId && r.status === 'pending').map((r) => shapeExchange(r, userId)),
    connections: rows.filter((r) => r.status === 'unlocked').map((r) => shapeExchange(r, userId)),
    closed: rows
      .filter((r) => r.status === 'declined' || r.status === 'cancelled')
      .map((r) => shapeExchange(r, userId)),
  };
}
