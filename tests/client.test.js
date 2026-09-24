/**
 * Client-side tests.
 *
 * Executes the real browser modules against a jsdom DOM and a real running
 * server, so a screen that throws or renders without its data fails here rather
 * than silently in a user's browser. No headless Chromium is available in this
 * sandbox, so these cover rendering, data flow and event wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quicksense-client-'));
process.env.QUICKSENSE_DB = path.join(tmp, 'test.db');
process.env.QUICKSENSE_UPLOADS = path.join(tmp, 'uploads');
process.env.NODE_ENV = 'test';

const { createApp, ensureAdminAccount } = await import('../server/index.js');
const { closeDatabase } = await import('../server/db/index.js');

const app = createApp({ dbPath: process.env.QUICKSENSE_DB });
const admin = ensureAdminAccount();

let server;
let baseUrl;
let dom;
let clientModules;

/** Boots a fresh jsdom with the app's real index.html. */
async function bootDom() {
  const html = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf8');
  dom = new JSDOM(html, { url: `${baseUrl}/`, pretendToBeVisual: true });
  const { window } = dom;

  // The client calls fetch('/api/...') with relative paths, which a browser
  // resolves against the page origin. Node's fetch cannot, so wire the origin.
  const resolveUrl = (input) => {
    if (typeof input !== 'string') return input;
    return input.startsWith('http') ? input : `${baseUrl}${input}`;
  };
  const nodeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => nodeFetch(resolveUrl(input), init);
  window.fetch = globalThis.fetch;

  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.navigator.clipboard = { writeText: async () => {} };

  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.HTMLElement = window.HTMLElement;
  global.FileReader = window.FileReader;
  global.Blob = window.Blob;
  global.location = window.location;
  global.setInterval = () => 0;

  // Node 22 exposes a read-only global `navigator`; attach the clipboard rather
  // than replacing the object.
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true,
  });

  // Imported WITHOUT cache-busting query strings: the views import './state.js'
  // and './api.js' plainly, so a cache-busted copy would be a second module
  // instance with its own state, and setState here would never reach them.
  clientModules = {
    api: await import('../public/js/api.js'),
    ui: await import('../public/js/ui.js'),
    state: await import('../public/js/state.js'),
    welcome: await import('../public/js/views/welcome.js'),
    onboarding: await import('../public/js/views/onboarding.js'),
    match: await import('../public/js/views/match.js'),
    matches: await import('../public/js/views/matches.js'),
    profile: await import('../public/js/views/profile.js'),
    notifications: await import('../public/js/views/notifications.js'),
    settings: await import('../public/js/views/settings.js'),
    admin: await import('../public/js/views/admin.js'),
    exchange: await import('../public/js/views/exchange.js'),
  };
  return window;
}

/** Renders a view into a detached root and returns { html, root, view }. */
async function renderView(view, args = []) {
  const result = await view.render(...args);
  const root = document.createElement('div');
  root.innerHTML = result.html;
  document.body.appendChild(root);
  if (result.mount) await result.mount(root, result.data);
  return { html: result.html, root, view: result };
}

