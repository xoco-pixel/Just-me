/** Admin dashboard: real counts, real reports, real moderation queue. */
import { admin as adminApi } from '../api.js';
import { escapeHtml, toast, emptyState, relativeTime, setBusy, modal, confirmDialog } from '../ui.js';
import { refresh } from '../app.js';

function shell(title, bodyHtml) {
  return `
    <div class="screen">
      <header class="app-header">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p class="header-sub">Restricted area</p>
        </div>
        <button class="icon-btn" id="refresh" aria-label="Refresh">⟳</button>
      </header>
      <div class="container stack" id="admin-region">${bodyHtml}</div>
    </div>
  `;
}

function statGrid(stats) {
  return `<div class="stat-grid">${stats
    .map(
      (s) => `<div class="stat">
        <div class="stat-value">${escapeHtml(String(s.value))}</div>
        <div class="stat-label">${escapeHtml(s.label)}</div>
      </div>`
    )
    .join('')}</div>`;
}

/* ------------------------------------------------------------- overview --- */

export async function renderOverview() {
  const html = shell('Dashboard', `<div class="empty"><p>Loading…</p></div>`);

  return {
    html,
    async mount(root) {
      const region = root.querySelector('#admin-region');

      async function load() {
        region.innerHTML = `<div class="empty"><p>Loading…</p></div>`;
        try {
          const data = await adminApi.overview();
          region.innerHTML = `
            <div class="card">
              <strong class="mb-1" style="display:block">Users</strong>
              ${statGrid([
                { label: 'Total', value: data.users.total },
                { label: 'Active', value: data.users.active },
                { label: 'Suspended', value: data.users.suspended },
                { label: 'New today', value: data.users.newToday },
                { label: 'New this week', value: data.users.newThisWeek },
                { label: 'Complete profiles', value: data.users.withCompleteProfile },
              ])}
              ${
                data.users.demo > 0
                  ? `<p class="tiny muted mt-1 mb-0">${data.users.demo} demo profile(s) tagged and labelled in the app.</p>`
                  : ''
              }
            </div>

            <div class="card">
              <strong class="mb-1" style="display:block">Moderation</strong>
              ${statGrid([
                { label: 'Open reports', value: data.moderation.openReports },
                { label: 'Reviewed', value: data.moderation.reviewedReports },
                { label: 'Reported users', value: data.moderation.reportedUsers },
                { label: 'Open flags', value: data.moderation.openFlags },
                { label: 'High severity', value: data.moderation.highSeverityFlags },
                { label: 'Photos pending', value: data.moderation.photosPending },
              ])}
            </div>

            <div class="card">
              <strong class="mb-1" style="display:block">Matching</strong>
              ${statGrid([
                { label: 'Matches', value: data.matching.totalMatches },
                { label: 'Mutual', value: data.matching.mutualMatches },
                { label: 'Pending', value: data.matching.pendingMatches },
                { label: 'Exchange requests', value: data.matching.exchangeRequests },
                { label: 'Unlocked', value: data.matching.unlockedExchanges },
                { label: 'Declined', value: data.matching.declinedExchanges },
              ])}
            </div>

            <div class="card">
              <strong class="mb-1" style="display:block">Activity</strong>
              ${statGrid([
                { label: 'Daily active', value: data.activity.daily },
                { label: 'Weekly active', value: data.activity.weekly },
                { label: 'Monthly active', value: data.activity.monthly },
                { label: 'Match rate', value: `${data.analytics.matchRatePercent}%` },
              ])}
            </div>

            ${
              data.analytics.popularInterests.length
                ? `<div class="card">
                     <strong class="mb-1" style="display:block">Popular interests</strong>
                     <div class="tag-row">
                       ${data.analytics.popularInterests
                         .map((i) => `<span class="tag">${escapeHtml(i.label)} · ${i.count}</span>`)
                         .join('')}
                     </div>
                   </div>`
                : ''
            }

            ${
              data.analytics.popularCountries.length
                ? `<div class="card">
                     <strong class="mb-1" style="display:block">Top countries</strong>
                     <div class="tag-row">
                       ${data.analytics.popularCountries
                         .map((c) => `<span class="tag">${escapeHtml(c.label)} · ${c.count}</span>`)
                         .join('')}
                     </div>
                   </div>`
                : ''
            }

            <p class="tiny muted center">Generated ${escapeHtml(relativeTime(data.generatedAt))}</p>
          `;
        } catch (error) {
          region.innerHTML = `<div class="banner banner--danger">${escapeHtml(error.message)}</div>`;
        }
      }

      root.querySelector('#refresh').addEventListener('click', load);
      await load();
    },
  };
}

