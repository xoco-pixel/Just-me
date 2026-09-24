/** Protected admin area: users, moderation queue, matching stats, analytics. */
import express from 'express';
import { all, get, run } from '../db/index.js';
import { asyncHandler, rateLimit, requireAdmin } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso } from '../lib/util.js';
import { getUserById } from '../services/users.js';

const router = express.Router();
router.use(requireAdmin);

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

/** GET /api/admin/overview */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const users = {
      total: get("SELECT COUNT(*) AS c FROM users WHERE role='user'").c,
      active: get("SELECT COUNT(*) AS c FROM users WHERE role='user' AND status='active'").c,
      suspended: get("SELECT COUNT(*) AS c FROM users WHERE role='user' AND status='suspended'").c,
      newToday: get("SELECT COUNT(*) AS c FROM users WHERE role='user' AND created_at > ?", [daysAgo(1)]).c,
      newThisWeek: get("SELECT COUNT(*) AS c FROM users WHERE role='user' AND created_at > ?", [daysAgo(7)]).c,
      withCompleteProfile: get('SELECT COUNT(*) AS c FROM profiles WHERE setup_complete = 1').c,
      demo: get('SELECT COUNT(*) AS c FROM users WHERE is_demo = 1').c,
    };
    const moderation = {
      openReports: get("SELECT COUNT(*) AS c FROM reports WHERE status='pending'").c,
      reviewedReports: get("SELECT COUNT(*) AS c FROM reports WHERE status!='pending'").c,
      reportedUsers: get('SELECT COUNT(DISTINCT reported_id) AS c FROM reports').c,
      openFlags: get("SELECT COUNT(*) AS c FROM moderation_flags WHERE status='open'").c,
      highSeverityFlags: get("SELECT COUNT(*) AS c FROM moderation_flags WHERE status='open' AND severity='high'").c,
      photosPending: get("SELECT COUNT(*) AS c FROM photos WHERE moderation_status='pending'").c,
    };
    const matching = {
      totalMatches: get('SELECT COUNT(*) AS c FROM matches').c,
      mutualMatches: get("SELECT COUNT(*) AS c FROM matches WHERE status='mutual'").c,
      pendingMatches: get("SELECT COUNT(*) AS c FROM matches WHERE status='pending'").c,
      exchangeRequests: get('SELECT COUNT(*) AS c FROM contact_exchanges').c,
      unlockedExchanges: get("SELECT COUNT(*) AS c FROM contact_exchanges WHERE status='unlocked'").c,
      declinedExchanges: get("SELECT COUNT(*) AS c FROM contact_exchanges WHERE status='declined'").c,
      blocks: get('SELECT COUNT(*) AS c FROM blocks').c,
    };
    const activity = {
      daily: get('SELECT COUNT(*) AS c FROM users WHERE last_seen_at > ?', [daysAgo(1)]).c,
      weekly: get('SELECT COUNT(*) AS c FROM users WHERE last_seen_at > ?', [daysAgo(7)]).c,
      monthly: get('SELECT COUNT(*) AS c FROM users WHERE last_seen_at > ?', [daysAgo(30)]).c,
    };
    const matchRate =
      users.withCompleteProfile > 0
        ? Math.round((matching.mutualMatches / Math.max(1, users.withCompleteProfile)) * 100)
        : 0;

    res.json({
      users,
      moderation,
      matching,
      activity,
      analytics: {
        matchRatePercent: matchRate,
        popularCountries: all(
          `SELECT p.country_name AS label, COUNT(*) AS count FROM profiles p
             JOIN users u ON u.id = p.user_id WHERE u.status='active'
             GROUP BY p.country_name ORDER BY count DESC LIMIT 10`
        ),
        popularInterests: all(
          `SELECT j.value AS label, COUNT(*) AS count
             FROM profiles p, json_each(p.interests) j
             JOIN users u ON u.id = p.user_id
            WHERE u.status='active'
            GROUP BY j.value ORDER BY count DESC LIMIT 10`
        ),
        searchModes: all(
          `SELECT search_mode AS label, COUNT(*) AS count FROM preferences GROUP BY search_mode ORDER BY count DESC`
        ),
      },
      generatedAt: nowIso(),
    });
  })
);

