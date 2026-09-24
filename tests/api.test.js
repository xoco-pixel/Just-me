/**
 * End-to-end API tests.
 *
 * These drive the real Express app over HTTP against a real SQLite file, then
 * re-open that file to prove the data persisted. They exist to verify the
 * product's hard rules: 18+ only, two-way compatibility, contact details only
 * after MUTUAL consent, blocks respected, settings actually changing behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quicksense-test-'));
process.env.QUICKSENSE_DB = path.join(tmp, 'test.db');
process.env.QUICKSENSE_UPLOADS = path.join(tmp, 'uploads');
// The suite drives many synthetic accounts from a single IP; rate limiting
// would trip on it. It stays enabled in every non-test environment.
process.env.NODE_ENV = 'test';

const { createApp, ensureAdminAccount } = await import('../server/index.js');
const { db, closeDatabase } = await import('../server/db/index.js');

const app = createApp({ dbPath: process.env.QUICKSENSE_DB });
const admin = ensureAdminAccount();

let server;
let baseUrl;

const VALID_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

async function api(method, route, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function register() {
  const res = await api('POST', '/api/auth/register');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function completeProfile(token, overrides = {}) {
  const res = await api('PUT', '/api/profile', {
    token,
    body: {
      displayName: 'Test Person',
      dateOfBirth: '2000-05-10',
      gender: 'woman',
      country: 'NG',
      city: 'Port Harcourt',
      bio: 'I love music and meeting interesting people.',
      interests: ['music', 'gaming', 'travel'],
      languages: ['english'],
      intentions: ['dating', 'friendship'],
      ...overrides,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('health reports the real database state', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.users, 'number');
});

test('capabilities declares what is NOT implemented', async () => {
  const res = await api('GET', '/api/capabilities');
  assert.equal(res.status, 200);
  const missing = res.body.notImplemented.map((item) => item.feature);
  assert.ok(missing.includes('email_delivery'));
  assert.ok(missing.includes('payments'));
  assert.ok(res.body.implemented.includes('matching_engine_with_reasons'));
});

test('register issues a real QuickSense ID and session', async () => {
  const account = await register();
  assert.match(account.qsId, /^QS-[A-Z2-9]{6}$/);
  assert.ok(account.token.length > 20);
  const me = await api('GET', '/api/auth/me', { token: account.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.qsId, account.qsId);
  assert.equal(me.body.setupComplete, false);
});

test('unauthenticated requests are rejected, not silently allowed', async () => {
  const res = await api('GET', '/api/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'unauthorized');
});

test('under-18 profiles are refused', async () => {
  const account = await register();
  const res = await api('PUT', '/api/profile', {
    token: account.token,
    body: {
      displayName: 'Too Young',
      dateOfBirth: '2015-01-01',
      gender: 'man',
      country: 'NG',
      interests: ['music', 'gaming', 'travel'],
      intentions: ['friendship'],
    },
  });
  assert.equal(res.status, 422);
  assert.ok(JSON.stringify(res.body).includes('18'), 'should explain the 18+ rule');
});

test('searching before the profile is complete is refused', async () => {
  const account = await register();
  const res = await api('POST', '/api/matches/find', { token: account.token });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details.code, 'profile_incomplete');
});

test('full flow: two users find each other with real compatibility reasons', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Amara' });
  await completeProfile(b.token, { displayName: 'Sarah', dateOfBirth: '1998-03-04' });

  const search = await api('POST', '/api/matches/find', { token: a.token });
  assert.equal(search.status, 200, JSON.stringify(search.body));
  assert.ok(search.body.count >= 1, 'expected at least one candidate');
  assert.ok(search.body.diagnostics.profilesConsidered >= 1, 'diagnostics must report real scan count');

  const match = search.body.results.find((r) => r.profile.displayName === 'Sarah');
  assert.ok(match, 'Amara should find Sarah');
  assert.ok(match.score > 0 && match.score <= 100);
  assert.ok(match.reasons.length > 0, 'every result needs a why');
  const interestReason = match.reasons.find((r) => r.type === 'shared_interests');
  assert.ok(interestReason, 'shared interests must be explained');
  assert.ok(interestReason.values.includes('music'));
  // No fake data: the returned profile is the real stored one.
  assert.equal(match.profile.countryName, 'Nigeria');
  assert.equal(match.profile.age, 28);
});

test('one-sided age preference yields a low, capped score in the real API', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Narrow', dateOfBirth: '2002-02-02' });
  await completeProfile(b.token, { displayName: 'Older', dateOfBirth: '1975-02-02' });
  await api('PUT', '/api/preferences', { token: a.token, body: { ageMin: 18, ageMax: 25 } });
  await api('PUT', '/api/preferences', { token: b.token, body: { ageMin: 45, ageMax: 60 } });

  const search = await api('POST', '/api/matches/find', { token: a.token });
  const older = search.body.results.find((r) => r.profile.displayName === 'Older');
  // Either excluded or capped well below a strong match.
  assert.ok(!older || older.score <= 45, `expected capped/excluded, got ${older && older.score}`);
});

test('contact details are NEVER revealed before mutual consent', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Requester' });
  await completeProfile(b.token, { displayName: 'Recipient' });

  // Mutual match first.
  const search = await api('POST', '/api/matches/find', { token: a.token });
  const target = search.body.results.find((r) => r.profile.displayName === 'Recipient');
  assert.ok(target);
  await api('POST', `/api/matches/${target.userId}/action`, { token: a.token, body: { action: 'like' } });
  const bSearch = await api('POST', '/api/matches/find', { token: b.token });
  const back = bSearch.body.results.find((r) => r.profile.displayName === 'Requester');
  assert.ok(back, 'Recipient should also find Requester');
  const mutual = await api('POST', `/api/matches/${back.userId}/action`, {
    token: b.token,
    body: { action: 'like' },
  });
  assert.equal(mutual.status, 201);
  assert.equal(mutual.body.mutual, true);

  // Requester has no contact method yet -> honest refusal, not a fake success.
  const noContact = await api('POST', '/api/exchange/request', {
    token: a.token,
    body: { recipientId: target.userId },
  });
  assert.equal(noContact.status, 400);
  assert.equal(noContact.body.error.details.code, 'no_shareable_contact');

  await api('POST', '/api/profile/contact-methods', {
    token: a.token,
    body: { type: 'instagram', value: '@requester', shareable: true },
  });
  await api('POST', '/api/profile/contact-methods', {
    token: b.token,
    body: { type: 'whatsapp', value: '+2348012345678', shareable: true },
  });

  const request = await api('POST', '/api/exchange/request', {
    token: a.token,
    body: { recipientId: target.userId },
  });
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const exchangeId = request.body.id;

  // Before the recipient accepts: details must be forbidden.
  const blocked = await api('GET', `/api/exchange/${exchangeId}/details`, { token: a.token });
  assert.equal(blocked.status, 403, 'one-sided approval must NOT unlock contact info');

  // A third party cannot read it either.
  const c = await register();
  const outsider = await api('GET', `/api/exchange/${exchangeId}/details`, { token: c.token });
  assert.equal(outsider.status, 403);

  // Recipient accepts -> unlocked for BOTH parties only.
  const list = await api('GET', '/api/exchange', { token: b.token });
  const incoming = list.body.incoming.find((e) => e.id === exchangeId);
  assert.ok(incoming, 'recipient must see the pending request');
  const accept = await api('POST', `/api/exchange/${exchangeId}/respond`, {
    token: b.token,
    body: { action: 'accept' },
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.status, 'unlocked');

  const details = await api('GET', `/api/exchange/${exchangeId}/details`, { token: a.token });
  assert.equal(details.status, 200);
  assert.equal(details.body.contactMethods[0].value, '+2348012345678');
});

test('declining an exchange reveals nothing', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Decliner A' });
  await completeProfile(b.token, { displayName: 'Decliner B' });
  await api('POST', '/api/profile/contact-methods', {
    token: a.token,
    body: { type: 'email', value: 'a@example.com', shareable: true },
  });
  await api('POST', '/api/profile/contact-methods', {
    token: b.token,
    body: { type: 'email', value: 'b@example.com', shareable: true },
  });
  const s1 = await api('POST', '/api/matches/find', { token: a.token });
  const t1 = s1.body.results.find((r) => r.profile.displayName === 'Decliner B');
  await api('POST', `/api/matches/${t1.userId}/action`, { token: a.token, body: { action: 'like' } });
  const s2 = await api('POST', '/api/matches/find', { token: b.token });
  const t2 = s2.body.results.find((r) => r.profile.displayName === 'Decliner A');
  await api('POST', `/api/matches/${t2.userId}/action`, { token: b.token, body: { action: 'like' } });

  const request = await api('POST', '/api/exchange/request', {
    token: a.token,
    body: { recipientId: t1.userId },
  });
  const declined = await api('POST', `/api/exchange/${request.body.id}/respond`, {
    token: b.token,
    body: { action: 'decline' },
  });
  assert.equal(declined.body.status, 'declined');
  const details = await api('GET', `/api/exchange/${request.body.id}/details`, { token: a.token });
  assert.equal(details.status, 403);
});

test('blocking removes someone from search and stops contact exchange', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Blocker' });
  await completeProfile(b.token, { displayName: 'Blocked Person' });

  const before = await api('POST', '/api/matches/find', { token: a.token });
  const target = before.body.results.find((r) => r.profile.displayName === 'Blocked Person');
  assert.ok(target, 'Blocker should find Blocked Person first');

  // Blocking yourself must be refused, not silently accepted.
  const selfBlock = await api('POST', '/api/safety/block', {
    token: a.token,
    body: { userId: a.userId },
  });
  assert.equal(selfBlock.status, 400);

  const block = await api('POST', '/api/safety/block', {
    token: a.token,
    body: { userId: target.userId, reason: 'testing' },
  });
  assert.equal(block.status, 201, JSON.stringify(block.body));

  const after = await api('POST', '/api/matches/find', { token: a.token });
  assert.ok(
    !after.body.results.some((r) => r.profile.displayName === 'Blocked Person'),
    'blocked users must not appear in results'
  );
  const action = await api('POST', `/api/matches/${target.userId}/action`, {
    token: a.token,
    body: { action: 'like' },
  });
  assert.equal(action.status, 403);

  const blocks = await api('GET', '/api/safety/blocks', { token: a.token });
  assert.equal(blocks.body.blocks.length, 1);
});

test('reporting creates a real record that reaches the admin queue', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Reporter' });
  await completeProfile(b.token, { displayName: 'Reported' });
  const search = await api('POST', '/api/matches/find', { token: a.token });
  const target = search.body.results.find((r) => r.profile.displayName === 'Reported');

  const badCategory = await api('POST', '/api/safety/report', {
    token: a.token,
    body: { userId: target.userId, category: 'not_a_real_category' },
  });
  assert.equal(badCategory.status, 422);

  const report = await api('POST', '/api/safety/report', {
    token: a.token,
    body: { userId: target.userId, category: 'scam', description: 'Asked for money' },
  });
  assert.equal(report.status, 201);
  assert.equal(report.body.status, 'pending');

  const duplicate = await api('POST', '/api/safety/report', {
    token: a.token,
    body: { userId: target.userId, category: 'spam' },
  });
  assert.equal(duplicate.status, 409);
});

test('notification preferences genuinely suppress notifications', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Quiet Viewer' });
  await completeProfile(b.token, { displayName: 'Viewed Person' });

  // Turn profile-view notifications off for B.
  const prefs = await api('PUT', '/api/notifications/preferences', {
    token: b.token,
    body: { notifyProfileView: false },
  });
  assert.equal(prefs.body.preferences.notifyProfileView, false);

  const search = await api('POST', '/api/matches/find', { token: a.token });
  const target = search.body.results.find((r) => r.profile.displayName === 'Viewed Person');
  const view = await api('GET', `/api/users/${target.userId}`, { token: a.token });
  assert.equal(view.status, 200);
  assert.equal(view.body.viewNotified, false, 'disabled notification must not be delivered');

  const list = await api('GET', '/api/notifications', { token: b.token });
  assert.equal(
    list.body.notifications.filter((n) => n.type === 'profile_view').length,
    0
  );
});

test('hiding from search really removes the profile from other searches', async () => {
  const a = await register();
  const b = await register();
  await completeProfile(a.token, { displayName: 'Searcher' });
  await completeProfile(b.token, { displayName: 'Hidden Person' });

  const before = await api('POST', '/api/matches/find', { token: a.token });
  assert.ok(before.body.results.some((r) => r.profile.displayName === 'Hidden Person'));

  const hide = await api('PUT', '/api/settings', { token: b.token, body: { showInSearch: false } });
  assert.equal(hide.body.settings.showInSearch, false);

  const after = await api('POST', '/api/matches/find', { token: a.token });
  assert.ok(!after.body.results.some((r) => r.profile.displayName === 'Hidden Person'));
});

test('photo upload validates real bytes and serves them back', async () => {
  const account = await register();
  await completeProfile(account.token, { displayName: 'Photographer' });

  const rejected = await api('POST', '/api/profile/photos', {
    token: account.token,
    body: { dataUrl: 'data:text/plain;base64,aGVsbG8=' },
  });
  assert.equal(rejected.status, 400, 'non-image mime must be rejected');

  const fakeImage = await api('POST', '/api/profile/photos', {
    token: account.token,
    body: { dataUrl: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}` },
  });
  assert.equal(fakeImage.status, 400, 'magic-byte check must reject a disguised file');

  const uploaded = await api('POST', '/api/profile/photos', {
    token: account.token,
    body: { dataUrl: `data:image/png;base64,${VALID_PNG}` },
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.photo.moderationStatus, 'pending');
  assert.ok(fs.existsSync(path.join(process.env.QUICKSENSE_UPLOADS, account.userId)));

  const res = await fetch(`${baseUrl}${uploaded.body.photo.url}`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');

  const anonymous = await fetch(`${baseUrl}${uploaded.body.photo.url}`);
  assert.equal(anonymous.status, 401, 'photos must not be publicly readable');
});

test('restore and recovery-code flows really restore the same account', async () => {
  const account = await register();
  await completeProfile(account.token, { displayName: 'Restorable' });

  const restored = await api('POST', '/api/auth/restore', { token: undefined, body: { token: account.token } });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.qsId, account.qsId);

  const badCode = await api('POST', '/api/auth/recover', {
    body: { identifier: account.qsId, code: 'QS-FAKE-CODE-HERE' },
  });
  assert.equal(badCode.status, 401);

  const issued = await api('POST', '/api/auth/recovery-code', {
    token: account.token,
    body: { email: 'restore@example.com' },
  });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.emailDelivery, 'not_configured', 'must not pretend an email was sent');

  const recovered = await api('POST', '/api/auth/recover', {
    body: { identifier: 'restore@example.com', code: issued.body.recoveryCode },
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.qsId, account.qsId);
  const me = await api('GET', '/api/auth/me', { token: recovered.body.token });
  assert.equal(me.body.profile.displayName, 'Restorable');
});

test('account deletion removes the account and all its data', async () => {
  const account = await register();
  await completeProfile(account.token, { displayName: 'Deletable' });
  const refused = await api('DELETE', '/api/auth/account', { token: account.token, body: { confirm: 'no' } });
  assert.equal(refused.status, 400);
  const deleted = await api('DELETE', '/api/auth/account', { token: account.token, body: { confirm: 'DELETE' } });
  assert.equal(deleted.status, 200);
  const me = await api('GET', '/api/auth/me', { token: account.token });
  assert.equal(me.status, 401);
  assert.equal(db().prepare('SELECT COUNT(*) AS c FROM profiles WHERE user_id = ?').get(account.userId).c, 0);
});

test('admin area is protected and returns real counts', async () => {
  const forbidden = await api('GET', '/api/admin/overview');
  assert.equal(forbidden.status, 401);

  const login = await api('POST', '/api/auth/login', {
    body: { identifier: admin.email, password: admin.password },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, 'admin');

  const overview = await api('GET', '/api/admin/overview', { token: login.body.token });
  assert.equal(overview.status, 200);
  assert.ok(overview.body.users.total >= 1);
  assert.ok(overview.body.moderation.openReports >= 1, 'the report filed earlier must be in the queue');
  assert.ok(overview.body.moderation.photosPending >= 1);

  const reports = await api('GET', '/api/admin/reports?status=pending', { token: login.body.token });
  assert.ok(reports.body.reports.some((r) => r.category === 'scam'));

  const reviewed = await api('POST', `/api/admin/reports/${reports.body.reports[0].id}/review`, {
    token: login.body.token,
    body: { action: 'suspend', note: 'confirmed scam' },
  });
  assert.equal(reviewed.status, 200);
  const after = await api('GET', '/api/admin/overview', { token: login.body.token });
  assert.ok(after.body.users.suspended >= 1, 'suspending must be reflected in real counts');
});

test('a normal user cannot reach admin endpoints', async () => {
  const account = await register();
  const res = await api('GET', '/api/admin/overview', { token: account.token });
  assert.equal(res.status, 403);
});

test('data survives a full database re-open (persistence check)', async () => {
  const account = await register();
  await completeProfile(account.token, { displayName: 'Persistent Person' });
  const userId = account.userId;

  closeDatabase();
  const { initDatabase } = await import('../server/db/index.js');
  initDatabase(process.env.QUICKSENSE_DB);

  const row = db()
    .prepare('SELECT display_name FROM profiles WHERE user_id = ?')
    .get(userId);
  assert.equal(row.display_name, 'Persistent Person');
  assert.ok(db().prepare('SELECT COUNT(*) AS c FROM taxonomy').get().c > 100);
});
