/** Small DOM + UI helpers shared by every screen. */

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(name) {
  return String(name || '?')
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function avatar(profile, { size = '' } = {}) {
  const photo = profile?.photos?.[0]?.url;
  const cls = size === 'lg' ? 'avatar avatar--lg' : 'avatar';
  if (photo) return `<div class="${cls}"><img src="${photo}" alt="${escapeHtml(profile.displayName)}" /></div>`;
  return `<div class="${cls}">${escapeHtml(initials(profile?.displayName))}</div>`;
}

export function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/* ---------------------------------------------------------------- toast --- */

let toastTimers = 0;

export function toast(message, kind = 'info', duration = 4200) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const icons = { info: 'ℹ️', success: '✅', error: '⚠️', warn: '⚠️' };
  const node = el(`
    <div class="toast toast--${kind}" role="status">
      <span aria-hidden="true">${icons[kind] || icons.info}</span>
      <span>${escapeHtml(message)}</span>
    </div>
  `);
  region.appendChild(node);
  const id = ++toastTimers;
  node.dataset.toastId = String(id);
  setTimeout(() => {
    node.style.transition = 'opacity .2s ease, transform .2s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(-8px)';
    setTimeout(() => node.remove(), 220);
  }, duration);
}

/** Surfaces the server's own message rather than inventing one. */
export function showError(error, fallback = 'Something went wrong.') {
  const message = error?.message || fallback;
  toast(message, 'error', 6000);
  return message;
}

/** Turns a 422 details object into per-field messages. */
export function fieldErrors(error) {
  if (error?.status === 422 && error.details && typeof error.details === 'object') {
    return error.details;
  }
  return {};
}

/* ---------------------------------------------------------------- modal --- */

export function modal(title, bodyHtml, actions = []) {
  const region = document.getElementById('modal-region');
  region.innerHTML = '';
  const backdrop = el(`<div class="modal-backdrop" role="dialog" aria-modal="true"></div>`);
  const box = el(`
    <div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions stack-sm mt-2"></div>
    </div>
  `);
  const actionRow = box.querySelector('.modal-actions');
  const close = () => {
    region.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  for (const action of actions) {
    const button = el(
      `<button class="btn ${action.variant || 'btn-secondary'}">${escapeHtml(action.label)}</button>`
    );
    button.addEventListener('click', () => {
      if (action.onClick) action.onClick(close, button);
      else close();
    });
    actionRow.appendChild(button);
  }

  backdrop.appendChild(box);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  region.appendChild(backdrop);
  return { close, box };
}

export function closeModal() {
  document.getElementById('modal-region').innerHTML = '';
}

export function confirmDialog(title, bodyHtml, confirmLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    modal(title, bodyHtml, [
      {
        label: 'Cancel',
        variant: 'btn-ghost',
        onClick: (close) => {
          close();
          resolve(false);
        },
      },
      {
        label: confirmLabel,
        variant: danger ? 'btn-danger' : 'btn-primary',
        onClick: (close) => {
          close();
          resolve(true);
        },
      },
    ]);
  });
}

/* ---------------------------------------------------------------- misc ---- */

export function emptyState(icon, title, message, actionHtml = '') {
  return `
    <div class="empty">
      <div class="empty-icon" aria-hidden="true">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${actionHtml}
    </div>
  `;
}

export function setBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${escapeHtml(busyLabel)}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

export function renderChips(items, selected, { emoji = true } = {}) {
  const selectedSet = new Set(selected || []);
  return items
    .map(
      (item) => `
      <button type="button" class="chip ${selectedSet.has(item.value) ? 'is-selected' : ''}" data-value="${escapeHtml(item.value)}">
        ${emoji && item.emoji ? `<span aria-hidden="true">${item.emoji}</span>` : ''}
        <span>${escapeHtml(item.label)}</span>
      </button>`
    )
    .join('');
}
