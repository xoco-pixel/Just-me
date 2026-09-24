/**
 * My Matches: potential, mutual, contact requests and unlocked connections.
 * Every section is rendered from real backend state.
 */
import { matches as matchesApi, exchange as exchangeApi } from '../api.js';
import { escapeHtml, toast, emptyState, avatar, relativeTime, setBusy, modal } from '../ui.js';
import { go, refresh } from '../app.js';

function potentialItem(item) {
  const profile = item.profile || {};
  return `
    <a class="list-item" href="#/user/${escapeHtml(item.userId)}">
      ${avatar(profile)}
      <div class="grow">
        <div class="row-between">
          <strong>${escapeHtml(profile.displayName || 'Unnamed')}</strong>
          <span class="badge badge-muted">${item.score}%</span>
        </div>
        <p class="small muted mt-0 mb-0">${escapeHtml(
          [profile.age, profile.countryName].filter(Boolean).join(' · ') || '—'
        )}</p>
        ${item.theyLikedYou ? '<p class="tiny mt-0 mb-0" style="color:var(--coral-soft)">Interested in you</p>' : ''}
      </div>
      <span aria-hidden="true">›</span>
    </a>
  `;
}

function mutualItem(item) {
  const profile = item.profile || {};
  return `
    <div class="list-item" data-user="${escapeHtml(item.userId)}">
      ${avatar(profile)}
      <div class="grow">
        <div class="row-between">
          <strong>${escapeHtml(profile.displayName || 'Unnamed')}</strong>
          <span class="badge badge-unlocked">${item.score}%</span>
        </div>
        <p class="small muted mt-0 mb-0">Matched ${relativeTime(item.matchedAt)}</p>
      </div>
      <button class="btn btn-primary btn-sm" data-exchange="${escapeHtml(item.userId)}">Exchange 🔐</button>
    </div>
  `;
}

function requestItem(item, incoming) {
  return `
    <div class="card" data-exchange-id="${escapeHtml(item.id)}">
      <div class="row mb-1">
        ${avatar({ displayName: item.otherName, photos: item.otherPhoto ? [{ url: item.otherPhoto }] : [] })}
        <div class="grow">
          <strong>${escapeHtml(item.otherName)}</strong>
          <p class="small muted mt-0 mb-0">
            ${incoming ? 'Wants to exchange contact information' : 'Waiting for their response'}
          </p>
        </div>
      </div>
      <div class="row-between">
        <span class="badge badge-pending">${escapeHtml(item.status)}</span>
        ${
          incoming
            ? `<div class="row">
                 <button class="btn btn-success btn-sm" data-accept="${escapeHtml(item.id)}">Accept</button>
                 <button class="btn btn-ghost btn-sm" data-decline="${escapeHtml(item.id)}">Decline</button>
               </div>`
            : ''
        }
      </div>
    </div>
  `;
}

function connectionItem(item) {
  return `
    <a class="list-item" href="#/exchange/${escapeHtml(item.id)}">
      ${avatar({ displayName: item.otherName, photos: item.otherPhoto ? [{ url: item.otherPhoto }] : [] })}
      <div class="grow">
        <div class="row-between">
          <strong>${escapeHtml(item.otherName)}</strong>
          <span class="badge badge-unlocked">🔓 Unlocked</span>
        </div>
        <p class="small muted mt-0 mb-0">Both of you agreed to share contact details</p>
      </div>
      <span aria-hidden="true">›</span>
    </a>
  `;
}

