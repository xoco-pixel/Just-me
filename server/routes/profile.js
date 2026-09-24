/** Profile creation and editing, photos, contact methods, public profile view. */
import express from 'express';
import config from '../config.js';
import { get, run, transaction } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler, rateLimit, requireAuth } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { ageFromDob, newId, nowIso, parseJson, today } from '../lib/util.js';
import { isKnownContactType, listTaxonomy } from '../lib/taxonomy.js';
import { computeCompatibility } from '../services/matching.js';
import {
  recordFlags,
  scanBio,
  scanDisplayName,
  scanDuplicateProfile,
} from '../services/moderation.js';
import { notify } from '../services/notifications.js';
import { deletePhoto, reorderPhotos, storePhoto } from '../services/photos.js';
import { hasLiked, getMatch } from '../services/matches.js';
import {
  getContactMethods,
  getPreferences,
  getProfile,
  publicProfile,
  toParticipant,
} from '../services/users.js';
const router = express.Router();

function labelLookup() {
  const map = {};
  for (const kind of ['interest', 'intention', 'country', 'language', 'gender']) {
    map[kind] = Object.fromEntries(listTaxonomy(kind).map((row) => [row.value, row.label]));
  }
  return map;
}

const VISIBILITY_FIELDS = ['bio', 'city', 'region', 'interests', 'languages', 'intentions', 'gender'];

function parseProfileBody(body, { partial }) {
  const v = new Validator(body);
  const existing = partial ? body.__existing || null : null;

  const displayName = v.string('displayName', { required: !partial, min: 2, max: 40 });
  const dateOfBirth = v.isoDate('dateOfBirth', { required: !partial, minAge: config.minimumAge, maxAge: 100 });
  const gender = v.enum('gender', [...new Set(listTaxonomy('gender').map((r) => r.value))], {
    required: !partial,
  });
  const country = v.enum('country', [...new Set(listTaxonomy('country').map((r) => r.value))], {
    required: !partial,
  });
  const city = v.string('city', { required: false, max: 80, allowEmpty: true });
  const region = v.string('region', { required: false, max: 80, allowEmpty: true });
  const bio = v.string('bio', { required: false, max: 500, allowEmpty: true });
  const interests = v.list('interests', {
    allowedValues: new Set(listTaxonomy('interest').map((r) => r.value)),
    required: !partial,
    max: 20,
  });
  const languages = v.list('languages', {
    allowedValues: new Set(listTaxonomy('language').map((r) => r.value)),
    max: 10,
  });
  const intentions = v.list('intentions', {
    allowedValues: new Set(listTaxonomy('intention').map((r) => r.value)),
    required: !partial,
    max: 5,
  });
  // Coordinates are deliberately coarse: ~1.1 km grid, never a home address.
  const rawLat = v.number('latitude', { min: -90, max: 90 });
  const rawLon = v.number('longitude', { min: -180, max: 180 });
  const latitude = typeof rawLat === 'number' ? Math.round(rawLat * 100) / 100 : undefined;
  const longitude = typeof rawLon === 'number' ? Math.round(rawLon * 100) / 100 : undefined;
  const visibility = v.object('visibility');
  v.assertValid();

  const cleanVisibility = {};
  for (const field of VISIBILITY_FIELDS) {
    if (field in visibility) cleanVisibility[field] = visibility[field] !== false;
  }

  const values = {
    displayName,
    dateOfBirth,
    gender,
    country,
    city,
    region,
    bio,
    interests,
    languages,
    intentions,
    latitude,
    longitude,
    visibility: cleanVisibility,
  };
  // Merge onto existing when this is a partial update.
  if (existing) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) values[key] = existing[key];
    }
    values.visibility = { ...existing.visibility, ...cleanVisibility };
  }
  return values;
}

