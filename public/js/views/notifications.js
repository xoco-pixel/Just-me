/** Notifications. Everything listed here was created by a real server event. */
import { notifications as notificationsApi } from '../api.js';
import { getState, setState } from '../state.js';
import { escapeHtml, toast, emptyState, relativeTime, setBusy } from '../ui.js';
import { refresh } from '../app.js';

const ICONS = {
  new_match: '❤️',
  mutual_match: '💜',
  profile_view: '👀',
  contact_request: '🔐',
  exchange_unlocked: '🎉',
  exchange_declined: '🚫',
  safety: '⚠️',
  account: '🔔',
};

const TIME_FORMAT = { hour: '2-digit', minute: '2-digit' };

function items(list, unreadOnly) {
  if (!list.length) {
    return emptyState(
      '🔔',
      unreadOnly ? 'Nothing unread' : 'No notifications yet',
      unreadOnly
        ? 'You’re all caught up.'
        : 'Notifications appear here when someone matches with you, views your profile, or responds to a contact exchange.'
    );
  }
  return `
    <div class="stack-sm">
      ${list
        .map(
          (n) => `
          <div class="notif-item ${n.read ? '' : 'is-unread'}" data-id="${escapeHtml(n.id)}"
               data-ref-type="${escapeHtml(n.refType || '')}" data-ref-id="${escapeHtml(n.refId || '')}">
            <span class="notif-icon" aria-hidden="true">${ICONS[n.type] || '🔔'}</span>
            <div class="grow">
              <strong class="small">${escapeHtml(n.title)}</strong>
              ${n.body ? `<p class="small muted mt-0 mb-0">${escapeHtml(n.body)}</p>` : ''}
              <p class="tiny muted mt-0 mb-0">${escapeHtml(relativeTime(n.createdAt))}</p>
            </div>
            ${n.read ? '' : '<span class="badge badge-pending">New</span>'}
          </div>`
        )
        .join('')}
    </div>
  `;
}

export async function render() {
  const html = `
    <div class="screen">
      <header class="app-header">
        <div>
          <h1>Notifications</h1>
          <p class="header-sub">Only real activity, never filler</p>
        </div>
        <button class="icon-btn" id="read-all" aria-label="Mark all read" title="Mark all as read">✓</button>
      </header>

      <div class="container stack">
        <div class="row" style="gap:.5rem">
          <button class="btn btn-secondary btn-sm is-active-filter" id="filter-all">All</button>
          <button class="btn btn-ghost btn-sm" id="filter-unread">Unread</button>
          <div class="grow"></div>
          <a class="btn btn-ghost btn-sm" href="#/settings">Preferences</a>
        </div>
        <div id="notif-region">
          <div class="empty"><div class="empty-icon">🔔</div><p>Loading…</p></div>
        </div>
      </div>
    </div>
  `;

  return {
    html,
    async mount(root) {
      const region = root.querySelector('#notif-region');
      const allBtn = root.querySelector('#filter-all');
      const unreadBtn = root.querySelector('#filter-unread');
      let unreadOnly = false;

      async function load() {
        region.innerHTML = `<div class="empty"><div class="empty-icon">🔔</div><p>Loading…</p></div>`;
        try {
          const data = await notificationsApi.list({ unreadOnly });
          setState({ unread: data.unread });
          region.innerHTML = items(data.notifications, unreadOnly);

          region.querySelectorAll('.notif-item').forEach((node) =>
            node.addEventListener('click', async () => {
              if (node.classList.contains('is-unread')) {
                try {
                  await notificationsApi.read(node.dataset.id);
                  node.classList.remove('is-unread');
                  const badge = node.querySelector('.badge');
                  if (badge) badge.remove();
                } catch {
                  /* the read state is cosmetic; the server keeps the truth */
                }
              }
              const refType = node.dataset.refType;
              const refId = node.dataset.refId;
              if (refType === 'user' && refId) window.location.hash = `#/user/${refId}`;
              else if (refType === 'exchange' && refId) window.location.hash = `#/exchange/${refId}`;
              else if (refType === 'match') window.location.hash = '#/matches';
            })
          );
        } catch (error) {
          region.innerHTML = `<div class="banner banner--danger">${escapeHtml(error.message)}</div>`;
        }
      }

      allBtn.addEventListener('click', () => {
        unreadOnly = false;
        allBtn.className = 'btn btn-secondary btn-sm';
        unreadBtn.className = 'btn btn-ghost btn-sm';
        load();
      });
      unreadBtn.addEventListener('click', () => {
        unreadOnly = true;
        unreadBtn.className = 'btn btn-secondary btn-sm';
        allBtn.className = 'btn btn-ghost btn-sm';
        load();
      });

      root.querySelector('#read-all').addEventListener('click', async (event) => {
        setBusy(event.currentTarget, true, '…');
        try {
          await notificationsApi.readAll();
          toast('All notifications marked as read.', 'success', 2500);
          load();
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          setBusy(event.currentTarget, false);
          event.currentTarget.textContent = '✓';
        }
      });

      await load();
    },
  };
}
