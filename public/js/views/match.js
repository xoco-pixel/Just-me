/**
 * Find My Match.
 *
 * Runs the real matching engine via the API and renders genuine results. When
 * there is nobody compatible, it says so honestly and reports how many profiles
 * were actually considered — it never invents a candidate.
 */
import { matches as matchesApi, preferences as prefsApi } from '../api.js';
import { getState, setState, labelFor } from '../state.js';
import { escapeHtml, toast, emptyState, setBusy, avatar, modal } from '../ui.js';
import { go, refresh } from '../app.js';

const COMPONENT_LABELS = {
  interests: 'Interests',
  intention: 'Intentions',
  location: 'Location',
  age: 'Age',
  language: 'Language',
  extra: 'Other',
};

function reasonList(reasons) {
  if (!reasons?.length) return '';
  return `
    <div class="why-box">
      <h4>Why you matched</h4>
      <ul class="reason-list">
        ${reasons
          .map(
            (reason) => `
            <li class="reason ${reason.negative ? 'reason--negative' : ''}">
              <span class="reason-icon" aria-hidden="true">${reason.icon || '•'}</span>
              <span>${escapeHtml(reason.text)}</span>
            </li>`
          )
          .join('')}
      </ul>
    </div>
  `;
}

function componentBars(components) {
  const entries = Object.entries(components || {}).filter(([, value]) => typeof value === 'number');
  if (!entries.length) return '';
  return `
    <div class="component-bars">
      ${entries
        .map(
          ([key, value]) => `
          <div class="component-row">
            <span>${escapeHtml(COMPONENT_LABELS[key] || key)}</span>
            <span class="bar"><span style="width:${Math.round(value * 100)}%"></span></span>
            <span>${Math.round(value * 100)}%</span>
          </div>`
        )
        .join('')}
    </div>
  `;
}

function resultCard(result, index) {
  const profile = result.profile || {};
  const photo = profile.photos?.[0]?.url;
  const interests = (profile.interests || []).slice(0, 3);
  return `
    <article class="match-card" data-user="${escapeHtml(result.userId)}" data-index="${index}">
      <div class="match-photo">
        ${
          photo
            ? `<img src="${photo}" alt="${escapeHtml(profile.displayName)}" loading="lazy" />`
            : `<div class="no-photo" aria-hidden="true">${escapeHtml((profile.displayName || '?')[0])}</div>`
        }
        <div class="score-pill"><span aria-hidden="true">❤️</span> ${result.score}%</div>
        ${profile.isDemo ? '<span class="badge badge-demo" style="position:absolute;top:.85rem;left:.85rem">Demo</span>' : ''}
      </div>
      <div class="match-body">
        <div>
          <h3 class="match-name">
            ${escapeHtml(profile.displayName || 'Unnamed')}
            ${profile.age ? `<span class="muted" style="font-size:1rem">· ${profile.age}</span>` : ''}
          </h3>
          <p class="match-meta">
            ${escapeHtml([profile.city, profile.countryName].filter(Boolean).join(', ') || 'Location private')}
            ${result.theyLikedYou ? ' · <strong style="color:var(--coral-soft)">interested in you</strong>' : ''}
          </p>
        </div>

        ${
          interests.length
            ? `<div class="tag-row">${interests
                .map((i) => `<span class="tag">${escapeHtml(labelFor('interests', i))}</span>`)
                .join('')}</div>`
            : ''
        }

        ${profile.bio ? `<p class="small muted mb-0 mt-0">"${escapeHtml(profile.bio)}"</p>` : ''}

        ${reasonList(result.reasons)}

        <details class="mt-1">
          <summary class="small muted" style="cursor:pointer">See compatibility breakdown</summary>
          <div class="mt-1">${componentBars(result.components)}</div>
        </details>

        <div class="row">
          <a class="btn btn-secondary grow" href="#/user/${escapeHtml(result.userId)}">View Profile</a>
          <button class="btn btn-primary grow" data-like="${escapeHtml(result.userId)}">Match ❤️</button>
        </div>
      </div>
    </article>
  `;
}