/** GET /api/admin/users?q=&status=&page= */
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.query);
    const q = v.string('q', { required: false, max: 100, allowEmpty: true }) ?? '';
    const status = v.enum('status', ['active', 'suspended'], { required: false });
    const page = v.integer('page', { min: 1, max: 1000, fallback: 1 });
    v.assertValid();
    const limit = 25;
    const offset = (page - 1) * limit;

    const where = [`u.role = 'user'`];
    const params = [];
    if (status) {
      where.push('u.status = ?');
      params.push(status);
    }
    if (q) {
      where.push('(u.qs_id LIKE ? OR p.display_name LIKE ? OR p.country = ?)');
      params.push(`%${q}%`, `%${q}%`, q.toUpperCase());
    }
    const whereSql = where.join(' AND ');
    const total = get(
      `SELECT COUNT(*) AS c FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE ${whereSql}`,
      params
    ).c;
    const rows = all(
      `SELECT u.id, u.qs_id, u.status, u.is_demo, u.created_at, u.last_seen_at,
              p.display_name, p.age, p.country_name, p.setup_complete
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id
        WHERE ${whereSql}
        ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      users: rows.map((row) => ({
        userId: row.id,
        qsId: row.qs_id,
        status: row.status,
        isDemo: Boolean(row.is_demo),
        displayName: row.display_name,
        age: row.age,
        countryName: row.country_name,
        setupComplete: Boolean(row.setup_complete),
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        openFlags: get("SELECT COUNT(*) AS c FROM moderation_flags WHERE user_id=? AND status='open'", [row.id]).c,
        reports: get('SELECT COUNT(*) AS c FROM reports WHERE reported_id=?', [row.id]).c,
      })),
    });
  })
);

/** POST /api/admin/users/:id/status — { status: 'active' | 'suspended', note? } */
router.post(
  '/users/:id/status',
  rateLimit({ limit: 60, name: 'admin-status' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const status = v.enum('status', ['active', 'suspended'], { required: true });
    const note = v.string('note', { required: false, max: 500, allowEmpty: true });
    v.assertValid();
    const user = getUserById(req.params.id);
    if (!user) throw ApiError.notFound('That user does not exist.');
    if (user.role === 'admin') throw ApiError.forbidden('Admin accounts cannot be suspended here.');
    run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), user.id]);
    if (status === 'suspended') {
      run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [nowIso(), user.id]);
    }
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      nowIso(),
      req.user.id,
      'admin_status_change',
      `${user.qs_id} -> ${status}${note ? `: ${note}` : ''}`,
      req.ip,
    ]);
    res.json({ userId: user.id, status, sessionsRevoked: status === 'suspended' });
  })
);

/** GET /api/admin/reports?status= */
router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.query);
    const status = v.enum('status', ['pending', 'reviewed', 'dismissed'], { required: false });
    v.assertValid();
    const params = [];
    let sql = `SELECT r.*, reporter.qs_id AS reporter_qs, reported.qs_id AS reported_qs,
                      p.display_name AS reported_name, p.age AS reported_age, p.country_name AS reported_country
                 FROM reports r
                 JOIN users reporter ON reporter.id = r.reporter_id
                 JOIN users reported ON reported.id = r.reported_id
                 LEFT JOIN profiles p ON p.user_id = r.reported_id`;
    if (status) {
      sql += ' WHERE r.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY r.created_at DESC LIMIT 100';
    res.json({
      reports: all(sql, params).map((row) => ({
        id: row.id,
        category: row.category,
        description: row.description,
        status: row.status,
        resolution: row.resolution,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        reporter: { qsId: row.reporter_qs },
        reported: {
          userId: row.reported_id,
          qsId: row.reported_qs,
          displayName: row.reported_name,
          age: row.reported_age,
          countryName: row.reported_country,
        },
      })),
    });
  })
);

/** POST /api/admin/reports/:id/review — { action: 'dismiss' | 'warn' | 'suspend', note? } */
router.post(
  '/reports/:id/review',
  rateLimit({ limit: 60, name: 'admin-review' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const action = v.enum('action', ['dismiss', 'warn', 'suspend'], { required: true });
    const note = v.string('note', { required: false, max: 500, allowEmpty: true });
    v.assertValid();
    const report = get('SELECT * FROM reports WHERE id = ?', [req.params.id]);
    if (!report) throw ApiError.notFound('That report does not exist.');
    if (report.status !== 'pending') throw ApiError.conflict('That report has already been reviewed.');

    const now = nowIso();
    const status = action === 'dismiss' ? 'dismissed' : 'reviewed';
    run('UPDATE reports SET status = ?, resolution = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', [
      status,
      note || action,
      req.user.id,
      now,
      report.id,
    ]);
    run("UPDATE moderation_flags SET status='cleared' WHERE user_id = ? AND kind='user_report'", [report.reported_id]);

    if (action === 'suspend') {
      run("UPDATE users SET status='suspended', updated_at=? WHERE id=?", [now, report.reported_id]);
      run("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", [now, report.reported_id]);
    }
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      now,
      req.user.id,
      'admin_report_review',
      `${report.id} -> ${action}${note ? `: ${note}` : ''}`,
      req.ip,
    ]);
    res.json({ id: report.id, status, action });
  })
);

/** GET /api/admin/flags */
router.get(
  '/flags',
  asyncHandler(async (req, res) => {
    res.json({
      flags: all(
        `SELECT f.*, u.qs_id, p.display_name FROM moderation_flags f
           JOIN users u ON u.id = f.user_id
           LEFT JOIN profiles p ON p.user_id = f.user_id
          WHERE f.status = 'open'
          ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, f.created_at DESC
          LIMIT 200`
      ).map((row) => ({
        id: row.id,
        userId: row.user_id,
        qsId: row.qs_id,
        displayName: row.display_name,
        kind: row.kind,
        detail: row.detail,
        severity: row.severity,
        createdAt: row.created_at,
      })),
    });
  })
);

/** GET /api/admin/photos/pending — the honest moderation queue for uploads. */
router.get(
  '/photos/pending',
  asyncHandler(async (req, res) => {
    res.json({
      photos: all(
        `SELECT ph.id, ph.user_id, ph.moderation_status, ph.mime, ph.bytes, ph.created_at,
                u.qs_id, p.display_name
           FROM photos ph JOIN users u ON u.id = ph.user_id
           LEFT JOIN profiles p ON p.user_id = ph.user_id
          WHERE ph.moderation_status = 'pending'
          ORDER BY ph.created_at DESC LIMIT 100`
      ).map((row) => ({
        id: row.id,
        url: `/api/photos/${row.id}/file`,
        userId: row.user_id,
        qsId: row.qs_id,
        displayName: row.display_name,
        mime: row.mime,
        bytes: row.bytes,
        createdAt: row.created_at,
      })),
      note: 'No automated image analysis is implemented. A human must approve or reject each photo.',
    });
  })
);

/** POST /api/admin/photos/:id/moderate — { decision: 'approve' | 'reject' } */
router.post(
  '/photos/:id/moderate',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const decision = v.enum('decision', ['approve', 'reject'], { required: true });
    v.assertValid();
    const photo = get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) throw ApiError.notFound('That photo does not exist.');
    run('UPDATE photos SET moderation_status = ? WHERE id = ?', [
      decision === 'approve' ? 'approved' : 'rejected',
      photo.id,
    ]);
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      nowIso(),
      req.user.id,
      'admin_photo_moderation',
      `${photo.id} -> ${decision}`,
      req.ip,
    ]);
    res.json({ id: photo.id, moderationStatus: decision === 'approve' ? 'approved' : 'rejected' });
  })
);

/** GET /api/admin/security-log */
router.get(
  '/security-log',
  asyncHandler(async (req, res) => {
    res.json({
      entries: all('SELECT * FROM security_log ORDER BY at DESC LIMIT 200').map((row) => ({
        id: row.id,
        at: row.at,
        actorId: row.actor_id,
        action: row.action,
        detail: row.detail,
        ip: row.ip,
      })),
    });
  })
);

export default router;
