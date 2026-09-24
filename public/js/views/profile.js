/**
 * Profile: my own profile management, and viewing someone else's public profile.
 * Viewing another profile records a real profile view server-side.
 */
import { profile as profileApi, safety, exchange as exchangeApi, matches as matchesApi } from '../api.js';
import { getState, setState, labelFor } from '../state.js';
import {
  escapeHtml,
  toast,
  modal,
  setBusy,
  avatar,
  emptyState,
  relativeTime,
  confirmDialog,
} from '../ui.js';
import { go, refresh } from '../app.js';
import { setToken, clearSession } from '../api.js';
import { auth } from '../api.js';

const CONTACT_TYPES = {
  phone: '📞',
  email: '✉️',
  instagram: '📷',
  x: '🐦',
  snapchat: '👻',
  whatsapp: '💬',
  telegram: '✈️',
  other: '🔗',
};

/* ------------------------------------------------------------- own view --- */

function myProfileView(state, tax, contacts) {
  const p = state.profile || {};
  const photos = p.photos || [];

  return `
    <div class="screen">
      <header class="app-header">
        <div>
          <h1>My Profile</h1>
          <p class="header-sub">${escapeHtml(state.user?.qsId || '')}</p>
        </div>
        <a class="icon-btn" href="#/settings" aria-label="Settings">⚙️</a>
      </header>

      <div class="container stack">
        <div class="card center">
          ${avatar(p, { size: 'lg' })}
          <h2 class="mt-1 mb-0">${escapeHtml(p.displayName || 'Unnamed')}</h2>
          <p class="small muted mt-0">
            ${escapeHtml([p.age, p.city, p.countryName].filter(Boolean).join(' · ') || 'Add your location')}
          </p>
          <span class="badge ${p.setupComplete ? 'badge-unlocked' : 'badge-pending'}">
            ${p.setupComplete ? 'Profile complete' : 'Profile incomplete'}
          </span>
        </div>

        <div class="card">
          <div class="row-between mb-1">
            <strong>Photos</strong>
            <span class="tiny muted">${photos.length}/6</span>
          </div>
          <div class="photo-grid">
            ${
              photos.length
                ? photos
                    .map(
                      (photo, index) => `
                    <div class="photo-tile ${index === 0 ? 'is-primary' : ''}">
                      <img src="${photo.url}" alt="Photo ${index + 1}" />
                      <button class="photo-remove" data-remove-photo="${photo.id}" aria-label="Remove photo">✕</button>
                      ${index === 0 ? '<span class="photo-badge">Main</span>' : ''}
                    </div>`
                    )
                    .join('')
                : ''
            }
            ${photos.length < 6 ? `<button class="photo-tile" id="add-photo" type="button">＋</button>` : ''}
          </div>
          <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" class="sr-only" />
          <p class="field-hint mt-1" id="photo-status"></p>
        </div>

        <div class="card stack-sm">
          <div class="row-between">
            <strong>About</strong>
            <button class="btn btn-ghost btn-sm" id="edit-about">Edit</button>
          </div>
          <p class="small muted mt-0 mb-0">${escapeHtml(p.bio || 'No bio yet. Add a few honest sentences.')}</p>
          ${
            (p.interests || []).length
              ? `<div class="tag-row mt-1">${p.interests
                  .map((i) => `<span class="tag">${escapeHtml(labelFor('interests', i))}</span>`)
                  .join('')}</div>`
              : ''
          }
          ${
            (p.intentions || []).length
              ? `<p class="tiny muted mt-1 mb-0">Looking for: ${p.intentions
                  .map((i) => escapeHtml(labelFor('intentions', i)))
                  .join(', ')}</p>`
              : ''
          }
        </div>

        <div class="card">
          <div class="row-between mb-1">
            <strong>Contact information</strong>
            <button class="btn btn-ghost btn-sm" id="add-contact">Add</button>
          </div>
          <p class="tiny muted mt-0 mb-1">
            Only what you mark as shareable can be revealed — and only after you
            <strong>both</strong> accept an exchange.
          </p>
          ${
            contacts.length
              ? `<div class="stack-sm">${contacts
                  .map(
                    (c) => `
                    <div class="row-between" style="padding:.55rem 0;border-bottom:1px solid var(--line-soft)">
                      <div class="grow">
                        <div class="small"><span aria-hidden="true">${CONTACT_TYPES[c.type] || '🔗'}</span> ${escapeHtml(c.label || c.type)}</div>
                        <div class="tiny muted">${escapeHtml(c.value)}</div>
                      </div>
                      <span class="badge ${c.shareable ? 'badge-unlocked' : 'badge-muted'}">
                        ${c.shareable ? 'Shareable' : 'Private'}
                      </span>
                      <button class="btn btn-ghost btn-sm" data-remove-contact="${c.id}">Remove</button>
                    </div>`
                  )
                  .join('')}</div>`
              : `<p class="small muted mb-0">No contact methods yet. Add one to enable contact exchange.</p>`
          }
        </div>

        <div class="stack-sm">
          <a class="btn btn-secondary" href="#/settings">Settings & preferences</a>
          <button class="btn btn-ghost" id="sign-out">Sign out</button>
        </div>
      </div>
    </div>
  `;
}