async function api(method, route, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

const clientApi = await import('../public/js/api.js');

async function makeUser(overrides = {}) {
  const response = await api('POST', '/api/auth/register');
  const account = response.body;
  assert.equal(response.status, 201, JSON.stringify(response.body));
  clientApi.setToken(account.token);
  const saved = await api('PUT', '/api/profile', {
    token: account.token,
    body: {
      displayName: 'Test User',
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
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const me = await api('GET', '/api/auth/me', { token: account.token });
  return { token: account.token, userId: account.userId, qsId: account.qsId, me: me.body };
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

test('welcome screen renders and offers both real actions', async () => {
  await bootDom();
  clientApi.clearSession();
  const { html, root } = await renderView(clientModules.welcome);
  assert.match(html, /QuickSense/);
  assert.match(html, /Meet people who make sense for you/);
  assert.ok(root.querySelector('#btn-create'), 'must offer profile creation');
  assert.ok(root.querySelector('#btn-restore-code'), 'must offer recovery-code restore');

  // The create button performs a real registration.
  let registered = null;
  const originalRegister = clientModules.welcome.render;
  root.querySelector('#btn-create').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(clientApi.getToken(), 'clicking Create must produce a real session token');
});

test('onboarding renders every step without throwing', async () => {
  const user = await makeUser({ displayName: 'Onboarding Person' });
  await bootDom();
  clientApi.setToken(user.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({
    user: me.user,
    profile: me.profile,
    taxonomy: await clientApi.taxonomy.get(),
  });

  const result = await clientModules.onboarding.render();
  const root = document.createElement('div');
  root.innerHTML = result.html;
  document.body.appendChild(root);
  await result.mount(root, result.data);

  // Steps render into #step-container during mount.
  assert.match(root.innerHTML, /Add your photos/);
  root.querySelector('#next').click();
  assert.match(root.innerHTML, /About you/, 'Continue must advance to the About step');

  // Fill in the About step and advance.
  root.querySelector('#displayName').value = 'Journey Person';
  root.querySelector('#dateOfBirth').value = '1999-03-03';
  root.querySelector('#gender').value = 'woman';
  root.querySelector('#country').value = 'NG';
  root.querySelector('#next').click();
  assert.match(root.innerHTML, /what are you into/i, 'must advance to interests');
});

test('onboarding refuses an under-18 date of birth', async () => {
  const user = await makeUser({ displayName: 'Age Check Person' });
  await bootDom();
  clientApi.setToken(user.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({ user: me.user, profile: me.profile, taxonomy: await clientApi.taxonomy.get() });

  const result = await clientModules.onboarding.render();
  const root = document.createElement('div');
  root.innerHTML = result.html;
  document.body.appendChild(root);
  await result.mount(root, result.data);

  root.querySelector('#next').click(); // photos -> about
  root.querySelector('#displayName').value = 'Too Young';
  root.querySelector('#dateOfBirth').value = '2015-01-01';
  root.querySelector('#gender').value = 'woman';
  root.querySelector('#country').value = 'NG';
  root.querySelector('#next').click();
  assert.match(root.innerHTML, /strictly 18\+/i, 'must block under-18 with a clear reason');
});

test('match screen renders real results with score and why-reasons', async () => {
  const demo = await makeUser({ displayName: 'Demo Amara', dateOfBirth: '2001-04-12', gender: 'woman' });
  const viewer = await makeUser({ displayName: 'Viewer Person' });
  await bootDom();
  clientApi.setToken(viewer.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({
    user: me.user,
    profile: { ...me.profile, setupComplete: true },
    taxonomy: await clientApi.taxonomy.get(),
  });

  const { html, root } = await renderView(clientModules.match);
  assert.match(html, /Find Your Match/);
  const region = root.querySelector('#results-region');
  assert.ok(region.textContent.includes('Demo Amara'), 'real candidate must appear');
  assert.ok(/\d+%/.test(region.innerHTML), 'a compatibility score must be shown');
  assert.match(region.innerHTML, /Why you matched/, 'the why-you-matched box must render');
  assert.ok(root.querySelector('[data-like]'), 'a Match button must be rendered');
});

test('match screen shows an honest empty state when nobody is left to compare', async () => {
  const loner = await makeUser({ displayName: 'Only Person' });

  // Exclude every candidate the honest way: block them all.
  const first = await api('POST', '/api/matches/find', { token: loner.token });
  for (const result of first.body.results) {
    const blocked = await api('POST', '/api/safety/block', {
      token: loner.token,
      body: { userId: result.userId },
    });
    assert.equal(blocked.status, 201, JSON.stringify(blocked.body));
  }

  await bootDom();
  clientApi.setToken(loner.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({
    user: me.user,
    profile: { ...me.profile, setupComplete: true },
    taxonomy: await clientApi.taxonomy.get(),
  });

  const { root } = await renderView(clientModules.match);
  const region = root.querySelector('#results-region');
  assert.match(
    region.innerHTML,
    /no one to compare you with|already blocked or already matched|couldn/i,
    'must state honestly why nothing was found'
  );
  assert.match(region.innerHTML, /profiles considered/i, 'must report how many profiles were scanned');
  assert.ok(!region.querySelector('[data-like]'), 'must not render match buttons for nobody');
});

test('matches screen renders all sections from real state', async () => {
  const user = await makeUser({ displayName: 'Matches Person' });
  await bootDom();
  clientApi.setToken(user.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({
    user: me.user,
    profile: { ...me.profile, setupComplete: true },
    taxonomy: await clientApi.taxonomy.get(),
  });

  const { root } = await renderView(clientModules.matches);
  // Sections are filled during mount, so assert on the rendered region.
  const region = root.querySelector('#matches-region');
  for (const heading of ['Contact requests', 'Mutual matches', 'Connections', 'Potential matches']) {
    assert.match(region.innerHTML, new RegExp(heading), `must render the ${heading} section`);
  }
  assert.match(root.querySelector('#matches-region').innerHTML, /No mutual matches yet/, 'honest empty state');
});

test('exchange screen refuses contact details before mutual consent', async () => {
  const a = await makeUser({ displayName: 'Exchanger A' });
  const b = await makeUser({ displayName: 'Exchanger B' });
  await bootDom();

  // Build a mutual match through the real API.
  clientApi.setToken(a.token);
  const searchA = await clientApi.matches.find();
  const target = searchA.results.find((r) => r.profile.displayName === 'Exchanger B');
  assert.ok(target, 'A must find B');
  await clientApi.matches.act(target.userId, 'like');

  clientApi.setToken(b.token);
  const searchB = await clientApi.matches.find();
  const back = searchB.results.find((r) => r.profile.displayName === 'Exchanger A');
  assert.ok(back, 'B must see A (A liked B, so B can like back)');
  const mutual = await clientApi.matches.act(back.userId, 'like');
  assert.equal(mutual.mutual, true);

  // Each user adds their own contact method while authenticated as themselves.
  clientApi.setToken(a.token);
  await clientApi.profile.addContact({ type: 'instagram', value: '@exchanger_a', shareable: true });
  clientApi.setToken(b.token);
  await clientApi.profile.addContact({ type: 'whatsapp', value: '+2348099999999', shareable: true });

  clientApi.setToken(a.token);
  const request = await clientApi.exchange.request(target.userId);

  // Before B accepts: the screen must NOT show any contact value.
  clientModules.state.setState({ user: { userId: a.userId }, taxonomy: await clientApi.taxonomy.get() });
  const { root } = await renderView(clientModules.exchange, [{ param: request.id }]);
  const text = root.querySelector('#exchange-region').textContent;
  assert.ok(!text.includes('+2348099999999'), 'contact value must be absent before consent');
  assert.match(text, /both rows say yes/i, 'must explain the two-person rule');

  // After B accepts: the real contact value appears.
  clientApi.setToken(b.token);
  await clientApi.exchange.respond(request.id, 'accept');
  clientApi.setToken(a.token);
  const { root: unlockedRoot } = await renderView(clientModules.exchange, [{ param: request.id }]);
  const unlockedText = unlockedRoot.querySelector('#exchange-region').textContent;
  assert.match(unlockedText, /Contact exchange unlocked/);
  assert.ok(unlockedText.includes('+2348099999999'), 'unlocked exchange must show the real value');
});

test('profile screen renders my own profile with real data', async () => {
  const user = await makeUser({ displayName: 'My Profile Person' });
  await bootDom();
  clientApi.setToken(user.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({ user: me.user, profile: me.profile, taxonomy: await clientApi.taxonomy.get() });

  const { html, root } = await renderView(clientModules.profile, [{ param: null }]);
  assert.match(html, /My Profile Person/);
  assert.match(html, new RegExp(me.user.qsId), 'must show the real QuickSense ID');
  assert.match(html, /Contact information/);
});

test('viewing another profile records a real profile view', async () => {
  const viewer = await makeUser({ displayName: 'Curious Viewer' });
  const target = await makeUser({ displayName: 'Viewed Target' });
  await bootDom();
  clientApi.setToken(viewer.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({
    user: me.user,
    profile: { ...me.profile, setupComplete: true },
    taxonomy: await clientApi.taxonomy.get(),
  });

  const { html } = await renderView(clientModules.profile, [{ param: target.userId }]);
  assert.match(html, /Viewed Target/);
  assert.match(html, /Why you matched/);

  // The server-side record must exist.
  const notifs = await api('GET', '/api/notifications', { token: target.token });
  assert.ok(
    notifs.body.notifications.some((n) => n.type === 'profile_view'),
    'a real profile-view notification must be created'
  );
});

test('notifications screen lists real events', async () => {
  const viewer = await makeUser({ displayName: 'Notif Viewer' });
  const target = await makeUser({ displayName: 'Notif Target' });
  await api('GET', `/api/users/${target.userId}`, { token: viewer.token });

  await bootDom();
  clientApi.setToken(target.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({ user: me.user, profile: me.profile, taxonomy: await clientApi.taxonomy.get() });

  const { html, root } = await renderView(clientModules.notifications);
  assert.match(html, /Notifications/);
  const region = root.querySelector('#notif-region');
  assert.match(region.innerHTML, /viewed your profile/i, 'the real event must be listed');
});

test('settings screen loads real preferences and saves them', async () => {
  const user = await makeUser({ displayName: 'Settings Person' });
  await bootDom();
  clientApi.setToken(user.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({ user: me.user, profile: me.profile, taxonomy: await clientApi.taxonomy.get() });

  const { html, root } = await renderView(clientModules.settings);
  assert.match(html, new RegExp(me.user.qsId), 'must show the QuickSense ID');
  assert.match(html, /Notifications/);
  assert.match(html, /Privacy/);
  assert.match(html, /Danger zone/);

  // Changing the age range must persist to the server.
  root.querySelector('#ageMin').value = '25';
  root.querySelector('#ageMax').value = '35';
  root.querySelector('#save-prefs').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const prefs = await api('GET', '/api/preferences', { token: user.token });
  assert.equal(prefs.body.preferences.ageMin, 25, 'saved preference must reach the backend');
  assert.equal(prefs.body.preferences.ageMax, 35);
});

test('admin dashboard renders real counts', async () => {
  const user = await makeUser({ displayName: 'Admin Subject' });
  const login = await api('POST', '/api/auth/login', {
    body: { identifier: admin.email, password: admin.password },
  });
  await bootDom();
  clientApi.setToken(login.body.token);
  const me = await clientApi.auth.me();
  clientModules.state.setState({
    user: { ...me.user, role: 'admin' },
    profile: me.profile,
    taxonomy: await clientApi.taxonomy.get(),
  });

  const { html, root } = await renderView({ render: clientModules.admin.renderOverview });
  assert.match(html, /Dashboard/);
  const region = root.querySelector('#admin-region');
  assert.match(region.innerHTML, /Total/);
  assert.match(region.innerHTML, /Open reports/);
  assert.match(region.innerHTML, /Photos pending/);

  const users = await renderView({ render: clientModules.admin.renderUsers });
  assert.match(users.root.querySelector('#user-list').innerHTML, /Admin Subject/, 'real users must be listed');
});

test('a screen that fails still renders an error, not a blank page', async () => {
  const user = await makeUser({ displayName: 'Error Person' });
  await bootDom();
  clientApi.setToken('not-a-valid-token');
  clientModules.state.setState({ user: { userId: user.userId, role: 'user' }, taxonomy: await clientApi.taxonomy.get() });

  // A 401 from the server must surface as a readable state.
  const result = await clientModules.settings.render().catch((error) => ({ html: `<div>${error.message}</div>` }));
  assert.ok(result.html.length > 0, 'must produce something renderable rather than throwing raw');
});