function assertSetupComplete(values) {
  const problems = {};
  if (!values.displayName || values.displayName.length < 2) problems.displayName = 'Add a display name.';
  if (!values.dateOfBirth) problems.dateOfBirth = 'Add your date of birth.';
  if (!values.gender) problems.gender = 'Select your gender.';
  if (!values.country) problems.country = 'Select your country.';
  if (!Array.isArray(values.interests) || values.interests.length < 3) {
    problems.interests = 'Pick at least 3 interests so matching has something to work with.';
  }
  if (!Array.isArray(values.intentions) || values.intentions.length < 1) {
    problems.intentions = 'Choose what you are looking for.';
  }
  if (Object.keys(problems).length) throw ApiError.validation(problems);
}

/** PUT /api/profile — create (first call) or update the profile. */
router.put(
  '/',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'profile' }),
  asyncHandler(async (req, res) => {
    const existingRow = getProfile(req.user.id);
    const existing = existingRow
      ? {
          displayName: existingRow.display_name,
          dateOfBirth: existingRow.date_of_birth,
          gender: existingRow.gender,
          country: existingRow.country,
          city: existingRow.city,
          region: existingRow.region,
          bio: existingRow.bio,
          interests: parseJson(existingRow.interests, []),
          languages: parseJson(existingRow.languages, []),
          intentions: parseJson(existingRow.intentions, []),
          latitude: existingRow.latitude,
          longitude: existingRow.longitude,
          visibility: parseJson(existingRow.visibility, {}),
        }
      : null;

    const values = parseProfileBody({ ...req.body, __existing: existing }, { partial: Boolean(existing) });
    const age = ageFromDob(values.dateOfBirth);
    if (age === null || age < config.minimumAge) {
      throw ApiError.forbidden(`QuickSense is strictly ${config.minimumAge}+. Accounts under ${config.minimumAge} cannot be created.`);
    }

    assertSetupComplete(values);
    const countryLabel = listTaxonomy('country').find((c) => c.value === values.country)?.label || values.country;

    // Real rule-based moderation checks. They create flags, never silent approval.
    const issues = [
      ...scanDisplayName(values.displayName),
      ...scanBio(values.bio),
      ...scanDuplicateProfile({
        displayName: values.displayName,
        country: values.country,
        age,
        excludeUserId: req.user.id,
      }),
    ];
    recordFlags(req.user.id, issues);

    const now = nowIso();
    if (existingRow) {
      run(
        `UPDATE profiles SET display_name=?, date_of_birth=?, age=?, gender=?, bio=?, country=?, country_name=?,
          city=?, region=?, latitude=?, longitude=?, interests=?, languages=?, intentions=?, visibility=?,
          setup_complete=1, updated_at=? WHERE user_id=?`,
        [
          values.displayName,
          values.dateOfBirth,
          age,
          values.gender,
          values.bio ?? '',
          values.country,
          countryLabel,
          values.city ?? '',
          values.region ?? '',
          values.latitude ?? null,
          values.longitude ?? null,
          JSON.stringify(values.interests),
          JSON.stringify(values.languages ?? []),
          JSON.stringify(values.intentions),
          JSON.stringify(values.visibility ?? {}),
          now,
          req.user.id,
        ]
      );
    } else {
      const prefs = getPreferences(req.user.id);
      transaction(() => {
        run(
          `INSERT INTO profiles (user_id, display_name, date_of_birth, age, gender, bio, country, country_name,
            city, region, latitude, longitude, location_precision, interests, languages, intentions, visibility,
            setup_complete, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'city', ?, ?, ?, ?, 1, ?, ?)`,
          [
            req.user.id,
            values.displayName,
            values.dateOfBirth,
            age,
            values.gender,
            values.bio ?? '',
            values.country,
            countryLabel,
            values.city ?? '',
            values.region ?? '',
            values.latitude ?? null,
            values.longitude ?? null,
            JSON.stringify(values.interests),
            JSON.stringify(values.languages ?? []),
            JSON.stringify(values.intentions),
            JSON.stringify(values.visibility ?? {}),
            now,
            now,
          ]
        );
        if (!prefs) {
          run(
            `INSERT INTO preferences (user_id, age_min, age_max, genders, intentions, interests, languages,
              search_mode, radius_km, countries, city, country, latitude, longitude, extra, updated_at)
             VALUES (?, ?, ?, '[]', ?, '[]', '[]', 'worldwide', 100, '[]', ?, ?, ?, ?, '{}', ?)`,
            [
              req.user.id,
              config.defaultPreferences.ageMin,
              Math.max(config.defaultPreferences.ageMax, age + 10),
              JSON.stringify(values.intentions),
              values.city ?? null,
              values.country,
              values.latitude ?? null,
              values.longitude ?? null,
              now,
            ]
          );
        }
      });
    }

    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      now,
      req.user.id,
      'profile_saved',
      issues.length ? `${issues.length} moderation flag(s) raised` : 'no flags',
      req.ip,
    ]);

    res.json({
      profile: publicProfile(req.user.id, { includePrivate: true }),
      moderationFlagsRaised: issues.length,
      saved: true,
    });
  })
);

