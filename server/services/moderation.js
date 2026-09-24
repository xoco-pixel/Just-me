/**
 * Rule-based moderation heuristics.
 *
 * These are deterministic pattern rules, not machine learning. They create
 * reviewable flags in the admin queue; they never claim to have "verified" a
 * profile. Anything they cannot judge is left for human review.
 */
import { all, get, run } from '../db/index.js';
import { newId, nowIso } from '../lib/util.js';

const SCAM_PHRASES = [
  'western union',
  'wire transfer',
  'gift card',
  'send me money',
  'send money',
  'bank details',
  'bitcoin',
  'crypto investment',
  'investment opportunity',
  'pay me',
  'cashapp',
  'urgent help with funds',
];

const CONTACT_IN_BIO = [
  /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/i, // email address
  /(?:\+?\d[\d\s-]{7,}\d)/, // phone-like sequence
  /(?:https?:\/\/|www\.)\S+/i, // url
  /(?:instagram|whatsapp|snapchat|telegram)\s*[:@]?\s*[\w.-]{3,}/i,
];

export function scanBio(bio) {
  const text = String(bio || '');
  const issues = [];
  const lower = text.toLowerCase();
  for (const phrase of SCAM_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push({ kind: 'bio_text', severity: 'high', detail: `Bio contains "${phrase}"` });
    }
  }
  for (const pattern of CONTACT_IN_BIO) {
    if (pattern.test(text)) {
      issues.push({
        kind: 'bio_text',
        severity: 'medium',
        detail: 'Bio appears to contain contact details, which should be shared through mutual contact exchange',
      });
      break;
    }
  }
  return issues;
}

export function scanDisplayName(displayName) {
  const issues = [];
  const text = String(displayName || '');
  if (/(?:official|verified|admin|support|quicksense)/i.test(text)) {
    issues.push({ kind: 'display_name', severity: 'medium', detail: 'Display name impersonates an official account' });
  }
  if (CONTACT_IN_BIO[0].test(text) || CONTACT_IN_BIO[2].test(text)) {
    issues.push({ kind: 'display_name', severity: 'medium', detail: 'Display name contains contact details' });
  }
  return issues;
}

/** Detects near-identical new profiles, a common fake-profile pattern. */
export function scanDuplicateProfile({ displayName, country, age, excludeUserId }) {
  const row = get(
    `SELECT p.user_id FROM profiles p
       JOIN users u ON u.id = p.user_id
      WHERE lower(p.display_name) = lower(?) AND p.country = ? AND p.age = ? AND p.user_id != ? AND u.status = 'active'
      LIMIT 1`,
    [displayName, country, age, excludeUserId]
  );
  if (!row) return [];
  return [
    {
      kind: 'duplicate_profile',
      severity: 'medium',
      detail: `Matches an existing profile with the same name, country and age (${row.user_id})`,
    },
  ];
}

/** Sliding-window action counting. Returns a flag issue when the rate is unusual. */
export function scanActionRate(userId, action, windowMinutes = 5, threshold = 30) {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const row = get(
    'SELECT COUNT(*) AS count FROM security_log WHERE actor_id = ? AND action = ? AND at > ?',
    [userId, action, since]
  );
  if (row.count < threshold) return [];
  return [
    {
      kind: 'rapid_action',
      severity: 'low',
      detail: `${row.count} "${action}" actions in ${windowMinutes} minutes`,
    },
  ];
}

export function recordFlags(userId, issues) {
  for (const issue of issues) {
    run(
      `INSERT INTO moderation_flags (id, user_id, kind, detail, severity, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      [newId('flg'), userId, issue.kind, issue.detail, issue.severity, nowIso()]
    );
  }
  return issues.length;
}

export function openFlagsFor(userId) {
  return all("SELECT * FROM moderation_flags WHERE user_id = ? AND status = 'open'", [userId]);
}

export function flagCountFor(userId) {
  return get("SELECT COUNT(*) AS count FROM moderation_flags WHERE user_id = ? AND status='open'", [userId]).count;
}