export async function render() {
  const html = `
    <div class="screen">
      <header class="app-header">
        <div>
          <h1>My Matches</h1>
          <p class="header-sub">Real connections, real consent</p>
        </div>
        <button class="icon-btn" id="refresh" aria-label="Refresh">⟳</button>
      </header>
      <div class="container stack" id="matches-region">
        <div class="empty"><div class="empty-icon">🤝</div><p>Loading…</p></div>
      </div>
    </div>
  `;

  return {
    html,
    async mount(root) {
      const region = root.querySelector('#matches-region');

      async function load() {
        region.innerHTML = `<div class="empty"><div class="empty-icon">🤝</div><p>Loading…</p></div>`;
        try {
          const data = await matchesApi.all();
          const sections = [];

          sections.push(`
            <div>
              <h3 class="section-title">Contact requests <span class="muted tiny">(${data.contactRequests.length})</span></h3>
              ${
                data.contactRequests.length
                  ? `<div class="stack-sm">${data.contactRequests.map((r) => requestItem(r, true)).join('')}</div>`
                  : `<div class="card small muted center">No pending requests. Contact exchange opens after a mutual match.</div>`
              }
            </div>
          `);

          sections.push(`
            <div>
              <h3 class="section-title">Mutual matches <span class="muted tiny">(${data.mutual.length})</span></h3>
              ${
                data.mutual.length
                  ? `<div class="stack-sm">${data.mutual.map(mutualItem).join('')}</div>`
                  : emptyState(
                      '💜',
                      'No mutual matches yet',
                      'When you and someone else both choose each other, they appear here and you can request a contact exchange.'
                    )
              }
            </div>
          `);

          sections.push(`
            <div>
              <h3 class="section-title">Connections <span class="muted tiny">(${data.connections.length})</span></h3>
              ${
                data.connections.length
                  ? `<div class="stack-sm">${data.connections.map(connectionItem).join('')}</div>`
                  : `<div class="card small muted center">Unlocked contact exchanges appear here.</div>`
              }
            </div>
          `);

          if (data.outgoingRequests.length) {
            sections.push(`
              <div>
                <h3 class="section-title">Waiting on them</h3>
                <div class="stack-sm">${data.outgoingRequests.map((r) => requestItem(r, false)).join('')}</div>
              </div>
            `);
          }

          sections.push(`
            <div>
              <h3 class="section-title">Potential matches <span class="muted tiny">(${data.potential.length})</span></h3>
              ${
                data.potential.length
                  ? `<div class="stack-sm">${data.potential.map(potentialItem).join('')}</div>`
                  : emptyState('🔍', 'No potential matches yet', 'Run a search from the Match tab to find compatible people.')
              }
            </div>
          `);

          region.innerHTML = sections.join('');
          wireActions();
        } catch (error) {
          region.innerHTML = `<div class="banner banner--danger">${escapeHtml(error.message)}</div>`;
        }
      }

      function wireActions() {
        region.querySelectorAll('[data-exchange]').forEach((button) =>
          button.addEventListener('click', async (event) => {
            const userId = event.currentTarget.dataset.exchange;
            setBusy(button, true, 'Sending…');
            try {
              await exchangeApi.request(userId);
              toast('Request sent. Nothing is shared until they also accept.', 'success', 6000);
              await load();
            } catch (error) {
              toast(error.message, 'error', 7000);
            } finally {
              setBusy(button, false);
            }
          })
        );

        const respond = async (id, action, button) => {
          setBusy(button, true, action === 'accept' ? 'Accepting…' : 'Declining…');
          try {
            const result = await exchangeApi.respond(id, action);
            if (result.status === 'unlocked') {
              toast('🔓 Contact exchange unlocked — you both agreed.', 'success', 7000);
            } else {
              toast('Declined. No contact information was shared.', 'info');
            }
            await load();
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            setBusy(button, false);
          }
        };

        region.querySelectorAll('[data-accept]').forEach((button) =>
          button.addEventListener('click', (event) => respond(event.currentTarget.dataset.accept, 'accept', button))
        );
        region.querySelectorAll('[data-decline]').forEach((button) =>
          button.addEventListener('click', (event) => respond(event.currentTarget.dataset.decline, 'decline', button))
        );
      }

      root.querySelector('#refresh').addEventListener('click', load);
      await load();
    },
  };
}