/** GET /api/profile — my own full profile. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = publicProfile(req.user.id, { includePrivate: true });
    if (!profile) throw ApiError.notFound('You have not created your profile yet.');
    res.json({ profile, contactMethods: getContactMethods(req.user.id).map(shapeContactMethod) });
  })
);

function shapeContactMethod(row) {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    value: row.value,
    shareable: Boolean(row.shareable),
  };
}

const CONTACT_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  phone: /^\+?[\d\s()-]{7,20}$/,
  instagram: /^@?[A-Za-z0-9._]{2,30}$/,
  x: /^@?[A-Za-z0-9_]{2,30}$/,
  snapchat: /^[A-Za-z0-9._-]{3,20}$/,
  whatsapp: /^\+?[\d\s()-]{7,20}$/,
  telegram: /^@?[A-Za-z0-9_]{4,32}$/,
  other: /^.{2,120}$/,
};

/** POST /api/profile/contact-methods */
router.post(
  '/contact-methods',
  requireAuth,
  rateLimit({ limit: config.rateLimits.sensitive, name: 'contact' }),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const type = v.enum('type', listTaxonomy('contact_type').map((r) => r.value), { required: true });
    const value = v.string('value', { required: true, max: 120 });
    const label = v.string('label', { required: false, max: 40, allowEmpty: true });
    const shareable = v.boolean('shareable', { fallback: false });
    v.assertValid();
    if (!isKnownContactType(type)) throw ApiError.badRequest('Unknown contact type.');

    const pattern = CONTACT_PATTERNS[type];
    if (pattern && !pattern.test(value)) {
      throw ApiError.badRequest(`That does not look like a valid ${type}.`, { value: `Enter a valid ${type}.` });
    }
    const existing = get('SELECT id FROM contact_methods WHERE user_id = ? AND type = ? AND value = ?', [
      req.user.id,
      type,
      value,
    ]);
    if (existing) throw ApiError.conflict('You have already added that contact method.');

    const id = newId('ctc');
    run(
      `INSERT INTO contact_methods (id, user_id, type, label, value, shareable, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, type, label || '', value, shareable ? 1 : 0, nowIso()]
    );
    run('INSERT INTO security_log (id, at, actor_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      newId('log'),
      nowIso(),
      req.user.id,
      'contact_method_added',
      `${type} (shareable=${shareable ? 1 : 0})`,
      req.ip,
    ]);
    res.status(201).json({ contactMethod: shapeContactMethod(get('SELECT * FROM contact_methods WHERE id = ?', [id])) });
  })
);

/** PUT /api/profile/contact-methods/:id — change shareable flag or label. */
router.put(
  '/contact-methods/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = get('SELECT * FROM contact_methods WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!row) throw ApiError.notFound('That contact method does not exist.');
    const v = new Validator(req.body);
    const shareable = v.boolean('shareable', { fallback: Boolean(row.shareable) });
    const label = v.string('label', { required: false, max: 40, allowEmpty: true });
    v.assertValid();
    run('UPDATE contact_methods SET shareable = ?, label = ? WHERE id = ?', [
      shareable ? 1 : 0,
      label ?? row.label,
      row.id,
    ]);
    res.json({ contactMethod: shapeContactMethod(get('SELECT * FROM contact_methods WHERE id = ?', [row.id])) });
  })
);

/** DELETE /api/profile/contact-methods/:id */
router.delete(
  '/contact-methods/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = run('DELETE FROM contact_methods WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.changes === 0) throw ApiError.notFound('That contact method does not exist.');
    res.json({ deleted: true });
  })
);

/** POST /api/profile/photos */
router.post(
  '/photos',
  requireAuth,
  rateLimit({ limit: config.rateLimits.upload, name: 'upload' }),
  asyncHandler(async (req, res) => {
    if (!getProfile(req.user.id)) {
      throw ApiError.badRequest('Create your profile before uploading photos.');
    }
    const v = new Validator(req.body);
    const dataUrl = v.string('dataUrl', { required: true, max: 12_000_000 });
    v.assertValid();
    const photo = storePhoto(req.user.id, dataUrl);
    res.status(201).json({ photo });
  })
);

/** DELETE /api/profile/photos/:id */
router.delete(
  '/photos/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(deletePhoto(req.user.id, req.params.id));
  })
);

/** POST /api/profile/photos/reorder */
router.post(
  '/photos/reorder',
  requireAuth,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const orderedIds = v.list('orderedIds', { required: true, max: config.maxPhotosPerUser });
    v.assertValid();
    res.json(reorderPhotos(req.user.id, orderedIds));
  })
);

/**
 * GET /api/users/:userId — another person's public profile.
 * Records a real profile view and notifies them at most once per day.
 */
router.get(
  '/users/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetId = req.params.userId;
    if (targetId === req.user.id) {
      return res.json({
        profile: publicProfile(req.user.id, { includePrivate: true }),
        isSelf: true,
        contactMethods: getContactMethods(req.user.id).map(shapeContactMethod),
      });
    }
    const profile = publicProfile(targetId);
    if (!profile) throw ApiError.notFound('That profile does not exist or is no longer available.');

    const me = toParticipant(req.user.id);
    const other = toParticipant(targetId);
    const compatibility =
      me && other ? computeCompatibility(me, other, { labels: labelLookup() }) : null;

    const viewId = newId('pvw');
    const inserted = run(
      `INSERT INTO profile_views (id, viewer_id, viewed_id, day, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(viewer_id, viewed_id, day) DO NOTHING`,
      [viewId, req.user.id, targetId, today(), nowIso()]
    );
    let viewNotified = false;
    if (inserted.changes > 0) {
      const viewer = publicProfile(req.user.id);
      const result = notify(targetId, {
        type: 'profile_view',
        title: `👀 ${viewer?.displayName || 'Someone'} viewed your profile`,
        body: 'Open your matches to see who is looking at you.',
        refType: 'user',
        refId: req.user.id,
      });
      viewNotified = result.delivered;
    }

    res.json({
      profile,
      isSelf: false,
      compatibility: compatibility?.eligible
        ? {
            eligible: true,
            score: compatibility.score,
            reasons: compatibility.reasons,
            components: compatibility.components,
            mutual: compatibility.mutual,
            shared: compatibility.shared,
          }
        : { eligible: false, gate: compatibility?.gate || 'unknown', message: compatibility?.message },
      match: getMatch(req.user.id, targetId),
      iLikedThem: hasLiked(req.user.id, targetId),
      viewNotified,
    });
  })
);

export default router;