/* ----------------------------------------------------------- other view --- */

function otherProfileView(data, isSelf) {
  const p = data.profile;
  const photos = p.photos || [];
  const compat = data.compatibility;
  const state = getState();

  return `
    <div class="screen">
      <header class="app-header">
        <button class="icon-btn" onclick="history.back()" aria-label="Back">‹</button>
        <div class="grow center">
          <h1 style="font-size:1.05rem">${escapeHtml(p.displayName)}</h1>
        </div>
        <button class="icon-btn" id="more-actions" aria-label="More actions">⋯</button>
      </header>

      <div class="container stack">
        <div class="match-photo" style="border-radius:var(--radius-lg);overflow:hidden">
          ${
            photos.length
              ? `<img src="${photos[0].url}" alt="${escapeHtml(p.displayName)}" />`
              : `<div class="no-photo">${escapeHtml((p.displayName || '?')[0])}</div>`
          }
          ${
            compat?.eligible
              ? `<div class="score-pill"><span aria-hidden="true">❤️</span> ${compat.score}%</div>`
              : ''
          }
          ${p.isDemo ? '<span class="badge badge-demo" style="position:absolute;top:.85rem;left:.85rem">Demo data</span>' : ''}
        </div>

        ${
          photos.length > 1
            ? `<div class="photo-grid">${photos
                .slice(1)
                .map((photo) => `<div class="photo-tile"><img src="${photo.url}" alt="" /></div>`)
                .join('')}</div>`
            : ''
        }

        <div>
          <h2 class="mt-0">${escapeHtml(p.displayName)} ${p.age ? `<span class="muted">· ${p.age}</span>` : ''}</h2>
          <p class="small muted mt-0">
            ${escapeHtml([p.city, p.countryName].filter(Boolean).join(', ') || 'Location private')}
          </p>
        </div>

        ${
          compat?.eligible
            ? `<div class="why-box">
                 <h4>Why you matched</h4>
                 <ul class="reason-list">
                   ${
                     compat.reasons?.length
                       ? compat.reasons
                           .map(
                             (r) => `<li class="reason ${r.negative ? 'reason--negative' : ''}">
                               <span class="reason-icon" aria-hidden="true">${r.icon || '•'}</span>
                               <span>${escapeHtml(r.text)}</span>
                             </li>`
                           )
                           .join('')
                       : '<li class="reason"><span>Compatible on the basics.</span></li>'
                   }
                 </ul>
               </div>`
            : `<div class="banner">${escapeHtml(
                compat?.message || 'Compatibility will be calculated once both profiles are complete.'
              )}</div>`
        }

        ${
          p.bio
            ? `<div class="card"><p class="small mt-0 mb-0">"${escapeHtml(p.bio)}"</p></div>`
            : ''
        }

        ${
          (p.interests || []).length
            ? `<div class="card">
                 <p class="label mb-1">Interests</p>
                 <div class="tag-row">${p.interests
                   .map((i) => `<span class="tag">${escapeHtml(labelFor('interests', i))}</span>`)
                   .join('')}</div>
               </div>`
            : ''
        }

        ${
          (p.intentions || []).length
            ? `<div class="card">
                 <p class="label mb-1">Looking for</p>
                 <div class="tag-row">${p.intentions
                   .map((i) => `<span class="tag">${escapeHtml(labelFor('intentions', i))}</span>`)
                   .join('')}</div>
               </div>`
            : ''
        }

        <div class="stack-sm">
          ${
            data.match?.status === 'mutual'
              ? `<button class="btn btn-primary" id="btn-exchange">Exchange Contact 🔐</button>`
              : data.iLikedThem
                ? `<div class="banner banner--info center">You've shown interest. Waiting for them to choose you too.</div>`
                : compat?.eligible
                  ? `<button class="btn btn-primary" id="btn-like">Match ❤️</button>`
                  : `<div class="banner center">You can't match with this person based on your current preferences.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------- render ----- */

export async function render({ param }) {
  const state = getState();
  const tax = state.taxonomy;

  // Another person's profile.
  if (param) {
    let data;
    try {
      data = await profileApi.view(param);
    } catch (error) {
      return {
        html: `<div class="container">${emptyState(
          '🔒',
          'Profile unavailable',
          error.message,
          '<a class="btn btn-secondary btn-sm" href="#/matches">Back to matches</a>'
        )}</div>`,
      };
    }

    return {
      html: otherProfileView(data, false),
      mount(root) {
        const likeBtn = root.querySelector('#btn-like');
        likeBtn?.addEventListener('click', async (event) => {
          setBusy(likeBtn, true, 'Matching…');
          try {
            const result = await matchesApi.act(param, 'like');
            toast(
              result.mutual
                ? 'It’s a match! You can now request a contact exchange. 💜'
                : 'Interest sent. Nothing is revealed until they choose you too.',
              'success',
              6000
            );
            refresh();
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            setBusy(likeBtn, false);
          }
        });

        const exchangeBtn = root.querySelector('#btn-exchange');
        exchangeBtn?.addEventListener('click', async () => {
          setBusy(exchangeBtn, true, 'Sending…');
          try {
            await exchangeApi.request(param);
            toast('Request sent. Nothing is shared until they also accept.', 'success', 6000);
            go('matches');
          } catch (error) {
            toast(error.message, 'error', 7000);
          } finally {
            setBusy(exchangeBtn, false);
          }
        });

        root.querySelector('#more-actions')?.addEventListener('click', () => {
          modal(
            'Safety options',
            `<p class="small muted">Reporting creates a real record for our moderation team. Blocking removes this person from your search immediately.</p>`,
            [
              { label: 'Cancel', variant: 'btn-ghost' },
              {
                label: 'Report profile',
                variant: 'btn-secondary',
                onClick: (close) => {
                  close();
                  reportDialog(param);
                },
              },
              {
                label: 'Block',
                variant: 'btn-danger',
                onClick: async (close) => {
                  close();
                  const ok = await confirmDialog(
                    'Block this person?',
                    '<p class="small">They will no longer appear in your search, and any pending contact exchange will be cancelled.</p>',
                    'Block',
                    true
                  );
                  if (!ok) return;
                  try {
                    await safety.block(param, 'blocked from profile');
                    toast('Blocked.', 'success');
                    go('matches');
                  } catch (error) {
                    toast(error.message, 'error');
                  }
                },
              },
            ]
          );
        });
      },
    };
  }

  // My own profile.
  let contacts = [];
  try {
    const data = await profileApi.get();
    contacts = data.contactMethods || [];
    setState({ profile: data.profile });
  } catch (error) {
    if (error.status === 404) {
      return {
        html: `<div class="container">${emptyState(
          '👤',
          'Create your profile first',
          'Tell QuickSense about yourself so matching can work.',
          '<a class="btn btn-primary btn-sm" href="#/setup">Create profile</a>'
        )}</div>`,
      };
    }
  }

  return {
    html: myProfileView(getState(), tax, contacts),
    mount(root) {
      const status = root.querySelector('#photo-status');
      const input = root.querySelector('#photo-input');

      root.querySelector('#add-photo')?.addEventListener('click', () => input.click());
      input.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          status.textContent = 'That photo is over 5 MB. Choose a smaller image.';
          return;
        }
        status.textContent = 'Uploading…';
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read that file.'));
            reader.readAsDataURL(file);
          });
          await profileApi.addPhoto(dataUrl);
          toast('Photo uploaded. It stays visible pending review.', 'success');
          refresh();
        } catch (error) {
          status.textContent = error.message;
          toast(error.message, 'error');
        } finally {
          input.value = '';
        }
      });

      root.querySelectorAll('[data-remove-photo]').forEach((button) =>
        button.addEventListener('click', async () => {
          try {
            await profileApi.deletePhoto(button.dataset.removePhoto);
            toast('Photo removed.', 'success', 2200);
            refresh();
          } catch (error) {
            toast(error.message, 'error');
          }
        })
      );

      root.querySelector('#edit-about')?.addEventListener('click', () => {
        go('settings');
      });

      root.querySelector('#add-contact')?.addEventListener('click', () => contactDialog(refresh));

      root.querySelectorAll('[data-remove-contact]').forEach((button) =>
        button.addEventListener('click', async () => {
          try {
            await profileApi.deleteContact(button.dataset.removeContact);
            toast('Contact method removed.', 'success', 2200);
            refresh();
          } catch (error) {
            toast(error.message, 'error');
          }
        })
      );

      root.querySelector('#sign-out')?.addEventListener('click', async () => {
        try {
          await auth.logout();
        } catch {
          /* the local session is cleared regardless */
        }
        clearSession();
        window.location.hash = '#/welcome';
        window.location.reload();
      });
    },
  };
}

/* ------------------------------------------------------------- dialogs ---- */

export function contactDialog(onDone) {
  const state = getState();
  const types = state.taxonomy?.contactTypes || [];
  modal(
    'Add contact method',
    `
      <div class="stack">
        <div class="field">
          <label for="ct-type">Type</label>
          <select class="select" id="ct-type">
            ${types.map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="ct-value">Value</label>
          <input class="input" id="ct-value" placeholder="e.g. @yourhandle or +234…" />
          <p class="field-error" id="ct-error"></p>
        </div>
        <div class="field">
          <label for="ct-label">Label <span class="muted tiny">(optional)</span></label>
          <input class="input" id="ct-label" placeholder="e.g. Personal" maxlength="40" />
        </div>
        <button type="button" class="toggle is-on" id="ct-share" role="switch" aria-checked="true">
          <span class="grow">
            <span class="small" style="display:block">Allow sharing after mutual consent</span>
            <span class="tiny muted">Off means it is never revealed, even after an exchange</span>
          </span>
          <span class="toggle-switch"></span>
        </button>
      </div>
    `,
    [
      { label: 'Cancel', variant: 'btn-ghost' },
      {
        label: 'Save',
        variant: 'btn-primary',
        onClick: async (close, button) => {
          let shareable = true;
          const toggle = document.getElementById('ct-share');
          shareable = toggle.classList.contains('is-on');
          const payload = {
            type: document.getElementById('ct-type').value,
            value: document.getElementById('ct-value').value.trim(),
            label: document.getElementById('ct-label').value.trim(),
            shareable,
          };
          const errorEl = document.getElementById('ct-error');
          if (!payload.value) {
            errorEl.textContent = 'Enter a value.';
            return;
          }
          setBusy(button, true, 'Saving…');
          try {
            await profileApi.addContact(payload);
            close();
            toast('Contact method saved.', 'success');
            if (onDone) onDone();
          } catch (error) {
            errorEl.textContent = error.details?.value || error.message;
          } finally {
            setBusy(button, false);
          }
        },
      },
    ]
  );

  const toggle = document.getElementById('ct-share');
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('is-on');
    toggle.setAttribute('aria-checked', String(toggle.classList.contains('is-on')));
  });
}

export function reportDialog(userId, onDone) {
  const state = getState();
  const categories = state.taxonomy?.reportCategories || [];
  modal(
    'Report this profile',
    `
      <div class="stack">
        <div class="field">
          <label for="rp-category">What is the problem?</label>
          <select class="select" id="rp-category">
            ${categories.map((c) => `<option value="${c.value}">${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="rp-detail">Details <span class="muted tiny">(optional)</span></label>
          <textarea class="textarea" id="rp-detail" maxlength="1000" placeholder="Tell us what happened."></textarea>
        </div>
      </div>
    `,
    [
      { label: 'Cancel', variant: 'btn-ghost' },
      {
        label: 'Submit report',
        variant: 'btn-danger',
        onClick: async (close, button) => {
          setBusy(button, true, 'Submitting…');
          try {
            const result = await safety.report(
              userId,
              document.getElementById('rp-category').value,
              document.getElementById('rp-detail').value.trim()
            );
            close();
            toast(result.message || 'Your report was recorded.', 'success', 6000);
            if (onDone) onDone();
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            setBusy(button, false);
          }
        },
      },
    ]
  );
}
