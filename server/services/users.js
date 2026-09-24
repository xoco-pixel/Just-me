/** User/profile/preferences repositories and participant shaping for the engine. */
import { all, get, run, transaction } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { ageFromDob, newId, nowIso, parseJson } from '../lib/util.js';

export function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export function getUserByQsId(qsId) {
  return get('SELECT * FROM users WHERE qs_id = ?', [String(qsId).toUpperCase()]);
}

export function getUserByEmail(email) {
  return get('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
}

export function getProfile(userId) {
  return get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
}

export function getPreferences(userId) {
  return get('SELECT * FROM preferences WHERE user_id = ?', [userId]);
}

export function getPhotos(userId) {
  return all('SELECT * FROM photos WHERE user_id = ? ORDER BY position, created_at', [userId]);
}

export function getContactMethods(userId) {
  return all('SELECT * FROM contact_methods WHERE user_id = ? ORDER BY created_at', [userId]);
}

export function getUserSettings(user) {
  return {
    profileVisibility: 'public',
    showInSearch: true,
    notifyNewMatch: true,
    notifyProfileView: true,
    notifyContactRequest: true,
    notifyMutualMatch: true,
    notifyExchangeUnlocked: true,
    notifySafety: true,
    ...parseJson(user?.settings, {}),
  };
}

/**
 * Shapes a stored user into the participant object the matching engine expects.
 * All values come from the database — the client never supplies compatibility input.
 */
export function toParticipant(userId) {
  const user = getUserById(userId);
  if (!user) return null;
  const profile = getProfile(userId);
  const prefs = getPreferences(userId);
  if (!profile || !prefs) return null;
  return {
    userId: user.id,
    status: user.status,
    isDemo: Boolean(user.is_demo),
    lastSeenAt: user.last_seen_at,
    createdAt: user.created_at,
    profile: {
      userId: user.id,
      displayName: profile.display_name,
      age: profile.age,
      gender: profile.gender,
      country: profile.country,
      countryName: profile.country_name,
      city: profile.city,
      latitude: profile.latitude,
      longitude: profile.longitude,
      interests: parseJson(profile.interests, []),
      languages: parseJson(profile.languages, []),
      intentions: parseJson(profile.intentions, []),
      status: user.status,
    },
    preferences: {
      ageMin: prefs.age_min,
      ageMax: prefs.age_max,
      genders: parseJson(prefs.genders, []),
      intentions: parseJson(prefs.intentions, []),
      interests: parseJson(prefs.interests, []),
      languages: parseJson(prefs.languages, []),
      searchMode: prefs.search_mode,
      radiusKm: prefs.radius_km,
      countries: parseJson(prefs.countries, []),
      city: prefs.city,
      country: prefs.country,
      latitude: prefs.latitude,
      longitude: prefs.longitude,
      extra: parseJson(prefs.extra, {}),
    },
  };
}

/** Age is always recomputed from date of birth; the stored value is refreshed. */
export function refreshAge(userId) {
  const profile = getProfile(userId);
  if (!profile) return null;
  const age = ageFromDob(profile.date_of_birth);
  if (age !== profile.age) {
    run('UPDATE profiles SET age = ?, updated_at = ? WHERE user_id = ?', [age, nowIso(), userId]);
  }
  return age;
}

export function touchLastSeen(userId) {
  run('UPDATE users SET last_seen_at = ? WHERE id = ?', [nowIso(), userId]);
}

export function createUser({ id, qsId, email = null, passwordHash = null, role = 'user', isDemo = 0 }) {
  const now = nowIso();
  return transaction(() => {
    run(
      `INSERT INTO users (id, qs_id, email, password_hash, role, status, is_demo, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, '{}', ?, ?)`,
      [id, qsId, email, passwordHash, role, isDemo, now, now]
    );
    return getUserById(id);
  });
}

/** Creates the profile + preferences rows for a user. Returns nothing. */
export function createProfileRows(userId, profileInput, preferenceInput) {
  const now = nowIso();
  transaction(() => {
    run(
      `INSERT INTO profiles (user_id, display_name, date_of_birth, age, gender, bio, country, country_name, city,
        region, latitude, longitude, location_precision, interests, languages, intentions, visibility,
        setup_complete, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        profileInput.displayName,
        profileInput.dateOfBirth,
        profileInput.age,
        profileInput.gender,
        profileInput.bio ?? '',
        profileInput.country,
        profileInput.countryName ?? '',
        profileInput.city ?? '',
        profileInput.region ?? '',
        profileInput.latitude ?? null,
        profileInput.longitude ?? null,
        profileInput.locationPrecision ?? 'city',
        JSON.stringify(profileInput.interests ?? []),
        JSON.stringify(profileInput.languages ?? []),
        JSON.stringify(profileInput.intentions ?? []),
        JSON.stringify(profileInput.visibility ?? {}),
        profileInput.setupComplete ? 1 : 0,
        now,
        now,
      ]
    );
    run(
      `INSERT INTO preferences (user_id, age_min, age_max, genders, intentions, interests, languages, search_mode,
        radius_km, countries, city, country, latitude, longitude, extra, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        preferenceInput.ageMin,
        preferenceInput.ageMax,
        JSON.stringify(preferenceInput.genders ?? []),
        JSON.stringify(preferenceInput.intentions ?? []),
        JSON.stringify(preferenceInput.interests ?? []),
        JSON.stringify(preferenceInput.languages ?? []),
        preferenceInput.searchMode ?? 'worldwide',
        preferenceInput.radiusKm ?? 100,
        JSON.stringify(preferenceInput.countries ?? []),
        preferenceInput.city ?? null,
        preferenceInput.country ?? null,
        preferenceInput.latitude ?? null,
        preferenceInput.longitude ?? null,
        JSON.stringify(preferenceInput.extra ?? {}),
        now,
      ]
    );
  });
}

/** Public shape of a profile. Never includes contact details or private fields. */
export function publicProfile(userId, { includePrivate = false } = {}) {
  const user = getUserById(userId);
  const profile = getProfile(userId);
  if (!user || !profile) return null;
  const photos = getPhotos(userId).map((photo) => ({
    id: photo.id,
    url: `/api/photos/${photo.id}/file`,
    position: photo.position,
    moderationStatus: photo.moderation_status,
  }));
  const visibility = parseJson(profile.visibility, {});
  const isVisible = (field) => includePrivate || visibility[field] !== false;

  const base = {
    userId: user.id,
    qsId: user.qs_id,
    isDemo: Boolean(user.is_demo),
    displayName: profile.display_name,
    age: profile.age,
    gender: isVisible('gender') ? profile.gender : null,
    country: profile.country,
    countryName: profile.country_name || profile.country,
    city: isVisible('city') ? profile.city : '',
    region: isVisible('region') ? profile.region : '',
    interests: isVisible('interests') ? parseJson(profile.interests, []) : [],
    languages: isVisible('languages') ? parseJson(profile.languages, []) : [],
    intentions: isVisible('intentions') ? parseJson(profile.intentions, []) : [],
    photos,
    createdAt: profile.created_at,
  };
  if (isVisible('bio')) base.bio = profile.bio;
  if (includePrivate) {
    base.dateOfBirth = profile.date_of_birth;
    base.latitude = profile.latitude;
    base.longitude = profile.longitude;
    base.visibility = visibility;
    base.setupComplete = Boolean(profile.setup_complete);
    base.locationPrecision = profile.location_precision;
  }
  return base;
}

export function assertActiveUser(user) {
  if (!user) throw ApiError.unauthorized();
  if (user.status === 'suspended') {
    throw ApiError.forbidden('This account has been suspended. Contact support if you believe this is a mistake.');
  }
  if (user.status !== 'active') throw ApiError.forbidden('This account is not active.');
  return user;
}

export function deleteUserAccount(userId) {
  transaction(() => {
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    run('DELETE FROM users WHERE id = ?', [userId]);
  });
}
