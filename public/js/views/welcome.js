/** Welcome screen: create a profile, or restore an existing QuickSense. */
import { auth, system } from '../api.js';
import { getState, setState, ensureTaxonomy, resetState } from '../state.js';
import { setToken, rememberQsId, rememberedQsId, clearSession, ApiError } from '../api.js';
import { el, escapeHtml, toast, modal, setBusy } from '../ui.js';

export async function render() {
  const state = getState();
  const capabilities = state.capabilities;
  const savedQsId = rememberedQsId();

  // If a token exists locally, try it first — that is the "delete and reinstall"
  // experience the product promises, backed by a real server session.
  let canRestore = Boolean(localStorage.getItem('quicksense.token'));

  const html = `
    <div class="hero">
      <div>
        <div class="hero-mark" aria-hidden="true">💜</div>
        <h1>QuickSense</h1>
        <p class="hero-tagline">Meet people who make sense for you.</p>
      </div>

      <p class="hero-copy">
        Tell us about yourself and who you're looking for. QuickSense finds compatible
        people based on your preferences — and explains <strong>why</strong> you matched.
        Contact details are only ever shared when you both agree.
      </p>

      <div class="hero-actions">
        <button class="btn btn-primary" id="btn-create">Create My Profile</button>
        ${
          canRestore
            ? `<button class="btn btn-secondary" id="btn-restore-device">
                 Restore My QuickSense${savedQsId ? ` · ${escapeHtml(savedQsId)}` : ''}
               </button>`
            : ''
        }
        <button class="btn btn-ghost" id="btn-restore-code">I have a recovery code</button>
      </div>

      <p class="hero-foot">
        Strictly ${capabilities?.minimumAge || 18}+. No swiping for the sake of swiping.
      </p>
    </div>
  `;

  return {
    html,
    mount(root) {
      const createBtn = root.querySelector('#btn-create');
      const restoreBtn = root.querySelector('#btn-restore-device');
      const codeBtn = root.querySelector('#btn-restore-code');

      createBtn.addEventListener('click', async () => {
        setBusy(createBtn, true, 'Creating…');
        try {
          const account = await auth.register();
          setToken(account.token);
          rememberQsId(account.qsId);
          setState({ user: { userId: account.userId, qsId: account.qsId, role: 'user' }, profile: null });
          await ensureTaxonomy();
          window.location.hash = '#/setup';
          toast(`Welcome! Your QuickSense ID is ${account.qsId}`, 'success', 8000);
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          setBusy(createBtn, false);
        }
      });

      restoreBtn?.addEventListener('click', async () => {
        const token = localStorage.getItem('quicksense.token');
        setBusy(restoreBtn, true, 'Restoring…');
        try {
          const restored = await auth.restore(token);
          setToken(restored.token);
          rememberQsId(restored.qsId);
          const me = await auth.me();
          setState({
            user: me.user,
            profile: me.profile,
            preferences: me.preferences,
            settings: me.settings,
            unread: me.notifications?.unread ?? 0,
          });
          await ensureTaxonomy();
          window.location.hash = me.setupComplete ? '#/match' : '#/setup';
          toast('Your QuickSense was restored.', 'success');
        } catch (error) {
          toast(error.message, 'error');
          localStorage.removeItem('quicksense.token');
        } finally {
          setBusy(restoreBtn, false);
        }
      });

      codeBtn.addEventListener('click', () => {
        modal(
          'Restore My QuickSense',
          `
          <p class="small muted mb-2">
            Enter your QuickSense ID or the email you linked, plus the recovery code
            you saved when you created your profile.
          </p>
          <div class="stack">
            <div class="field">
              <label for="restore-id">QuickSense ID or email</label>
              <input class="input" id="restore-id" placeholder="QS-7F29K4 or you@example.com" autocomplete="username" />
            </div>
            <div class="field">
              <label for="restore-code">Recovery code</label>
              <input class="input" id="restore-code" placeholder="QS-XXXX-XXXX-XXXX" autocomplete="one-time-code" />
            </div>
            <p class="field-hint" id="restore-error"></p>
          </div>
        `,
          [
            { label: 'Cancel', variant: 'btn-ghost' },
            {
              label: 'Restore',
              variant: 'btn-primary',
              onClick: async (close, button) => {
                const identifier = document.getElementById('restore-id').value.trim();
                const code = document.getElementById('restore-code').value.trim();
                const errorEl = document.getElementById('restore-error');
                if (!identifier || !code) {
                  errorEl.textContent = 'Both fields are required.';
                  return;
                }
                setBusy(button, true, 'Restoring…');
                try {
                  const restored = await auth.recover(identifier, code);
                  setToken(restored.token);
                  rememberQsId(restored.qsId);
                  const me = await auth.me();
                  setState({
                    user: me.user,
                    profile: me.profile,
                    preferences: me.preferences,
                    settings: me.settings,
                    unread: me.notifications?.unread ?? 0,
                  });
                  await ensureTaxonomy();
                  close();
                  window.location.hash = me.setupComplete ? '#/match' : '#/setup';
                  toast('Your QuickSense was restored.', 'success');
                  window.location.reload();
                } catch (error) {
                  errorEl.textContent = error.message;
                } finally {
                  setBusy(button, false);
                }
              },
            },
          ]
        );
      });
    },
  };
}
