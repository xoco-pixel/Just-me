/** Match preferences. Changes take effect in the matching engine immediately. */
import express from 'express';
import config from '../config.js';
import { get, run } from '../db/index.js';
import { asyncHandler, rateLimit, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { listTaxonomy } from '../lib/taxonomy.js';
import { newId, nowIso, parseJson } from '../lib/util.js';
import { clearDiscoveries } from '../services/search.js';
import { getPreferences, getProfile } from '../services/users.js';
import { ApiError } from '../lib/errors.js';

const router = express.Router();

const SEARCH_MODES = ['nearby', 'city', 'country', 'countries', 'worldwide', 'radius'];
const RADIUS_OPTIONS = [5, 10, 25, 50, 100, 250, 500];

function shapePreferences(row) {
  if (!row) return null;
  return {
    ageMin: row.age_min,
    ageMax: row.age_max,
    genders: parseJson(row.genders, []),
    intentions: parseJson(row.intentions, []),
    interests: parseJson(row.interests, []),
    languages: parseJson(row.languages, []),
    searchMode: row.search_mode,
    radiusKm: row.radius_km,
    countries: parseJson(row.countries, []),
    city: row.city,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    extra: parseJson(row.extra, {}),
    updatedAt: row.updated_at,
  };
}

/** Human-readable summary of where QuickSense will look. */
function describeSearch(prefs) {
  const countryLabel = (code) =>
    listTaxonomy('country').find((c) => c.value === code)?.label || code || 'your area';
  switch (prefs.searchMode) {
    case 'nearby':
    case 'radius':
      return `Within ${prefs.radiusKm} km of ${prefs.city || countryLabel(prefs.country)}`;
    case 'city':
      return `In ${prefs.city || 'your city'}, ${countryLabel(prefs.country)}`;
    case 'country':
      return `Anywhere in ${countryLabel(prefs.country)}`;
    case 'countries': {
      const names = prefs.countries.map(countryLabel);
      return names.length ? `In ${names.join(', ')}` : 'No countries selected yet';
    }
    case 'worldwide':
    default:
      return 'Worldwide';
  }
}

/** GET /api/preferences */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const prefs = shapePreferences(getPreferences(req.user.id));
    if (!prefs) throw ApiError.notFound('Preferences are created together with your profile.');
    res.json({
      preferences: prefs,
      searchDescription: describeSearch(prefs),
      radiusOptions: RADIUS_OPTIONS,
      searchModes: SEARCH_MODES,
    });
  })
);

/** PUT /api/preferences */
router.put(
  '/',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'prefs' }),
  asyncHandler(async (req, res) => {
    const profile = getProfile(req.user.id);
    if (!profile) throw ApiError.badRequest('Create your profile before setting preferences.');
    const current = getPreferences(req.user.id);

    const v = new Validator(req.body);
    const ageMin = v.integer('ageMin', { min: config.minimumAge, max: config.maximumAge, fallback: current.age_min });
    const ageMax = v.integer('ageMax', { min: config.minimumAge, max: config.maximumAge, fallback: current.age_max });
    const genders = v.list('genders', {
      allowedValues: new Set(listTaxonomy('gender').map((r) => r.value)),
      max: 5,
      fallback: parseJson(current.genders, []),
    });
    const intentions = v.list('intentions', {
      allowedValues: new Set(listTaxonomy('intention').map((r) => r.value)),
      max: 7,
      fallback: parseJson(current.intentions, []),
    });
    const interests = v.list('interests', {
      allowedValues: new Set(listTaxonomy('interest').map((r) => r.value)),
      max: 20,
      fallback: parseJson(current.interests, []),
    });
    const languages = v.list('languages', {
      allowedValues: new Set(listTaxonomy('language').map((r) => r.value)),
      max: 10,
      fallback: parseJson(current.languages, []),
    });
    const searchMode = v.enum('searchMode', SEARCH_MODES, { fallback: current.search_mode });
    const radiusKm = v.integer('radiusKm', { min: 1, max: 5000, fallback: current.radius_km });
    const countries = v.list('countries', {
      allowedValues: new Set(listTaxonomy('country').map((r) => r.value)),
      max: 40,
      fallback: parseJson(current.countries, []),
    });
    const city = v.string('city', { required: false, max: 80, allowEmpty: true });
    const country = v.enum('country', listTaxonomy('country').map((r) => r.value), { fallback: current.country });
    const latitude = v.number('latitude', { min: -90, max: 90, fallback: current.latitude });
    const longitude = v.number('longitude', { min: -180, max: 180, fallback: current.longitude });
    const extra = v.object('extra', { fallback: parseJson(current.extra, {}) });
    v.assertValid();

    // Cross-field rules: the engine needs enough data to honour the chosen mode.
    const problems = {};
    if (ageMin > ageMax) problems.ageMax = 'Maximum age must not be lower than minimum age.';
    if (searchMode === 'countries' && countries.length === 0) {
      problems.countries = 'Select at least one country, or switch to worldwide.';
    }
    if (searchMode === 'country' && !country) problems.country = 'Select a country to search in.';
    if (searchMode === 'city' && (!country || !city)) {
      problems.city = 'Select both a country and a city.';
    }
    if ((searchMode === 'nearby' || searchMode === 'radius') && !country) {
      problems.country = 'Distance search needs at least your country set.';
    }
    if (Object.keys(problems).length) throw ApiError.validation(problems);

    const now = nowIso();
    run(
      `UPDATE preferences SET age_min=?, age_max=?, genders=?, intentions=?, interests=?, languages=?,
        search_mode=?, radius_km=?, countries=?, city=?, country=?, latitude=?, longitude=?, extra=?, updated_at=?
       WHERE user_id=?`,
      [
        ageMin,
        ageMax,
        JSON.stringify(genders),
        JSON.stringify(intentions),
        JSON.stringify(interests),
        JSON.stringify(languages),
        searchMode,
        radiusKm,
        JSON.stringify(countries),
        city ?? null,
        country ?? null,
        typeof latitude === 'number' ? Math.round(latitude * 100) / 100 : null,
        typeof longitude === 'number' ? Math.round(longitude * 100) / 100 : null,
        JSON.stringify(extra),
        now,
        req.user.id,
      ]
    );

    // Potential matches were scored with the old preferences; drop them so the
    // next search recomputes against the new ones instead of showing stale scores.
    clearDiscoveries(req.user.id);

    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      now,
      req.user.id,
      'preferences_saved',
      `mode=${searchMode} ages=${ageMin}-${ageMax}`,
      req.ip,
    ]);

    const saved = shapePreferences(getPreferences(req.user.id));
    res.json({ preferences: saved, searchDescription: describeSearch(saved), saved: true });
  })
);

export default router;
