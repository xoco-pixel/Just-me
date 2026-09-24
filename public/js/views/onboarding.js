/**
 * Multi-step profile setup.
 *
 * Writes to the backend only when a step is submitted, and only reports success
 * when the server confirms it. Photos are uploaded one at a time and stored
 * server-side before the UI shows them.
 */
import { profile as profileApi, preferences as prefsApi, taxonomy as taxonomyApi } from '../api.js';
import { getState, setState } from '../state.js';
import { el, escapeHtml, toast, modal, setBusy, avatar } from '../ui.js';
import { go } from '../app.js';

const STEPS = ['photos', 'about', 'interests', 'intentions', 'preferences'];

const draft = {
  photos: [],
  displayName: '',
  dateOfBirth: '',
  gender: '',
  country: '',
  city: '',
  bio: '',
  interests: [],
  languages: [],
  intentions: [],
  prefs: { ageMin: 18, ageMax: 40, genders: [], intentions: [], interests: [], searchMode: 'worldwide', radiusKm: 100, countries: [] },
};

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export async function render() {
  const state = getState();
  const tax = state.taxonomy;
  if (state.profile?.dateOfBirth) {
    draft.dateOfBirth = state.profile.dateOfBirth;
    draft.displayName = state.profile.displayName || '';
    draft.gender = state.profile.gender || '';
    draft.country = state.profile.country || '';
    draft.city = state.profile.city || '';
    draft.bio = state.profile.bio || '';
    draft.interests = [...(state.profile.interests || [])];
    draft.languages = [...(state.profile.languages || [])];
    draft.intentions = [...(state.profile.intentions || [])];
    draft.photos = (state.profile.photos || []).map((p) => ({ id: p.id, url: p.url }));
  }

  let stepIndex = 0;

  const html = `
    <div class="screen screen--plain">
      <div class="progress" id="progress"></div>
      <div class="container" id="step-container"></div>
    </div>
  `;

  return {
    html,
    mount(root) {
      const container = root.querySelector('#step-container');
      const progress = root.querySelector('#progress');

      function drawProgress() {
        progress.innerHTML = STEPS.map((_, index) => {
          const done = index < stepIndex;
          const active = index === stepIndex;
          return `<div class="progress-bar ${done ? 'is-done' : ''}">
            <span style="width:${active ? '100%' : '0'}"></span>
          </div>`;
        }).join('');
      }

      function next() {
        if (stepIndex < STEPS.length - 1) {
          stepIndex += 1;
          drawStep();
        }
      }
      function back() {
        if (stepIndex > 0) {
          stepIndex -= 1;
          drawStep();
        }
      }

      /* ------------------------------------------------------------ step 1 */
      function stepPhotos() {
        container.innerHTML = `
          <h2 class="step-title">Add your photos</h2>
          <p class="step-sub">Up to 6 photos. The first one is your main profile photo.</p>
          <div class="photo-grid" id="photo-grid"></div>
          <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" class="sr-only" />
          <p class="field-hint mt-1" id="photo-status"></p>
          <div class="stack mt-2">
            <button class="btn btn-primary" id="next">Continue</button>
            <button class="btn btn-ghost btn-sm" id="skip">Skip for now</button>
          </div>
        `;

        const grid = root.querySelector('#photo-grid');
        const input = root.querySelector('#photo-input');
        const status = root.querySelector('#photo-status');

        function drawPhotos() {
          const tiles = draft.photos
            .map(
              (photo, index) => `
              <div class="photo-tile ${index === 0 ? 'is-primary' : ''}">
                <img src="${photo.url}" alt="Photo ${index + 1}" />
                <button class="photo-remove" data-remove="${photo.id}" aria-label="Remove photo">✕</button>
                ${index === 0 ? '<span class="photo-badge">Main</span>' : ''}
              </div>`
            )
            .join('');
          const addTile =
            draft.photos.length < 6
              ? `<button class="photo-tile" id="add-photo" type="button">＋</button>`
              : '';
          grid.innerHTML = tiles + addTile;

          grid.querySelectorAll('[data-remove]').forEach((button) =>
            button.addEventListener('click', async (event) => {
              const id = event.currentTarget.dataset.remove;
              try {
                await profileApi.deletePhoto(id);
                draft.photos = draft.photos.filter((p) => p.id !== id);
                drawPhotos();
                toast('Photo removed.', 'success', 2200);
              } catch (error) {
                toast(error.message, 'error');
              }
            })
          );
          const addBtn = grid.querySelector('#add-photo');
          addBtn?.addEventListener('click', () => input.click());
        }

        input.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) {
            status.textContent = 'That photo is over 5 MB. Choose a smaller image.';
            return;
          }
          status.textContent = 'Uploading…';
          try {
            const dataUrl = await readFileAsDataUrl(file);
            const saved = await profileApi.addPhoto(dataUrl);
            draft.photos.push({ id: saved.photo.id, url: saved.photo.url });
            drawPhotos();
            status.textContent = 'Photo uploaded. It stays visible only after it passes review.';
          } catch (error) {
            // The server explains why (wrong type, disguised file, too large).
            status.textContent = error.message;
            toast(error.message, 'error');
          } finally {
            input.value = '';
          }
        });

        drawPhotos();

        root.querySelector('#next').addEventListener('click', next);
        root.querySelector('#skip').addEventListener('click', () => {
          if (draft.photos.length === 0) toast('You can add photos later from your profile.', 'info');
          next();
        });
      }

      /* ------------------------------------------------------------ step 2 */
      function stepAbout() {
        container.innerHTML = `
          <h2 class="step-title">About you</h2>
          <p class="step-sub">QuickSense is strictly 18+. Your date of birth sets your age.</p>
          <div class="stack">
            <div class="field">
              <label for="displayName">Display name</label>
              <input class="input" id="displayName" value="${escapeHtml(draft.displayName)}" placeholder="How should people see you?" maxlength="40" />
              <p class="field-error" data-error="displayName"></p>
            </div>
            <div class="field">
              <label for="dateOfBirth">Date of birth</label>
              <input class="input" id="dateOfBirth" type="date" value="${escapeHtml(draft.dateOfBirth)}" max="${new Date().toISOString().slice(0, 10)}" />
              <p class="field-hint">You must be 18 or older to use QuickSense.</p>
              <p class="field-error" data-error="dateOfBirth"></p>
            </div>
            <div class="field">
              <label for="gender">Gender</label>
              <select class="select" id="gender">
                <option value="">Select…</option>
                ${tax.genders.map((g) => `<option value="${g.value}" ${draft.gender === g.value ? 'selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
              </select>
              <p class="field-error" data-error="gender"></p>
            </div>
            <div class="field">
              <label for="country">Country</label>
              <select class="select" id="country">
                <option value="">Select…</option>
                ${tax.countries.map((c) => `<option value="${c.value}" ${draft.country === c.value ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
              </select>
              <p class="field-error" data-error="country"></p>
            </div>
            <div class="field">
              <label for="city">City or region <span class="muted tiny">(optional)</span></label>
              <input class="input" id="city" value="${escapeHtml(draft.city)}" placeholder="e.g. Port Harcourt" maxlength="80" />
              <p class="field-hint">Only a general area is shown to others — never your exact address.</p>
              <p class="field-error" data-error="city"></p>
            </div>
            <div class="field">
              <label for="bio">Short bio <span class="muted tiny">(optional)</span></label>
              <textarea class="textarea" id="bio" maxlength="500" placeholder="A few honest sentences about you.">${escapeHtml(draft.bio)}</textarea>
              <p class="field-error" data-error="bio"></p>
            </div>
          </div>

          <div class="row mt-2">
            <button class="btn btn-ghost btn-sm" id="back">Back</button>
            <button class="btn btn-primary grow" id="next">Continue</button>
          </div>
        `;

        root.querySelector('#back').addEventListener('click', back);
        root.querySelector('#next').addEventListener('click', async (event) => {
          draft.displayName = root.querySelector('#displayName').value.trim();
          draft.dateOfBirth = root.querySelector('#dateOfBirth').value;
          draft.gender = root.querySelector('#gender').value;
          draft.country = root.querySelector('#country').value;
          draft.city = root.querySelector('#city').value.trim();
          draft.bio = root.querySelector('#bio').value.trim();

          // Client-side sanity check only; the server does the real validation.
          const problems = {};
          if (draft.displayName.length < 2) problems.displayName = 'Add a display name.';
          if (!draft.dateOfBirth) problems.dateOfBirth = 'Add your date of birth.';
          else {
            const age = ageFrom(draft.dateOfBirth);
            if (age < 18) problems.dateOfBirth = 'QuickSense is strictly 18+.';
          }
          if (!draft.gender) problems.gender = 'Select your gender.';
          if (!draft.country) problems.country = 'Select your country.';

          container.querySelectorAll('.field-error').forEach((node) => (node.textContent = ''));
          if (Object.keys(problems).length) {
            for (const [field, message] of Object.entries(problems)) {
              const node = container.querySelector(`[data-error="${field}"]`);
              if (node) node.textContent = message;
            }
            return;
          }
          next();
        });
      }

      /* ------------------------------------------------------------ step 3 */
      function stepInterests() {
        container.innerHTML = `
          <h2 class="step-title">What are you into?</h2>
          <p class="step-sub">Pick at least 3. These drive your compatibility score.</p>
          <div class="search-input mb-2">
            <input class="input" id="interest-search" placeholder="Search interests…" />
          </div>
          <div class="chip-group" id="interest-chips"></div>
          <p class="field-hint mt-1">Selected: <strong id="interest-count">${draft.interests.length}</strong></p>

          <h3 class="section-title">Languages you speak <span class="muted tiny">(optional)</span></h3>
          <div class="chip-group" id="language-chips"></div>

          <div class="row mt-2">
            <button class="btn btn-ghost btn-sm" id="back">Back</button>
            <button class="btn btn-primary grow" id="next">Continue</button>
          </div>
        `;

        const chipBox = root.querySelector('#interest-chips');
        const langBox = root.querySelector('#language-chips');
        const count = root.querySelector('#interest-count');
        const search = root.querySelector('#interest-search');

        function drawChips(filter = '') {
          const term = filter.trim().toLowerCase();
          const shown = tax.interests.filter((item) => item.label.toLowerCase().includes(term));
          chipBox.innerHTML = shown
            .map(
              (item) => `
              <button type="button" class="chip ${draft.interests.includes(item.value) ? 'is-selected' : ''}" data-value="${item.value}">
                <span aria-hidden="true">${item.emoji}</span><span>${escapeHtml(item.label)}</span>
              </button>`
            )
            .join('');
          chipBox.querySelectorAll('.chip').forEach((chip) =>
            chip.addEventListener('click', () => {
              const value = chip.dataset.value;
              draft.interests = draft.interests.includes(value)
                ? draft.interests.filter((v) => v !== value)
                : [...draft.interests, value];
              count.textContent = String(draft.interests.length);
              drawChips(search.value);
            })
          );
        }

        function drawLanguages() {
          langBox.innerHTML = tax.languages
            .map(
              (item) => `
              <button type="button" class="chip ${draft.languages.includes(item.value) ? 'is-selected' : ''}" data-value="${item.value}">
                <span>${escapeHtml(item.label)}</span>
              </button>`
            )
            .join('');
          langBox.querySelectorAll('.chip').forEach((chip) =>
            chip.addEventListener('click', () => {
              const value = chip.dataset.value;
              draft.languages = draft.languages.includes(value)
                ? draft.languages.filter((v) => v !== value)
                : [...draft.languages, value];
              drawLanguages();
            })
          );
        }

        search.addEventListener('input', () => drawChips(search.value));
        drawChips();
        drawLanguages();

        root.querySelector('#back').addEventListener('click', back);
        root.querySelector('#next').addEventListener('click', () => {
          if (draft.interests.length < 3) {
            toast('Pick at least 3 interests so matching has something to work with.', 'warn');
            return;
          }
          next();
        });
      }

      /* ------------------------------------------------------------ step 4 */
      function stepIntentions() {
        container.innerHTML = `
          <h2 class="step-title">What are you looking for?</h2>
          <p class="step-sub">Choose everything that applies. Matching needs mutual intent.</p>
          <div class="chip-group" id="intention-chips"></div>
          <div class="row mt-2">
            <button class="btn btn-ghost btn-sm" id="back">Back</button>
            <button class="btn btn-primary grow" id="next">Continue</button>
          </div>
        `;

        const box = root.querySelector('#intention-chips');
        function draw() {
          box.innerHTML = tax.intentions
            .map(
              (item) => `
              <button type="button" class="chip ${draft.intentions.includes(item.value) ? 'is-selected' : ''}" data-value="${item.value}" style="padding:.7rem 1rem">
                <span aria-hidden="true">${item.emoji}</span><span>${escapeHtml(item.label)}</span>
              </button>`
            )
            .join('');
          box.querySelectorAll('.chip').forEach((chip) =>
            chip.addEventListener('click', () => {
              const value = chip.dataset.value;
              draft.intentions = draft.intentions.includes(value)
                ? draft.intentions.filter((v) => v !== value)
                : [...draft.intentions, value];
              draw();
            })
          );
        }
        draw();

        root.querySelector('#back').addEventListener('click', back);
        root.querySelector('#next').addEventListener('click', () => {
          if (draft.intentions.length < 1) {
            toast('Choose at least one thing you are looking for.', 'warn');
            return;
          }
          next();
        });
      }

      /* ------------------------------------------------------------ step 5 */
      function stepPreferences() {
        const age = ageFrom(draft.dateOfBirth) || 22;
        if (!draft.prefs.ageMin) draft.prefs.ageMin = Math.max(18, age - 5);
        if (!draft.prefs.ageMax) draft.prefs.ageMax = Math.min(100, age + 12);
        draft.prefs.intentions = [...draft.intentions];

        container.innerHTML = `
          <h2 class="step-title">Who should QuickSense find? 🌎</h2>
          <p class="step-sub">You can change all of this later in Settings.</p>

          <div class="card stack">
            <div>
              <p class="label mb-1">Age range</p>
              <div class="age-row">
                <div class="field">
                  <input class="input" type="number" id="ageMin" min="18" max="100" value="${draft.prefs.ageMin}" />
                  <p class="field-hint">Minimum</p>
                </div>
                <div class="field">
                  <input class="input" type="number" id="ageMax" min="18" max="100" value="${draft.prefs.ageMax}" />
                  <p class="field-hint">Maximum</p>
                </div>
              </div>
              <p class="field-error" data-error="ageMax"></p>
            </div>

            <div>
              <p class="label mb-1">Interested in <span class="muted tiny">(leave empty for anyone)</span></p>
              <div class="chip-group" id="gender-chips"></div>
            </div>

            <div>
              <p class="label mb-1">Where should we search?</p>
              <div class="chip-group" id="mode-chips"></div>
            </div>

            <div id="mode-extra"></div>
          </div>

          <div class="row mt-2">
            <button class="btn btn-ghost btn-sm" id="back">Back</button>
            <button class="btn btn-primary grow" id="finish">Find My Match ❤️</button>
          </div>
        `;

        const genderBox = root.querySelector('#gender-chips');
        const modeBox = root.querySelector('#mode-chips');
        const extra = root.querySelector('#mode-extra');

        function drawGenders() {
          genderBox.innerHTML = tax.genders
            .map(
              (g) => `<button type="button" class="chip ${draft.prefs.genders.includes(g.value) ? 'is-selected' : ''}" data-value="${g.value}">${escapeHtml(g.label)}</button>`
            )
            .join('');
          genderBox.querySelectorAll('.chip').forEach((chip) =>
            chip.addEventListener('click', () => {
              const value = chip.dataset.value;
              draft.prefs.genders = draft.prefs.genders.includes(value)
                ? draft.prefs.genders.filter((v) => v !== value)
                : [...draft.prefs.genders, value];
              drawGenders();
            })
          );
        }

        const MODES = [
          { value: 'worldwide', label: 'Worldwide', emoji: '🌎' },
          { value: 'countries', label: 'Selected countries', emoji: '🌍' },
          { value: 'country', label: 'My country', emoji: '🗺️' },
          { value: 'city', label: 'My city', emoji: '🏙️' },
          { value: 'radius', label: 'Custom radius', emoji: '🎯' },
        ];

        function drawModes() {
          modeBox.innerHTML = MODES.map(
            (m) =>
              `<button type="button" class="chip ${draft.prefs.searchMode === m.value ? 'is-selected' : ''}" data-value="${m.value}"><span aria-hidden="true">${m.emoji}</span><span>${escapeHtml(m.label)}</span></button>`
          ).join('');
          modeBox.querySelectorAll('.chip').forEach((chip) =>
            chip.addEventListener('click', () => {
              draft.prefs.searchMode = chip.dataset.value;
              drawModes();
              drawExtra();
            })
          );
        }

        function drawExtra() {
          if (draft.prefs.searchMode === 'countries') {
            extra.innerHTML = `
              <div>
                <p class="label mb-1">Select countries</p>
                <div class="search-input mb-1">
                  <input class="input" id="country-search" placeholder="Search countries…" />
                </div>
                <div class="chip-group" id="country-chips" style="max-height:190px;overflow-y:auto"></div>
                <p class="field-error" data-error="countries"></p>
              </div>
            `;
            const search = root.querySelector('#country-search');
            const chips = root.querySelector('#country-chips');
            const draw = () => {
              const term = search.value.trim().toLowerCase();
              chips.innerHTML = tax.countries
                .filter((c) => c.label.toLowerCase().includes(term))
                .map(
                  (c) =>
                    `<button type="button" class="chip ${draft.prefs.countries.includes(c.value) ? 'is-selected' : ''}" data-value="${c.value}">${escapeHtml(c.label)}</button>`
                )
                .join('');
              chips.querySelectorAll('.chip').forEach((chip) =>
                chip.addEventListener('click', () => {
                  const value = chip.dataset.value;
                  draft.prefs.countries = draft.prefs.countries.includes(value)
                    ? draft.prefs.countries.filter((v) => v !== value)
                    : [...draft.prefs.countries, value];
                  draw();
                })
              );
            };
            search.addEventListener('input', draw);
            draw();
          } else if (draft.prefs.searchMode === 'radius') {
            extra.innerHTML = `
              <div class="field">
                <label for="radius">Search radius</label>
                <select class="select" id="radius">
                  ${tax.radiusOptions
                    .map((r) => `<option value="${r}" ${draft.prefs.radiusKm === r ? 'selected' : ''}>${r} km</option>`)
                    .join('')}
                </select>
                <p class="field-hint">Distance search needs your approximate location. We never share your exact address.</p>
              </div>
            `;
            root.querySelector('#radius').addEventListener('change', (event) => {
              draft.prefs.radiusKm = Number(event.target.value);
            });
          } else {
            extra.innerHTML = '';
          }
        }

        drawGenders();
        drawModes();
        drawExtra();

        root.querySelector('#back').addEventListener('click', back);
        root.querySelector('#finish').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          draft.prefs.ageMin = Number(root.querySelector('#ageMin').value);
          draft.prefs.ageMax = Number(root.querySelector('#ageMax').value);
          if (draft.prefs.ageMin > draft.prefs.ageMax) {
            container.querySelector('[data-error="ageMax"]').textContent =
              'Maximum age must not be lower than minimum age.';
            return;
          }
          setBusy(button, true, 'Saving…');
          try {
            const saved = await profileApi.save({
              displayName: draft.displayName,
              dateOfBirth: draft.dateOfBirth,
              gender: draft.gender,
              country: draft.country,
              city: draft.city,
              bio: draft.bio,
              interests: draft.interests,
              languages: draft.languages,
              intentions: draft.intentions,
            });
            setState({ profile: saved.profile });
            await prefsApi.save({
              ageMin: draft.prefs.ageMin,
              ageMax: draft.prefs.ageMax,
              genders: draft.prefs.genders,
              intentions: draft.prefs.intentions,
              interests: draft.prefs.interests,
              languages: draft.languages,
              searchMode: draft.prefs.searchMode,
              radiusKm: draft.prefs.radiusKm,
              countries: draft.prefs.countries,
              city: draft.city || null,
              country: draft.country,
            });
            toast('Profile saved. Finding your matches…', 'success');
            window.location.hash = '#/match';
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            setBusy(button, false);
          }
        });
      }

      function drawStep() {
        drawProgress();
        const renderers = [stepPhotos, stepAbout, stepInterests, stepIntentions, stepPreferences];
        renderers[stepIndex]();
        window.scrollTo({ top: 0 });
      }

      drawStep();
    },
  };
}

function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}
