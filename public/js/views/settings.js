/**
 * Settings. Every control here writes to the backend and genuinely changes
 * behaviour — nothing is a decorative toggle.
 */
import { settings as settingsApi, preferences as prefsApi, safety, auth, notifications as notificationsApi } from '../api.js';
import { getState, setState } from '../state.js';
import { escapeHtml, toast, modal, setBusy, confirmDialog, emptyState, relativeTime } from '../ui.js';
import { refresh, go } from '../app.js';
import { clearSession } from '../api.js';

const MODES = [
  { value: 'worldwide', label: 'Worldwide', emoji: '🌎' },
  { value: 'countries', label: 'Selected countries', emoji: '🌍' },
  { value: 'country', label: 'My country', emoji: '🗺️' },
  { value: 'city', label: 'My city', emoji: '🏙️' },
  { value: 'radius', label: 'Custom radius', emoji: '🎯' },
];

export async function render() {
  const state = getState();
  let data;
  let prefs;
  let notifPrefs;
  let blocks = [];
  let summary = null;

  try {
    [data, prefs, notifPrefs] = await Promise.all([
      settingsApi.get(),
      prefsApi.get(),
      notificationsApi.preferences(),
    ]);
    setState({ settings: data.settings, preferences: prefs.preferences });
  } catch (error) {
    return { html: `<div class="container"><div class="banner banner--danger">${escapeHtml(error.message)}</div></div>` };
  }

  const s = data.settings;
  const p = prefs.preferences;

  const html = `
    <div class="screen">
      <header class="app-header">
        <button class="icon-btn" onclick="history.back()" aria-label="Back">‹</button>
        <div class="grow center"><h1 style="font-size:1.05rem">Settings</h1></div>
        <span style="width:40px"></span>
      </header>

      <div class="container stack">
        <div class="card">
          <div class="row-between">
            <div>
              <strong>Account</strong>
              <p class="tiny muted mt-0 mb-0">QuickSense ID ${escapeHtml(data.account.qsId)}</p>
              ${data.account.email ? `<p class="tiny muted mt-0 mb-0">${escapeHtml(data.account.email)}</p>` : ''}
            </div>
            <span class="badge ${data.account.recoveryCodesActive ? 'badge-unlocked' : 'badge-pending'}">
              ${data.account.recoveryCodesActive} recovery code${data.account.recoveryCodesActive === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div class="card">
          <strong class="mb-1" style="display:block">Notifications</strong>
          ${toggleRow('notifyNewMatch', 'New potential match', 'Someone shows interest in you', notifPrefs.preferences.notifyNewMatch)}
          ${toggleRow('notifyMutualMatch', 'Mutual match', 'You both chose each other', notifPrefs.preferences.notifyMutualMatch)}
          ${toggleRow('notifyProfileView', 'Profile views', 'Someone looked at your profile', notifPrefs.preferences.notifyProfileView)}
          ${toggleRow('notifyContactRequest', 'Contact requests', 'Someone requests a contact exchange', notifPrefs.preferences.notifyContactRequest)}
          ${toggleRow('notifyExchangeUnlocked', 'Exchange unlocked', 'You both agreed to exchange contacts', notifPrefs.preferences.notifyExchangeUnlocked)}
          ${toggleRow('notifySafety', 'Safety alerts', 'Moderation and account notices', notifPrefs.preferences.notifySafety)}
          <p class="tiny muted mt-1 mb-0">Off means the notification is never created on the server.</p>
        </div>

        <div class="card">
          <strong class="mb-1" style="display:block">Privacy</strong>
          ${toggleRowSetting('showInSearch', 'Appear in search', 'Off hides you from everyone’s results', s.showInSearch)}
          ${toggleRowField('bio', 'Show my bio', data.fieldVisibility.bio !== false)}
          ${toggleRowField('city', 'Show my city', data.fieldVisibility.city !== false)}
          ${toggleRowField('interests', 'Show my interests', data.fieldVisibility.interests !== false)}
          ${toggleRowField('intentions', 'Show what I’m looking for', data.fieldVisibility.intentions !== false)}
        </div>

        <div class="card">
          <div class="row-between mb-1">
            <strong>Matching preferences</strong>
            <span class="tiny muted">${escapeHtml(prefs.searchDescription)}</span>
          </div>
          <div class="age-row">
            <div class="field">
              <label for="ageMin">Min age</label>
              <input class="input" type="number" id="ageMin" min="18" max="100" value="${p.ageMin}" />
            </div>
            <div class="field">
              <label for="ageMax">Max age</label>
              <input class="input" type="number" id="ageMax" min="18" max="100" value="${p.ageMax}" />
            </div>
          </div>
          <p class="field-error" data-error="ageMax"></p>

          <p class="label mt-2 mb-1">Interested in <span class="muted tiny">(empty = anyone)</span></p>
          <div class="chip-group" id="gender-chips"></div>

          <p class="label mt-2 mb-1">Search area</p>
          <div class="chip-group" id="mode-chips"></div>
          <div id="mode-extra" class="mt-1"></div>

          <button class="btn btn-primary btn-block mt-2" id="save-prefs">Save preferences</button>
        </div>

        <div class="card">
          <strong class="mb-1" style="display:block">Safety centre</strong>
          <div class="stack-sm">
            <button class="btn btn-secondary btn-sm btn-block" id="open-blocks">Blocked users</button>
            <button class="btn btn-secondary btn-sm btn-block" id="open-reports">My reports</button>
            <button class="btn btn-secondary btn-sm btn-block" id="open-safety-summary">Safety summary</button>
          </div>
        </div>

        <div class="card">
          <strong class="mb-1" style="display:block">Account recovery</strong>
          <p class="tiny muted mt-0">
            Save a recovery code to restore your QuickSense on a new device or after reinstalling.
          </p>
          <button class="btn btn-secondary btn-sm btn-block" id="recovery-code">Generate recovery code</button>
          <button class="btn btn-ghost btn-sm btn-block mt-1" id="set-password">Set a password</button>
        </div>

        <div class="card">
          <strong class="mb-1" style="display:block">Legal</strong>
          <div class="stack-sm">
            <button class="btn btn-ghost btn-sm btn-block" id="terms">Terms of Service</button>
            <button class="btn btn-ghost btn-sm btn-block" id="privacy">Privacy Policy</button>
          </div>
        </div>

        <div class="card">
          <strong class="mb-1" style="display:block" style="color:var(--danger)">Danger zone</strong>
          <button class="btn btn-danger btn-block" id="delete-account">Delete my account</button>
          <p class="tiny muted mt-1 mb-0">
            Permanently removes your profile, photos, matches, contact exchanges and notifications.
          </p>
        </div>

        ${
          state.user?.role === 'admin'
            ? `<a class="btn btn-secondary btn-block" href="#/admin">Admin dashboard</a>`
            : ''
        }
      </div>
    </div>
  `;

  return {
    html,
    mount(root) {
      const tax = state.taxonomy;

      /* ------------------------------------------------------- toggles --- */
      const pendingNotificationPrefs = { ...notifPrefs.preferences };
      root.querySelectorAll('[data-notif-toggle]').forEach((node) => {
        node.addEventListener('click', async () => {
          const key = node.dataset.notifToggle;
          pendingNotificationPrefs[key] = !node.classList.contains('is-on');
          node.classList.toggle('is-on', pendingNotificationPrefs[key]);
          node.setAttribute('aria-checked', String(pendingNotificationPrefs[key]));
          try {
            const saved = await notificationsApi.savePreferences(pendingNotificationPrefs);
            setState({ settings: { ...s, ...saved.preferences } });
            toast('Notification preference saved.', 'success', 2200);
          } catch (error) {
            node.classList.toggle('is-on', !pendingNotificationPrefs[key]);
            pendingNotificationPrefs[key] = !pendingNotificationPrefs[key];
            toast(error.message, 'error');
          }
        });
      });

      const pendingSettings = { ...s };
      root.querySelectorAll('[data-setting-toggle]').forEach((node) => {
        node.addEventListener('click', async () => {
          const key = node.dataset.settingToggle;
          pendingSettings[key] = !node.classList.contains('is-on');
          node.classList.toggle('is-on', pendingSettings[key]);
          node.setAttribute('aria-checked', String(pendingSettings[key]));
          try {
            await settingsApi.save({ [key]: pendingSettings[key] });
            toast('Setting saved.', 'success', 2200);
          } catch (error) {
            node.classList.toggle('is-on', !pendingSettings[key]);
            pendingSettings[key] = !pendingSettings[key];
            toast(error.message, 'error');
          }
        });
      });

      const pendingVisibility = { ...data.fieldVisibility };
      root.querySelectorAll('[data-visibility-toggle]').forEach((node) => {
        node.addEventListener('click', async () => {
          const key = node.dataset.visibilityToggle;
          const next = !node.classList.contains('is-on');
          node.classList.toggle('is-on', next);
          node.setAttribute('aria-checked', String(next));
          pendingVisibility[key] = next;
          try {
            await settingsApi.saveVisibility({ [key]: next });
            toast('Visibility saved.', 'success', 2200);
          } catch (error) {
            node.classList.toggle('is-on', !next);
            pendingVisibility[key] = !next;
            toast(error.message, 'error');
          }
        });
      });

      /* --------------------------------------------------- preferences --- */
      const draft = {
        ageMin: p.ageMin,
        ageMax: p.ageMax,
        genders: [...p.genders],
        searchMode: p.searchMode,
        radiusKm: p.radiusKm,
        countries: [...p.countries],
      };

      function drawGenders() {
        const box = root.querySelector('#gender-chips');
        box.innerHTML = tax.genders
          .map(
            (g) =>
              `<button type="button" class="chip ${draft.genders.includes(g.value) ? 'is-selected' : ''}" data-value="${g.value}">${escapeHtml(g.label)}</button>`
          )
          .join('');
        box.querySelectorAll('.chip').forEach((chip) =>
          chip.addEventListener('click', () => {
            const value = chip.dataset.value;
            draft.genders = draft.genders.includes(value)
              ? draft.genders.filter((v) => v !== value)
              : [...draft.genders, value];
            drawGenders();
          })
        );
      }

      function drawModes() {
        const box = root.querySelector('#mode-chips');
        box.innerHTML = MODES.map(
          (m) =>
            `<button type="button" class="chip ${draft.searchMode === m.value ? 'is-selected' : ''}" data-value="${m.value}"><span aria-hidden="true">${m.emoji}</span><span>${escapeHtml(m.label)}</span></button>`
        ).join('');
        box.querySelectorAll('.chip').forEach((chip) =>
          chip.addEventListener('click', () => {
            draft.searchMode = chip.dataset.value;
            drawModes();
            drawExtra();
          })
        );
      }

      function drawExtra() {
        const extra = root.querySelector('#mode-extra');
        if (draft.searchMode === 'countries') {
          extra.innerHTML = `
            <div class="search-input">
              <input class="input" id="country-search" placeholder="Search countries…" />
            </div>
            <div class="chip-group mt-1" id="country-chips" style="max-height:180px;overflow-y:auto"></div>
            <p class="field-error" data-error="countries"></p>
          `;
          const search = root.querySelector('#country-search');
          const chips = root.querySelector('#country-chips');
          const draw = () => {
            const term = search.value.trim().toLowerCase();
            chips.innerHTML = tax.countries
              .filter((c) => c.label.toLowerCase().includes(term))
              .map(
                (c) =>
                  `<button type="button" class="chip ${draft.countries.includes(c.value) ? 'is-selected' : ''}" data-value="${c.value}">${escapeHtml(c.label)}</button>`
              )
              .join('');
            chips.querySelectorAll('.chip').forEach((chip) =>
              chip.addEventListener('click', () => {
                const value = chip.dataset.value;
                draft.countries = draft.countries.includes(value)
                  ? draft.countries.filter((v) => v !== value)
                  : [...draft.countries, value];
                draw();
              })
            );
          };
          search.addEventListener('input', draw);
          draw();
        } else if (draft.searchMode === 'radius') {
          extra.innerHTML = `
            <div class="field">
              <label for="radius">Radius</label>
              <select class="select" id="radius">
                ${tax.radiusOptions
                  .map((r) => `<option value="${r}" ${draft.radiusKm === r ? 'selected' : ''}>${r} km</option>`)
                  .join('')}
              </select>
            </div>
          `;
          root.querySelector('#radius').addEventListener('change', (event) => {
            draft.radiusKm = Number(event.target.value);
          });
        } else {
          extra.innerHTML = '';
        }
      }

      drawGenders();
      drawModes();
      drawExtra();

      root.querySelector('#save-prefs').addEventListener('click', async (event) => {
        draft.ageMin = Number(root.querySelector('#ageMin').value);
        draft.ageMax = Number(root.querySelector('#ageMax').value);
        if (draft.ageMin > draft.ageMax) {
          root.querySelector('[data-error="ageMax"]').textContent =
            'Maximum age must not be lower than minimum age.';
          return;
        }
        setBusy(event.currentTarget, true, 'Saving…');
        try {
          await prefsApi.save({
            ageMin: draft.ageMin,
            ageMax: draft.ageMax,
            genders: draft.genders,
            searchMode: draft.searchMode,
            radiusKm: draft.radiusKm,
            countries: draft.countries,
          });
          toast('Preferences saved. Your next search uses them.', 'success');
          refresh();
        } catch (error) {
          const details = error.details || {};
          for (const [field, message] of Object.entries(details)) {
            const node = root.querySelector(`[data-error="${field}"]`);
            if (node) node.textContent = message;
          }
          toast(error.message, 'error');
        } finally {
          setBusy(event.currentTarget, false);
        }
      });

      /* ------------------------------------------------------- safety ---- */
      root.querySelector('#open-blocks').addEventListener('click', async () => {
        try {
          const { blocks: list } = await safety.blocks();
          modal(
            'Blocked users',
            list.length
              ? `<div class="stack-sm">${list
                  .map(
                    (b) => `
                    <div class="row-between" style="padding:.55rem 0;border-bottom:1px solid var(--line-soft)">
                      <div class="grow">
                        <strong class="small">${escapeHtml(b.displayName)}</strong>
                        <p class="tiny muted mt-0 mb-0">Blocked ${relativeTime(b.createdAt)}</p>
                      </div>
                      <button class="btn btn-ghost btn-sm" data-unblock="${escapeHtml(b.userId)}">Unblock</button>
                    </div>`
                  )
                  .join('')}</div>`
              : '<p class="small muted">You haven’t blocked anyone.</p>'
          );
          document.querySelectorAll('[data-unblock]').forEach((button) =>
            button.addEventListener('click', async () => {
              try {
                await safety.unblock(button.dataset.unblock);
                toast('Unblocked.', 'success', 2200);
                button.closest('.row-between').remove();
              } catch (error) {
                toast(error.message, 'error');
              }
            })
          );
        } catch (error) {
          toast(error.message, 'error');
        }
      });

      root.querySelector('#open-reports').addEventListener('click', async () => {
        try {
          const dataSummary = await safety.summary();
          modal(
            'My reports',
            dataSummary.myReports.length
              ? `<div class="stack-sm">${dataSummary.myReports
                  .map(
                    (r) => `
                    <div style="padding:.55rem 0;border-bottom:1px solid var(--line-soft)">
                      <div class="row-between">
                        <strong class="small">${escapeHtml(r.category)}</strong>
                        <span class="badge ${r.status === 'pending' ? 'badge-pending' : 'badge-muted'}">${escapeHtml(r.status)}</span>
                      </div>
                      <p class="tiny muted mt-0 mb-0">Submitted ${relativeTime(r.createdAt)}</p>
                    </div>`
                  )
                  .join('')}</div>`
              : '<p class="small muted">You haven’t reported anyone.</p>'
          );
        } catch (error) {
          toast(error.message, 'error');
        }
      });

      root.querySelector('#open-safety-summary').addEventListener('click', async () => {
        try {
          const summaryData = await safety.summary();
          modal(
            'Safety summary',
            `
              <div class="stat-grid mb-2">
                <div class="stat"><div class="stat-value">${summaryData.blockedCount}</div><div class="stat-label">Blocked</div></div>
                <div class="stat"><div class="stat-value">${summaryData.myReports.length}</div><div class="stat-label">Reports</div></div>
              </div>
              <div class="banner banner--warn">
                ${escapeHtml(summaryData.moderationNote)}
              </div>
              <p class="tiny muted mt-1">
                Minimum age: ${summaryData.minimumAge}. Report or block anyone who makes you uncomfortable.
              </p>
            `
          );
        } catch (error) {
          toast(error.message, 'error');
        }
      });

      /* ---------------------------------------------------- recovery ---- */
      root.querySelector('#recovery-code').addEventListener('click', async (event) => {
        modal(
          'Generate a recovery code',
          `
            <p class="small muted">
              Link an email (optional) so you can restore with either your email or your QuickSense ID.
            </p>
            <div class="field">
              <label for="recovery-email">Email <span class="muted tiny">(optional)</span></label>
              <input class="input" id="recovery-email" type="email" placeholder="you@example.com"
                     value="${escapeHtml(data.account.email || '')}" />
              <p class="field-error" id="recovery-error"></p>
            </div>
          `,
          [
            { label: 'Cancel', variant: 'btn-ghost' },
            {
              label: 'Generate',
              variant: 'btn-primary',
              onClick: async (close, button) => {
                const email = document.getElementById('recovery-email').value.trim();
                setBusy(button, true, 'Generating…');
                try {
                  const result = await auth.recoveryCode(email || undefined);
                  close();
                  modal(
                    'Save this code',
                    `
                      <p class="small muted">Your recovery code is shown once and stored only as a hash.</p>
                      <div class="contact-value mb-1"><strong id="rc">${escapeHtml(result.recoveryCode)}</strong>
                        <button class="btn btn-ghost btn-sm" id="copy-rc">Copy</button>
                      </div>
                      <div class="banner banner--warn">
                        ${escapeHtml(result.message)}
                      </div>
                    `,
                    [{ label: 'Done', variant: 'btn-primary' }]
                  );
                  document.getElementById('copy-rc')?.addEventListener('click', async () => {
                    try {
                      await navigator.clipboard.writeText(result.recoveryCode);
                      toast('Copied.', 'success', 2000);
                    } catch {
                      toast('Select the code and copy it manually.', 'warn');
                    }
                  });
                  refresh();
                } catch (error) {
                  document.getElementById('recovery-error').textContent = error.details?.email || error.message;
                } finally {
                  setBusy(button, false);
                }
              },
            },
          ]
        );
      });

      root.querySelector('#set-password').addEventListener('click', () => {
        modal(
          'Set a password',
          `
            <p class="small muted">Optional. Lets you sign in from another device without a recovery code.</p>
            <div class="field">
              <label for="pw">New password</label>
              <input class="input" id="pw" type="password" minlength="8" placeholder="At least 8 characters" />
              <p class="field-error" id="pw-error"></p>
            </div>
          `,
          [
            { label: 'Cancel', variant: 'btn-ghost' },
            {
              label: 'Save',
              variant: 'btn-primary',
              onClick: async (close, button) => {
                const password = document.getElementById('pw').value;
                setBusy(button, true, 'Saving…');
                try {
                  await auth.setPassword(password);
                  close();
                  toast('Password set.', 'success');
                } catch (error) {
                  document.getElementById('pw-error').textContent = error.message;
                } finally {
                  setBusy(button, false);
                }
              },
            },
          ]
        );
      });

      /* -------------------------------------------------------- legal ---- */
      root.querySelector('#terms').addEventListener('click', () => showTerms());
      root.querySelector('#privacy').addEventListener('click', () => showPrivacy());

      /* ------------------------------------------------------ delete ----- */
      root.querySelector('#delete-account').addEventListener('click', async () => {
        const ok = await confirmDialog(
          'Delete your account?',
          `
            <p class="small">This permanently deletes your profile, photos, matches, contact exchanges
            and notifications. It cannot be undone.</p>
            <p class="small muted">Your QuickSense ID ${escapeHtml(data.account.qsId)} will be released.</p>
          `,
          'Delete everything',
          true
        );
        if (!ok) return;
        try {
          await auth.deleteAccount();
          clearSession();
          toast('Your account has been deleted.', 'success', 6000);
          window.location.hash = '#/welcome';
          window.location.reload();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    },
  };
}

/* ------------------------------------------------------------- helpers --- */

function toggleRow(key, label, hint, on) {
  return `
    <button type="button" class="toggle ${on ? 'is-on' : ''}" role="switch" aria-checked="${on}" data-notif-toggle="${key}">
      <span class="grow">
        <span class="small" style="display:block">${escapeHtml(label)}</span>
        <span class="tiny muted">${escapeHtml(hint)}</span>
      </span>
      <span class="toggle-switch"></span>
    </button>
  `;
}

function toggleRowSetting(key, label, hint, on) {
  return `
    <button type="button" class="toggle ${on ? 'is-on' : ''}" role="switch" aria-checked="${on}" data-setting-toggle="${key}">
      <span class="grow">
        <span class="small" style="display:block">${escapeHtml(label)}</span>
        <span class="tiny muted">${escapeHtml(hint)}</span>
      </span>
      <span class="toggle-switch"></span>
    </button>
  `;
}

function toggleRowField(key, label, on) {
  return `
    <button type="button" class="toggle ${on ? 'is-on' : ''}" role="switch" aria-checked="${on}" data-visibility-toggle="${key}">
      <span class="grow"><span class="small">${escapeHtml(label)}</span></span>
      <span class="toggle-switch"></span>
    </button>
  `;
}

function showTerms() {
  modal(
    'Terms of Service',
    `
      <div class="small muted stack-sm">
        <p><strong>1. Eligibility.</strong> QuickSense is strictly for adults aged 18 and over. Accounts created by anyone under 18 are removed.</p>
        <p><strong>2. Your content.</strong> You keep ownership of what you post. You grant QuickSense permission to display it to other users as part of the service.</p>
        <p><strong>3. Contact exchange.</strong> Contact details are revealed only after both people accept an exchange. Requesting an exchange does not guarantee access.</p>
        <p><strong>4. Acceptable use.</strong> No scams, solicitation, harassment, impersonation, spam, or content that sexualises or endangers minors.</p>
        <p><strong>5. Safety.</strong> You can block or report any profile. Reports are reviewed by our moderation team.</p>
        <p><strong>6. Termination.</strong> You may delete your account at any time. We may suspend accounts that breach these terms.</p>
        <p><strong>7. No guarantee.</strong> QuickSense provides compatibility estimates, not guarantees about any person you meet. Use caution offline.</p>
        <p class="tiny">This document is part of the application build and is not legal advice. Replace it with counsel-reviewed terms before a public launch.</p>
      </div>
    `,
    [{ label: 'Close', variant: 'btn-secondary' }]
  );
}

function showPrivacy() {
  modal(
    'Privacy Policy',
    `
      <div class="small muted stack-sm">
        <p><strong>What we collect.</strong> Your profile details, preferences, photos, match actions, contact-exchange records, reports and notifications.</p>
        <p><strong>What we never show publicly.</strong> Your exact location, your contact details, your recovery codes, and moderation records about other people.</p>
        <p><strong>Location.</strong> We store only a coarse area (city/region) and, if you enable distance search, approximate coordinates rounded to roughly 1 km. We never display a home address.</p>
        <p><strong>Contact details.</strong> Stored securely and revealed only after you and the other person both accept an exchange.</p>
        <p><strong>Sessions.</strong> Your device holds an opaque token; the server stores only a hash of it, so a stolen database cannot be replayed to sign in.</p>
        <p><strong>Deletion.</strong> Deleting your account removes your profile, photos, matches, exchanges and notifications from our database.</p>
        <p><strong>Not implemented in this build.</strong> Email delivery, push notifications, automated image analysis and payments are not active, so no related data is collected or transmitted.</p>
        <p class="tiny">Replace this with a counsel-reviewed policy before handling real user data.</p>
      </div>
    `,
    [{ label: 'Close', variant: 'btn-secondary' }]
  );
}
