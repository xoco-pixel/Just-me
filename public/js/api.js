/**
 * Thin API client.
 *
 * Every call hits the real backend. Responses are returned verbatim so the UI
 * can never claim success that the server did not confirm.
 */

const TOKEN_KEY = 'quicksense.token';
const QSID_KEY = 'quicksense.qsid';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function rememberQsId(qsId) {
  if (qsId) localStorage.setItem(QSID_KEY, qsId);
}

export function rememberedQsId() {
  return localStorage.getItem(QSID_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (networkError) {
    throw new ApiError(0, 'network_error', 'Could not reach QuickSense. Check your connection and try again.');
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(
      response.status,
      error.code || 'request_failed',
      error.message || `Request failed (${response.status}).`,
      error.details ?? null
    );
  }
  return payload;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  put: (path, body, options) => request('PUT', path, body ?? {}, options),
  del: (path, body, options) => request('DELETE', path, body ?? {}, options),
};

/* ------------------------------------------------------------------ API --- */

export const auth = {
  register: () => api.post('/api/auth/register'),
  restore: (token) => api.post('/api/auth/restore', { token }),
  recover: (identifier, code) => api.post('/api/auth/recover', { identifier, code }),
  login: (identifier, password) => api.post('/api/auth/login', { identifier, password }),
  me: () => api.get('/api/auth/me'),
  logout: () => api.post('/api/auth/logout'),
  recoveryCode: (email) => api.post('/api/auth/recovery-code', { email }),
  setPassword: (password, currentPassword) =>
    api.post('/api/auth/password', { password, currentPassword }),
  deleteAccount: () => api.del('/api/auth/account', { confirm: 'DELETE' }),
};

export const profile = {
  get: () => api.get('/api/profile'),
  save: (data) => api.put('/api/profile', data),
  view: (userId) => api.get(`/api/users/${userId}`),
  addContact: (data) => api.post('/api/profile/contact-methods', data),
  updateContact: (id, data) => api.put(`/api/profile/contact-methods/${id}`, data),
  deleteContact: (id) => api.del(`/api/profile/contact-methods/${id}`),
  addPhoto: (dataUrl) => api.post('/api/profile/photos', { dataUrl }),
  deletePhoto: (id) => api.del(`/api/profile/photos/${id}`),
  reorderPhotos: (orderedIds) => api.post('/api/profile/photos/reorder', { orderedIds }),
};

export const preferences = {
  get: () => api.get('/api/preferences'),
  save: (data) => api.put('/api/preferences', data),
};

export const matches = {
  find: () => api.post('/api/matches/find'),
  all: () => api.get('/api/matches'),
  potential: () => api.get('/api/matches/potential'),
  mutual: () => api.get('/api/matches/mutual'),
  refresh: () => api.post('/api/matches/refresh'),
  act: (userId, action) => api.post(`/api/matches/${userId}/action`, { action }),
};

export const exchange = {
  list: () => api.get('/api/exchange'),
  request: (recipientId) => api.post('/api/exchange/request', { recipientId }),
  respond: (id, action) => api.post(`/api/exchange/${id}/respond`, { action }),
  get: (id) => api.get(`/api/exchange/${id}`),
  details: (id) => api.get(`/api/exchange/${id}/details`),
  mine: () => api.get('/api/exchange/shareable/mine'),
};

export const notifications = {
  list: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/api/notifications${query ? `?${query}` : ''}`);
  },
  read: (id) => api.post(`/api/notifications/${id}/read`),
  readAll: () => api.post('/api/notifications/read-all'),
  preferences: () => api.get('/api/notifications/preferences'),
  savePreferences: (data) => api.put('/api/notifications/preferences', data),
};

export const safety = {
  summary: () => api.get('/api/safety/summary'),
  blocks: () => api.get('/api/safety/blocks'),
  block: (userId, reason) => api.post('/api/safety/block', { userId, reason }),
  unblock: (userId) => api.del(`/api/safety/block/${userId}`),
  report: (userId, category, description) =>
    api.post('/api/safety/report', { userId, category, description }),
  status: (userId) => api.get(`/api/safety/status/${userId}`),
};

export const settings = {
  get: () => api.get('/api/settings'),
  save: (data) => api.put('/api/settings', data),
  saveVisibility: (data) => api.put('/api/settings/visibility', data),
};

export const taxonomy = {
  get: () => api.get('/api/taxonomy'),
};

export const admin = {
  overview: () => api.get('/api/admin/overview'),
  users: (params = {}) => api.get(`/api/admin/users?${new URLSearchParams(params)}`),
  setStatus: (id, status, note) => api.post(`/api/admin/users/${id}/status`, { status, note }),
  reports: (status) => api.get(`/api/admin/reports${status ? `?status=${status}` : ''}`),
  reviewReport: (id, action, note) => api.post(`/api/admin/reports/${id}/review`, { action, note }),
  flags: () => api.get('/api/admin/flags'),
  pendingPhotos: () => api.get('/api/admin/photos/pending'),
  moderatePhoto: (id, decision) => api.post(`/api/admin/photos/${id}/moderate`, { decision }),
  securityLog: () => api.get('/api/admin/security-log'),
};

export const system = {
  health: () => api.get('/api/health'),
  capabilities: () => api.get('/api/capabilities'),
};