export async function render() {
  const state = getState();

  const html = `
    <div class="screen">
      <header class="app-header">
        <div>
          <h1>Find Your Match</h1>
          <p class="header-sub" id="search-scope">Loading your search area…</p>
        </div>
        <a class="icon-btn" href="#/settings" aria-label="Settings">⚙️</a>
      </header>

      <div class="container stack" id="results-region">
        <div class="empty"><div class="empty-icon">💜</div><p>Loading…</p></div>
      </div>
    </div>
  `;

  return {
    html,
    async mount(root) {
      const region = root.querySelector('#results-region');
      const scope = root.querySelector('#search-scope');

      let prefsDescription = 'Worldwide';
      try {
        const prefs = await prefsApi.get();
        prefsDescription = prefs.searchDescription;
        setState({ preferences: prefs.preferences });
      } catch {
        /* keep the default label; the header is not critical */
      }
      scope.textContent = `Searching: ${prefsDescription}`;

      async function load({ force = false } = {}) {
        region.innerHTML = `<div class="empty"><div class="empty-icon">💜</div><p>Searching for compatible people…</p></div>`;
        try {
          const data = force ? await matchesApi.refresh() : await matchesApi.find();
          if (data.count === 0) {
            region.innerHTML = `
              <div class="banner banner--info">
                ${escapeHtml(
                  data.honestEmpty ||
                    'We couldn’t find a strong match right now. Try expanding your location or age preferences.'
                )}
              </div>
              <div class="card center">
                <p class="small muted mb-1">
                  ${data.diagnostics.profilesConsidered} profile${
                    data.diagnostics.profilesConsidered === 1 ? '' : 's'
                  } considered · ${data.diagnostics.passedHardGates} passed the compatibility gates.
                </p>
                <p class="tiny muted mb-2">
                  QuickSense never shows placeholder people. Every result is a real profile.
                </p>
                <div class="stack-sm">
                  <a class="btn btn-secondary" href="#/settings">Adjust my preferences</a>
                  <button class="btn btn-ghost" id="rescan">Search again</button>
                </div>
              </div>
            `;
            region.querySelector('#rescan')?.addEventListener('click', () => load({ force: true }));
            return;
          }

          region.innerHTML = `
            <p class="small muted mt-0">
              ${data.count} compatible ${data.count === 1 ? 'person' : 'people'} ·
              ${data.diagnostics.profilesConsidered} profiles considered
            </p>
            ${data.results.map(resultCard).join('')}
            <div class="center mt-1">
              <button class="btn btn-ghost btn-sm" id="rescan">Run search again</button>
            </div>
          `;

          region.querySelectorAll('[data-like]').forEach((button) =>
            button.addEventListener('click', async (event) => {
              const userId = event.currentTarget.dataset.like;
              setBusy(button, true, 'Matching…');
              try {
                const result = await matchesApi.act(userId, 'like');
                const card = button.closest('.match-card');
                if (result.mutual) {
                  toast('It’s a match! You both chose each other. 💜', 'success', 6000);
                  card?.remove();
                } else {
                  toast('Interest sent. Nothing is revealed until they choose you too.', 'success', 5000);
                  button.textContent = 'Interested ✓';
                  button.disabled = true;
                }
              } catch (error) {
                toast(error.message, 'error');
              } finally {
                setBusy(button, false);
              }
            })
          );
          region.querySelector('#rescan')?.addEventListener('click', () => load({ force: true }));
        } catch (error) {
          region.innerHTML = `
            <div class="banner banner--danger">${escapeHtml(error.message)}</div>
            <div class="center mt-1"><button class="btn btn-secondary btn-sm" id="retry">Try again</button></div>
          `;
          region.querySelector('#retry').addEventListener('click', () => load());
        }
      }

      await load();
    },
  };
}
