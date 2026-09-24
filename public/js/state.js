/** In-memory app state. The server remains the source of truth. */
import { taxonomy as taxonomyApi } from './api.js';

const state = {
  user: null,
  profile: null,
  preferences: null,
  settings: null,
  contactMethods: [],
  unread: 0,
  taxonomy: null,
  capabilities: null,
  booted: false,
};

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
}

export function resetState() {
  state.user = null;
  state.profile = null;
  state.preferences = null;
  state.settings = null;
  state.contactMethods = [];
  state.unread = 0;
  state.taxonomy = null;
  state.booted = false;
}

/** Loads the server-owned vocabularies once and caches them. */
export async function ensureTaxonomy() {
  if (state.taxonomy) return state.taxonomy;
  state.taxonomy = await taxonomyApi.get();
  return state.taxonomy;
}

export function labelFor(kind, value) {
  const list = state.taxonomy?.[kind] || [];
  const found = list.find((item) => item.value === value);
  return found?.label || value;
}

export function emojiFor(kind, value) {
  const list = state.taxonomy?.[kind] || [];
  return list.find((item) => item.value === value)?.emoji || '';
}

export function countryLabel(code) {
  return labelFor('countries', code);
}

export function isAdmin() {
  return state.user?.role === 'admin';
}

export function needsProfileSetup() {
  return Boolean(state.user) && !state.profile?.setupComplete;
}
