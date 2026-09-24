/**
 * QuickSense app shell: hash router, tab bar, boot sequence.
 *
 * Routes are declared with the guards they need (auth, complete profile, admin)
 * so a screen is never rendered with data it does not have.
 */
import { auth, system } from './api.js';
import { getState, setState, resetState, ensureTaxonomy } from './state.js';
import { el, escapeHtml, toast } from './ui.js';
import * as welcome from './views/welcome.js';
import * as onboarding from './views/onboarding.js';
import * as match from './views/match.js';
import * as matches from './views/matches.js';
import * as profileView from './views/profile.js';
import * as notifications from './views/notifications.js';
import * as exchangeView from './views/exchange.js';
import * as settings from './views/settings.js';
import * as admin from './views/admin.js';

const routes = new Map();
let currentRoute = null;
let unmountCurrent = null;

function register(name, definition) {
  routes.set(name, definition);
}

/* ------------------------------------------------------------ tab bar ---- */

const TABS = [
  { route: 'match', label: 'Match', icon: '💜' },
  { route: 'matches', label: 'Matches', icon: '🤝' },
  { route: 'notifications', label: 'Alerts', icon: '🔔' },
  { route: 'profile', label: 'Profile', icon: '👤' },
];

function renderTabBar(activeRoute) {
  const state = getState();
  const showTabs = state.user && state.profile?.setupComplete && !state.user.isAdminSession;
  if (!showTabs) return '';

  const tabs = state.user.role === 'admin' && activeRoute.startsWith('admin')
    ? [
        { route: 'admin', label: 'Overview', icon: '📊' },
        { route: 'admin/users', label: 'Users', icon: '👥' },
        { route: 'admin/reports', label: 'Reports', icon: '🚩' },
        { route: 'admin/photos', label: 'Photos', icon: '🖼️' },
      ]
    : TABS;

  return `
    <nav class="tabbar" role="tablist" aria-label="Main">
      ${tabs
        .map((tab) => {
          const active = activeRoute === tab.route;
          const badge =
            tab.route === 'notifications' && state.unread > 0
              ? `<span class="tab-badge">${state.unread > 9 ? '9+' : state.unread}</span>`
              : '';
          return `
            <a class="tab ${active ? 'is-active' : ''}" href="#/${tab.route}" role="tab" aria-selected="${active}">
              <span class="tab-icon" aria-hidden="true">${tab.icon}</span>
              <span>${escapeHtml(tab.label)}</span>
              ${badge}
            </a>`;
        })
        .join('')}
    </nav>
  `;
}

/* ------------------------------------------------------------ router ----- */

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: name || 'welcome', param: rest.join('/') };
}

async function navigate() {
  const { name, param } = parseHash();
  const definition = routes.get(name) || routes.get('welcome');
  const state = getState();

  if (unmountCurrent) {
    unmountCurrent();
    unmountCurrent = null;
  }

  // Guards: never render a screen without the data it needs.
  if (definition.requiresAuth && !state.user) {
    window.location.hash = '#/welcome';
    return;
  }
  if (definition.requiresSetup && state.user && !state.profile?.setupComplete) {
    window.location.hash = '#/setup';
    return;
  }
  if (definition.requiresAdmin && state.user?.role !== 'admin') {
    toast('Administrator access is required.', 'error');
    window.location.hash = '#/match';
    return;
  }
  if (name === 'welcome' && state.user) {
    window.location.hash = state.profile?.setupComplete ? '#/match' : '#/setup';
    return;
  }

  currentRoute = name;
  const app = document.getElementById('app');
  app.innerHTML = '<div class="boot-screen"><div class="boot-logo">💜</div></div>';

  try {
    const result = await definition.render({ param, state });
    app.innerHTML = result.html + renderTabBar(name);
    if (result.mount) unmountCurrent = result.mount(app, result.data) || null;
    window.scrollTo({ top: 0 });
  } catch (error) {
    console.error('[quicksense] screen failed to render', error);
    app.innerHTML = `
      <div class="container">
        <div class="empty">
          <div class="empty-icon">⚠️</div>
          <h3>This screen could not load</h3>
          <p>${escapeHtml(error?.message || 'Unexpected error.')}</p>
          <a class="btn btn-secondary btn-sm" href="#/match">Back to Match</a>
        </div>
      </div>
    `;
  }
}

export function go(route) {
  window.location.hash = `#/${route}`;
}

export function refresh() {
  navigate();
}

export async function refreshNotifications() {
  const state = getState();
  if (!state.user) return;
  try {
    const data = await (await import('./api.js')).notifications.list({ limit: 1 });
    setState({ unread: data.unread });
    const badge = document.querySelector('.tab-badge');
    if (badge && currentRoute === 'notifications') return;
    navigate();
  } catch {
    /* silent: the badge is decoration, not data */
  }
}

/* ----------------------------------------------------------- registers --- */

register('welcome', { render: () => welcome.render() });
register('setup', { requiresAuth: true, render: () => onboarding.render() });
register('match', { requiresAuth: true, requiresSetup: true, render: () => match.render() });
register('matches', { requiresAuth: true, requiresSetup: true, render: () => matches.render() });
register('profile', { requiresAuth: true, render: () => profileView.render({ param: null }) });
register('user', { requiresAuth: true, requiresSetup: true, render: ({ param }) => profileView.render({ param }) });
register('notifications', { requiresAuth: true, render: () => notifications.render() });
register('exchange', { requiresAuth: true, render: ({ param }) => exchangeView.render({ param }) });
register('settings', { requiresAuth: true, render: () => settings.render() });
register('admin', { requiresAuth: true, requiresAdmin: true, render: () => admin.renderOverview() });
register('admin/users', { requiresAuth: true, requiresAdmin: true, render: () => admin.renderUsers() });
register('admin/reports', { requiresAuth: true, requiresAdmin: true, render: () => admin.renderReports() });
register('admin/photos', { requiresAuth: true, requiresAdmin: true, render: () => admin.renderPhotos() });

/* ---------------------------------------------------------------- boot --- */

async function boot() {
  try {
    setState({ capabilities: await system.capabilities() });
  } catch {
    /* the app still works without this metadata */
  }

  const token = (await import('./api.js')).getToken?.();
  const hasToken = Boolean(localStorage.getItem('quicksense.token'));

  if (hasToken) {
    try {
      const me = await auth.me();
      setState({
        user: me.user,
        profile: me.profile,
        preferences: me.preferences,
        settings: me.settings,
        unread: me.notifications?.unread ?? 0,
        setupComplete: me.setupComplete,
      });
      if (me.profile) setState({ profile: { ...me.profile, setupComplete: me.setupComplete } });
      await ensureTaxonomy();
    } catch (error) {
      // A rejected session is a real event: clear it rather than pretend.
      console.warn('[quicksense] session invalid', error?.message);
      localStorage.removeItem('quicksense.token');
      resetState();
    }
  }

  setState({ booted: true });
  window.addEventListener('hashchange', navigate);
  await navigate();

  // Keep the unread badge fresh while the app is open.
  setInterval(async () => {
    const state = getState();
    if (!state.user) return;
    try {
      const { notifications: notificationsApi } = await import('./api.js');
      const data = await notificationsApi.list({ limit: 1 });
      if (data.unread !== state.unread) {
        setState({ unread: data.unread });
        navigate();
      }
    } catch {
      /* ignore transient failures */
    }
  }, 45_000);
}

boot();
