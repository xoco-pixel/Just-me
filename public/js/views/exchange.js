/**
 * Contact exchange detail.
 *
 * The unlock screen asks the server for details and renders whatever it returns.
 * If consent is not mutual, the server refuses and this screen shows the refusal
 * instead of fabricating contact information.
 */
import { exchange as exchangeApi, safety } from '../api.js';
import { escapeHtml, toast, emptyState, avatar, setBusy, confirmDialog } from '../ui.js';
import { go, refresh } from '../app.js';

const TYPE_ICONS = {
  phone: '📞',
  email: '✉️',
  instagram: '📷',
  x: '🐦',
  snapchat: '👻',
  whatsapp: '💬',
  telegram: '✈️',
  other: '🔗',
};

export async function render({ param }) {
  const exchangeId = param;

  const html = `
    <div class="screen">
      <header class="app-header">
        <button class="icon-btn" onclick="history.back()" aria-label="Back">‹</button>
        <div class="grow center"><h1 style="font-size:1.05rem">Contact Exchange</h1></div>
        <span style="width:40px"></span>
      </header>
      <div class="container stack" id="exchange-region">
        <div class="empty"><div class="empty-icon">🔐</div><p>Loading…</p></div>
      </div>
    </div>
  `;

  return {
    html,
    async mount(root) {
      const region = root.querySelector('#exchange-region');

      async function load() {
        try {
          const exchange = await exchangeApi.get(exchangeId);

          let details = null;
          let refusal = null;
          try {
            details = await exchangeApi.details(exchangeId);
          } catch (error) {
            refusal = error.message;
          }

          if (details) {
            region.innerHTML = `
              <div class="unlock-hero">
                <div class="unlock-icon" aria-hidden="true">🔓</div>
                <h2 class="mt-1 mb-0">Contact exchange unlocked</h2>
                <p class="small muted mt-0 mb-0">
                  You and ${escapeHtml(details.otherName)} both agreed to share contact details.
                </p>
              </div>

              <div class="card">
                <p class="label mb-1">${escapeHtml(details.otherName)}'s shared contact details</p>
                ${
                  details.contactMethods.length
                    ? `<div class="stack-sm">
                         ${details.contactMethods
                           .map(
                             (m) => `
                             <div class="contact-value">
                               <span class="grow">
                                 <span class="tiny muted" style="display:block">
                                   <span aria-hidden="true">${TYPE_ICONS[m.type] || '🔗'}</span>
                                   ${escapeHtml(m.label || m.type)}
                                 </span>
                                 <strong>${escapeHtml(m.value)}</strong>
                               </span>
                               <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(m.value)}">Copy</button>
                             </div>`
                           )
                           .join('')}
                       </div>`
                    : `<p class="small muted mb-0">
                         They agreed to the exchange but have no shareable contact method saved yet.
                       </p>`
                }
              </div>

              <p class="tiny muted center">
                Be careful. Report anyone who asks for money or behaves inappropriately.
              </p>
              <button class="btn btn-ghost btn-sm" id="report">Report this person</button>
            `;

            region.querySelectorAll('[data-copy]').forEach((button) =>
              button.addEventListener('click', async () => {
                const value = button.dataset.copy;
                try {
                  await navigator.clipboard.writeText(value);
                  toast('Copied to clipboard.', 'success', 2000);
                } catch {
                  toast('Could not copy. Please select the text manually.', 'warn');
                }
              })
            );

            region.querySelector('#report')?.addEventListener('click', async () => {
              const { reportDialog } = await import('./profile.js');
              reportDialog(details.otherUserId);
            });
            return;
          }

          // Not unlocked: show the real status and, if it's my turn, the decision.
          const incoming = exchange.direction === 'incoming' && exchange.status === 'pending';
          region.innerHTML = `
            <div class="card center">
              <div class="unlock-icon" aria-hidden="true" style="font-size:2.4rem">🔐</div>
              <h3 class="mt-1 mb-0">${
                exchange.status === 'declined'
                  ? 'Exchange declined'
                  : exchange.status === 'cancelled'
                    ? 'Exchange cancelled'
                    : incoming
                      ? 'They want to exchange contacts'
                      : 'Waiting on them'
              }</h3>
              <p class="small muted">${escapeHtml(refusal || '')}</p>
            </div>

            <div class="card">
              <div class="row">
                ${avatar({ displayName: exchange.otherName, photos: exchange.otherPhoto ? [{ url: exchange.otherPhoto }] : [] })}
                <div class="grow">
                  <strong>${escapeHtml(exchange.otherName)}</strong>
                  <p class="tiny muted mt-0 mb-0">
                    Requested ${escapeHtml(exchange.createdAt?.slice(0, 10) || '')}
                  </p>
                </div>
              </div>
              <hr class="divider" />
              <div class="component-bars">
                <div class="component-row">
                  <span>Your consent</span>
                  <span class="bar"><span style="width:${
                    exchange.direction === 'outgoing' ? '100' : exchange.recipientStatus === 'accepted' ? '100' : '0'
                  }%"></span></span>
                  <span>${
                    exchange.direction === 'outgoing' || exchange.recipientStatus === 'accepted' ? 'Yes' : 'No'
                  }</span>
                </div>
                <div class="component-row">
                  <span>Their consent</span>
                  <span class="bar"><span style="width:${
                    exchange.direction === 'incoming' && exchange.status === 'pending' ? '0' : '100'
                  }%"></span></span>
                  <span>${
                    exchange.direction === 'incoming' && exchange.status === 'pending' ? 'Pending' : 'Yes'
                  }</span>
                </div>
              </div>
              <p class="tiny muted mt-1 mb-0">
                Contact details appear only when both rows say yes. That rule is enforced on the server,
                not just in this screen.
              </p>
            </div>

            ${
              incoming
                ? `<div class="row">
                     <button class="btn btn-success grow" id="accept">Accept</button>
                     <button class="btn btn-ghost grow" id="decline">Decline</button>
                   </div>`
                : ''
            }
          `;

          const respond = async (action, button) => {
            setBusy(button, true, action === 'accept' ? 'Accepting…' : 'Declining…');
            try {
              const result = await exchangeApi.respond(exchangeId, action);
              if (result.status === 'unlocked') toast('🔓 Contact exchange unlocked.', 'success', 6000);
              else toast('Declined. Nothing was shared.', 'info');
              load();
            } catch (error) {
              toast(error.message, 'error');
            } finally {
              setBusy(button, false);
            }
          };

          region.querySelector('#accept')?.addEventListener('click', (event) =>
            respond('accept', event.currentTarget)
          );
          region.querySelector('#decline')?.addEventListener('click', (event) =>
            respond('decline', event.currentTarget)
          );
        } catch (error) {
          region.innerHTML = `<div class="banner banner--danger">${escapeHtml(error.message)}</div>`;
        }
      }

      await load();
    },
  };
}