/* ---------------------------------------------------------------- users --- */

export async function renderUsers() {
  const html = shell(
    'Users',
    `
      <div class="search-input">
        <input class="input" id="user-search" placeholder="Search by QuickSense ID, name or country…" />
      </div>
      <div class="row" style="gap:.5rem">
        <button class="btn btn-secondary btn-sm" data-status="">All</button>
        <button class="btn btn-ghost btn-sm" data-status="active">Active</button>
        <button class="btn btn-ghost btn-sm" data-status="suspended">Suspended</button>
      </div>
      <div id="user-list"><div class="empty"><p>Loading…</p></div></div>
    `
  );

  return {
    html,
    async mount(root) {
      const list = root.querySelector('#user-list');
      const search = root.querySelector('#user-search');
      let status = '';
      let page = 1;

      async function load() {
        list.innerHTML = `<div class="empty"><p>Loading…</p></div>`;
        try {
          const data = await adminApi.users({ q: search.value.trim(), status, page });
          if (!data.users.length) {
            list.innerHTML = emptyState('👥', 'No users found', 'Try a different search or filter.');
            return;
          }
          list.innerHTML = `
            <p class="tiny muted">${data.total} user(s) · page ${data.page} of ${data.pages}</p>
            <div class="stack-sm">
              ${data.users
                .map(
                  (u) => `
                  <div class="card" style="padding:.9rem">
                    <div class="row-between">
                      <div class="grow">
                        <strong class="small">${escapeHtml(u.displayName || 'No profile')}</strong>
                        <p class="tiny muted mt-0 mb-0">
                          ${escapeHtml(u.qsId)} · ${escapeHtml(u.countryName || '—')}${u.age ? ` · ${u.age}` : ''}
                        </p>
                        <p class="tiny muted mt-0 mb-0">
                          Joined ${relativeTime(u.createdAt)}${
                            u.openFlags ? ` · ${u.openFlags} open flag(s)` : ''
                          }${u.reports ? ` · ${u.reports} report(s)` : ''}
                        </p>
                      </div>
                      <span class="badge ${u.status === 'active' ? 'badge-unlocked' : 'badge-pending'}">${escapeHtml(u.status)}</span>
                    </div>
                    <div class="row mt-1">
                      ${
                        u.status === 'active'
                          ? `<button class="btn btn-danger btn-sm grow" data-suspend="${escapeHtml(u.userId)}">Suspend</button>`
                          : `<button class="btn btn-success btn-sm grow" data-reactivate="${escapeHtml(u.userId)}">Reactivate</button>`
                      }
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          `;

          const act = async (userId, next, button) => {
            setBusy(button, true, 'Saving…');
            try {
              await adminApi.setStatus(userId, next);
              toast(`User ${next}.`, 'success');
              load();
            } catch (error) {
              toast(error.message, 'error');
            } finally {
              setBusy(button, false);
            }
          };
          list.querySelectorAll('[data-suspend]').forEach((b) =>
            b.addEventListener('click', () => act(b.dataset.suspend, 'suspended', b))
          );
          list.querySelectorAll('[data-reactivate]').forEach((b) =>
            b.addEventListener('click', () => act(b.dataset.reactivate, 'active', b))
          );
        } catch (error) {
          list.innerHTML = `<div class="banner banner--danger">${escapeHtml(error.message)}</div>`;
        }
      }

      search.addEventListener('input', () => {
        page = 1;
        load();
      });
      root.querySelectorAll('[data-status]').forEach((button) =>
        button.addEventListener('click', () => {
          status = button.dataset.status;
          page = 1;
          root.querySelectorAll('[data-status]').forEach((b) => {
            b.className = b === button ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
          });
          load();
        })
      );
      root.querySelector('#refresh').addEventListener('click', load);
      await load();
    },
  };
}

/* -------------------------------------------------------------- reports --- */

export async function renderReports() {
  const html = shell(
    'Moderation',
    `
      <div class="row" style="gap:.5rem">
        <button class="btn btn-secondary btn-sm" data-filter="pending">Pending</button>
        <button class="btn btn-ghost btn-sm" data-filter="reviewed">Reviewed</button>
        <button class="btn btn-ghost btn-sm" data-filter="dismissed">Dismissed</button>
      </div>
      <div id="report-list"><div class="empty"><p>Loading…</p></div></div>
      <div id="flag-list"></div>
    `
  );

  return {
    html,
    async mount(root) {
      const list = root.querySelector('#report-list');
      const flagList = root.querySelector('#flag-list');
      let filter = 'pending';

      async function load() {
        list.innerHTML = `<div class="empty"><p>Loading…</p></div>`;
        try {
          const data = await adminApi.reports(filter);
          if (!data.reports.length) {
            list.innerHTML = `<div class="card small muted center">No ${escapeHtml(filter)} reports.</div>`;
          } else {
            list.innerHTML = data.reports
              .map(
                (r) => `
                <div class="card mb-1" style="padding:.9rem">
                  <div class="row-between">
                    <strong class="small">${escapeHtml(r.category)}</strong>
                    <span class="badge ${r.status === 'pending' ? 'badge-pending' : 'badge-muted'}">${escapeHtml(r.status)}</span>
                  </div>
                  <p class="tiny muted mt-1 mb-0">
                    Reported: <strong>${escapeHtml(r.reported.displayName || '—')}</strong>
                    (${escapeHtml(r.reported.qsId)})${r.reported.age ? `, ${r.reported.age}` : ''}
                    ${r.reported.countryName ? ` · ${escapeHtml(r.reported.countryName)}` : ''}
                  </p>
                  ${r.description ? `<p class="small mt-1 mb-0">"${escapeHtml(r.description)}"</p>` : ''}
                  <p class="tiny muted mt-1 mb-0">Submitted ${relativeTime(r.createdAt)} by ${escapeHtml(r.reporter.qsId)}</p>
                  ${
                    r.status === 'pending'
                      ? `<div class="row mt-1" style="gap:.4rem">
                           <button class="btn btn-danger btn-sm grow" data-action="suspend" data-id="${escapeHtml(r.id)}">Suspend user</button>
                           <button class="btn btn-secondary btn-sm grow" data-action="warn" data-id="${escapeHtml(r.id)}">Warn</button>
                           <button class="btn btn-ghost btn-sm grow" data-action="dismiss" data-id="${escapeHtml(r.id)}">Dismiss</button>
                         </div>`
                      : `<p class="tiny muted mt-1 mb-0">Resolution: ${escapeHtml(r.resolution || '—')}</p>`
                  }
                </div>`
              )
              .join('');

            list.querySelectorAll('[data-action]').forEach((button) =>
              button.addEventListener('click', async () => {
                setBusy(button, true, 'Saving…');
                try {
                  await adminApi.reviewReport(button.dataset.id, button.dataset.action);
                  toast('Report reviewed.', 'success');
                  load();
                } catch (error) {
                  toast(error.message, 'error');
                } finally {
                  setBusy(button, false);
                }
              })
            );
          }

          const flags = await adminApi.flags();
          flagList.innerHTML = `
            <h3 class="section-title">Automated flags <span class="muted tiny">(${flags.flags.length})</span></h3>
            ${
              flags.flags.length
                ? `<div class="stack-sm">${flags.flags
                    .map(
                      (f) => `
                      <div class="card" style="padding:.8rem">
                        <div class="row-between">
                          <strong class="small">${escapeHtml(f.displayName || f.qsId)}</strong>
                          <span class="badge ${f.severity === 'high' ? 'badge-pending' : 'badge-muted'}">${escapeHtml(f.severity)}</span>
                        </div>
                        <p class="tiny muted mt-0 mb-0">${escapeHtml(f.detail)}</p>
                        <p class="tiny muted mt-0 mb-0">${escapeHtml(f.kind)} · ${relativeTime(f.createdAt)}</p>
                      </div>`
                    )
                    .join('')}</div>`
                : `<div class="card small muted center">No open flags.</div>`
            }
          `;
        } catch (error) {
          list.innerHTML = `<div class="banner banner--danger">${escapeHtml(error.message)}</div>`;
        }
      }

      root.querySelectorAll('[data-filter]').forEach((button) =>
        button.addEventListener('click', () => {
          filter = button.dataset.filter;
          root.querySelectorAll('[data-filter]').forEach((b) => {
            b.className = b === button ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
          });
          load();
        })
      );
      root.querySelector('#refresh').addEventListener('click', load);
      await load();
    },
  };
}

/* --------------------------------------------------------------- photos --- */

export async function renderPhotos() {
  const html = shell(
    'Photo review',
    `
      <div class="banner banner--warn">
        No automated image analysis runs in this build. Every upload must be
        reviewed by a person before it is trusted.
      </div>
      <div id="photo-list"><div class="empty"><p>Loading…</p></div></div>
    `
  );

  return {
    html,
    async mount(root) {
      const list = root.querySelector('#photo-list');

      async function load() {
        list.innerHTML = `<div class="empty"><p>Loading…</p></div>`;
        try {
          const data = await adminApi.pendingPhotos();
          if (!data.photos.length) {
            list.innerHTML = emptyState('🖼️', 'Nothing to review', 'All uploaded photos have been moderated.');
            return;
          }
          list.innerHTML = `
            <p class="tiny muted">${data.photos.length} photo(s) awaiting review</p>
            <div class="stack-sm">
              ${data.photos
                .map(
                  (p) => `
                  <div class="card" style="padding:.9rem">
                    <div class="row">
                      <img src="${escapeHtml(p.url)}" alt="Uploaded photo"
                           style="width:76px;height:96px;object-fit:cover;border-radius:12px" />
                      <div class="grow">
                        <strong class="small">${escapeHtml(p.displayName || '—')}</strong>
                        <p class="tiny muted mt-0 mb-0">${escapeHtml(p.qsId)}</p>
                        <p class="tiny muted mt-0 mb-0">${escapeHtml(p.mime)} · ${Math.round(p.bytes / 1024)} KB</p>
                        <p class="tiny muted mt-0 mb-0">Uploaded ${relativeTime(p.createdAt)}</p>
                      </div>
                    </div>
                    <div class="row mt-1" style="gap:.4rem">
                      <button class="btn btn-success btn-sm grow" data-approve="${escapeHtml(p.id)}">Approve</button>
                      <button class="btn btn-danger btn-sm grow" data-reject="${escapeHtml(p.id)}">Reject</button>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          `;

          const moderate = async (id, decision, button) => {
            setBusy(button, true, 'Saving…');
            try {
              await adminApi.moderatePhoto(id, decision);
              toast(`Photo ${decision}d.`, 'success', 2200);
              load();
            } catch (error) {
              toast(error.message, 'error');
            } finally {
              setBusy(button, false);
            }
          };
          list.querySelectorAll('[data-approve]').forEach((b) =>
            b.addEventListener('click', () => moderate(b.dataset.approve, 'approve', b))
          );
          list.querySelectorAll('[data-reject]').forEach((b) =>
            b.addEventListener('click', () => moderate(b.dataset.reject, 'reject', b))
          );
        } catch (error) {
          list.innerHTML = `<div class="banner banner--danger">${escapeHtml(error.message)}</div>`;
        }
      }

      root.querySelector('#refresh').addEventListener('click', load);
      await load();
    },
  };
}
