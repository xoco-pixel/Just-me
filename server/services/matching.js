/**
 * QuickSense matching engine.
 *
 * Pure functions only: no database access, no randomness, no hidden state.
 * Given two participants (profile + preferences) it returns a compatibility
 * score and the exact reasons behind it. Every reason maps to real input data.
 *
 * Two-way compatibility is enforced here: if a preference only works in one
 * direction the score is capped, so a match that only suits one person can never
 * be presented as a strong match.
 */
import config from '../config.js';

const { weights, caps } = config.matching;

/** Great-circle distance in km. Returns null when coordinates are missing. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return [];
};
const setOf = (value) => new Set(asArray(value).map(String));

export function intersection(a, b) {
  const setB = setOf(b);
  return [...setOf(a)].filter((v) => setB.has(v));
}

/** Sørensen–Dice coefficient: 2|A∩B| / (|A|+|B|). 0..1 */
export function dice(a, b) {
  const A = setOf(a);
  const B = setOf(b);
  if (A.size === 0 || B.size === 0) return 0;
  return (2 * intersection(A, B).length) / (A.size + B.size);
}

/** |A∩B| / min(|A|,|B|) — tolerant of one person listing far more items. */
export function overlapRatio(a, b) {
  const A = setOf(a);
  const B = setOf(b);
  const min = Math.min(A.size, B.size);
  if (min === 0) return 0;
  return intersection(A, B).length / min;
}

/** Overlap of two inclusive numeric ranges as a fraction of the narrower range. */
export function rangeOverlap([aMin, aMax], [bMin, bMax]) {
  const lo = Math.max(aMin, bMin);
  const hi = Math.min(aMax, bMax);
  if (hi < lo) return 0;
  const narrower = Math.min(aMax - aMin, bMax - bMin);
  if (narrower <= 0) return hi === lo ? 1 : 0;
  return (hi - lo) / narrower;
}

const round1 = (n) => Math.round(n * 100) / 100;

/**
 * Does `prefs` want to see `profile`?
 * Returns { ok, value, detail } where value is 0..1 partial credit.
 */
export function locationFit(prefs, profile, labels = {}) {
  const mode = prefs.searchMode || 'worldwide';
  const countryLabel = labels.countryName || profile.country;

  if (mode === 'worldwide') {
    return { ok: true, value: 1, detail: { mode, text: 'Searching worldwide' } };
  }

  if (mode === 'countries') {
    const countries = setOf(prefs.countries);
    const ok = countries.has(profile.country);
    return {
      ok,
      value: ok ? 1 : 0,
      detail: { mode, text: ok ? `Open to people in ${countryLabel}` : `Not in their selected countries` },
    };
  }

  if (mode === 'country') {
    const ok = prefs.country === profile.country;
    return {
      ok,
      value: ok ? 1 : 0,
      detail: { mode, text: ok ? `Both in ${countryLabel}` : 'Different countries' },
    };
  }

  if (mode === 'city') {
    const sameCountry = prefs.country === profile.country;
    const sameCity =
      sameCountry &&
      String(prefs.city || '').toLowerCase() === String(profile.city || '').toLowerCase() &&
      String(prefs.city || '').length > 0;
    return {
      ok: sameCity,
      value: sameCity ? 1 : sameCountry ? 0.4 : 0,
      detail: { mode, text: sameCity ? `Both in ${profile.city || countryLabel}` : 'Not in the selected city' },
    };
  }

  // 'nearby' and 'radius' both use a distance budget.
  const radiusKm = Number(prefs.radiusKm) > 0 ? Number(prefs.radiusKm) : 100;
  const distance = haversineKm(prefs.latitude, prefs.longitude, profile.latitude, profile.longitude);
  if (distance === null) {
    // No coordinates on one side: fall back to country-level partial credit
    // rather than inventing a distance.
    const sameCountry = prefs.country === profile.country;
    return {
      ok: sameCountry,
      value: sameCountry ? 0.6 : 0.15,
      detail: { mode, text: sameCountry ? `Both in ${countryLabel}` : 'Distance unknown', distance: null },
    };
  }
  const ok = distance <= radiusKm;
  return {
    ok,
    value: ok ? Math.max(0.25, 1 - distance / radiusKm) : Math.max(0, 0.2 * (1 - distance / (radiusKm * 4))),
    detail: {
      mode,
      text: ok ? `About ${Math.round(distance)} km apart` : `About ${Math.round(distance)} km away (outside ${radiusKm} km)`,
      distance: Math.round(distance),
    },
  };
}

function intentionsFit(prefs, otherIntentions) {
  const wanted = asArray(prefs.intentions).map(String);
  const theirs = asArray(otherIntentions).map(String);
  if (wanted.length === 0) return { ok: true, value: 0.6, shared: [], open: true };
  if (theirs.length === 0) return { ok: true, value: 0.5, shared: [], open: true };
  const shared = intersection(wanted, theirs);
  return { ok: shared.length > 0, value: overlapRatio(wanted, theirs), shared, open: false };
}

/**
 * Main entry point.
 *
 * @param {{userId:string, profile:object, preferences:object}} me
 * @param {{userId:string, profile:object, preferences:object}} other
 * @param {{labels?:object}} [options] optional display labels (interest names, etc.)
 * @returns {{eligible:boolean, gate?:string, score:number, mutual:object, components:object, reasons:Array}}
 */
export function computeCompatibility(me, other, options = {}) {
  const labels = options.labels || {};
  const meP = me.profile;
  const otherP = other.profile;
  const mePref = me.preferences;
  const otherPref = other.preferences;

  // --- Hard gates ----------------------------------------------------------
  if (me.userId === other.userId) {
    return notEligible('self', 'You cannot match with yourself.');
  }
  if (meP.status && meP.status !== 'active') return notEligible('account_status', 'Account is not active.');
  if (otherP.status && otherP.status !== 'active') {
    return notEligible('account_status', 'That account is not active.');
  }
  const minAge = config.minimumAge;
  if (meP.age < minAge || otherP.age < minAge) {
    return notEligible('age', 'QuickSense is strictly 18+.');
  }

  // Gender preference must work BOTH ways. This is a hard gate.
  const meOpenToGender = asArray(mePref.genders).length === 0 || setOf(mePref.genders).has(String(otherP.gender));
  const otherOpenToGender = asArray(otherPref.genders).length === 0 || setOf(otherPref.genders).has(String(meP.gender));
  if (!meOpenToGender || !otherOpenToGender) {
    return notEligible('gender', 'Gender preferences do not align in both directions.');
  }

  // --- Age ------------------------------------------------------------------
  const meAcceptsAge = otherP.age >= mePref.ageMin && otherP.age <= mePref.ageMax;
  const otherAcceptsAge = meP.age >= otherPref.ageMin && meP.age <= otherPref.ageMax;
  const mutualAge = meAcceptsAge && otherAcceptsAge;
  const ageComponent =
    0.5 * rangeOverlap([mePref.ageMin, mePref.ageMax], [otherPref.ageMin, otherPref.ageMax]) +
    0.25 * (meAcceptsAge ? 1 : 0) +
    0.25 * (otherAcceptsAge ? 1 : 0);

  // --- Location -------------------------------------------------------------
  const meWantsLocation = locationFit(mePref, otherP, labels);
  const otherWantsLocation = locationFit(otherPref, meP, labels);
  const mutualLocation = meWantsLocation.ok && otherWantsLocation.ok;
  const locationComponent = (meWantsLocation.value + otherWantsLocation.value) / 2;

  // --- Intentions -----------------------------------------------------------
  const meWantsIntention = intentionsFit(mePref, otherP.intentions);
  const otherWantsIntention = intentionsFit(otherPref, meP.intentions);
  const mutualIntention = meWantsIntention.ok && otherWantsIntention.ok;
  const intentionComponent = (meWantsIntention.value + otherWantsIntention.value) / 2;

  // --- Interests ------------------------------------------------------------
  const sharedInterests = intersection(meP.interests, otherP.interests);
  const diceInterests = dice(meP.interests, otherP.interests);
  const preferredShared = [mePref.interests, otherPref.interests]
    .map((wanted) => {
      const list = asArray(wanted).map(String);
      if (list.length === 0) return null;
      return overlapRatio(list, sharedInterests.length ? sharedInterests : otherInterestsOf(list, meP, otherP));
    })
    .filter((v) => v !== null);
  const preferenceBoost = preferredShared.length
    ? preferredShared.reduce((a, b) => a + b, 0) / preferredShared.length
    : diceInterests;
  const interestComponent = 0.7 * diceInterests + 0.3 * preferenceBoost;

  // --- Languages ------------------------------------------------------------
  const sharedLanguages = intersection(meP.languages, otherP.languages);
  const bothListedLanguages = asArray(meP.languages).length > 0 && asArray(otherP.languages).length > 0;
  const languageComponent = bothListedLanguages ? overlapRatio(meP.languages, otherP.languages) : 0.5;

  // --- Extra criteria (forward compatible) ----------------------------------
  const extraA = mePref.extra && typeof mePref.extra === 'object' ? mePref.extra : {};
  const extraB = otherPref.extra && typeof otherPref.extra === 'object' ? otherPref.extra : {};
  const extraKeys = [...new Set([...Object.keys(extraA), ...Object.keys(extraB)])];
  let extraComponent = 0.5;
  const sharedExtra = [];
  if (extraKeys.length > 0) {
    let hits = 0;
    for (const key of extraKeys) {
      const a = extraA[key];
      const b = extraB[key];
      if (a === undefined || b === undefined || a === '' || b === '') continue;
      if (String(a).toLowerCase() === String(b).toLowerCase()) {
        hits += 1;
        sharedExtra.push(key);
      }
    }
    extraComponent = extraKeys.length ? hits / extraKeys.length : 0.5;
  }

  // --- Weighted total -------------------------------------------------------
  const components = {
    interests: round1(interestComponent),
    intention: round1(intentionComponent),
    location: round1(locationComponent),
    age: round1(ageComponent),
    language: round1(languageComponent),
    extra: round1(extraComponent),
  };

  let weighted =
    components.interests * weights.interests +
    components.intention * weights.intention +
    components.location * weights.location +
    components.age * weights.age +
    components.language * weights.language +
    components.extra * weights.extra;

  // Normalise in case the configured weights do not sum to 1.
  const weightSum =
    weights.interests + weights.intention + weights.location + weights.age + weights.language + weights.extra;
  if (weightSum > 0) weighted /= weightSum;

  let score = Math.round(weighted * 100);

  // --- Two-way caps ---------------------------------------------------------
  const appliedCaps = [];
  if (!mutualAge) {
    score = Math.min(score, caps.mutualAgeFailed);
    appliedCaps.push('mutual_age');
  }
  if (!mutualLocation) {
    score = Math.min(score, caps.mutualLocationFailed);
    appliedCaps.push('mutual_location');
  }
  if (!mutualIntention) {
    score = Math.min(score, caps.mutualIntentionFailed);
    appliedCaps.push('mutual_intention');
  }
  score = Math.max(0, Math.min(100, score));

  const mutual = { age: mutualAge, location: mutualLocation, intention: mutualIntention, gender: true };

  const reasons = buildReasons({
    sharedInterests,
    sharedLanguages,
    sharedExtra,
    meWantsIntention,
    otherWantsIntention,
    mePref,
    otherPref,
    meWantsLocation,
    otherWantsLocation,
    mutual,
    meP,
    otherP,
    distance: meWantsLocation.detail.distance ?? otherWantsLocation.detail.distance ?? null,
    labels,
  });

  return {
    eligible: true,
    score,
    mutual,
    components,
    appliedCaps,
    reasons,
    shared: {
      interests: sharedInterests,
      languages: sharedLanguages,
      intentions: intersection(meWantsIntention.shared, otherWantsIntention.shared),
    },
    distanceKm: meWantsLocation.detail.distance ?? null,
  };
}

function otherInterestsOf(wanted, meP, otherP) {
  const mine = setOf(meP.interests);
  return wanted.filter((w) => mine.has(w) || setOf(otherP.interests).has(w));
}

function notEligible(gate, message) {
  return {
    eligible: false,
    gate,
    message,
    score: 0,
    mutual: { age: false, location: false, intention: false, gender: false },
    components: {},
    appliedCaps: [],
    reasons: [],
    shared: { interests: [], languages: [], intentions: [] },
    distanceKm: null,
  };
}

/**
 * Builds the "Why did we match?" explanation.
 * Each entry is produced only from data that actually contributed to the score.
 */
export function buildReasons(input) {
  const reasons = [];
  const L = input.labels || {};
  const name = (kind, value) => L[kind]?.[value] || String(value);

  if (input.sharedInterests.length) {
    const shown = input.sharedInterests.slice(0, 3).map((v) => name('interest', v));
    reasons.push({
      type: 'shared_interests',
      icon: '🎯',
      text:
        input.sharedInterests.length > 3
          ? `You both like ${shown.join(', ')} and ${input.sharedInterests.length - 3} more`
          : `You both like ${shown.join(' and ')}`,
      values: input.sharedInterests,
    });
  }

  if (input.mutual.intention && input.meWantsIntention.shared?.length) {
    const shown = [...new Set([...input.meWantsIntention.shared, ...(input.otherWantsIntention.shared || [])])]
      .slice(0, 2)
      .map((v) => name('intention', v));
    reasons.push({
      type: 'intention',
      icon: '💬',
      text: shown.length ? `You're both open to ${shown.join(' and ')}` : 'Your relationship intentions are compatible',
      values: input.meWantsIntention.shared,
    });
  }

  if (input.mutual.location) {
    const bothWorldwide = input.mePref.searchMode === 'worldwide' && input.otherPref.searchMode === 'worldwide';
    if (bothWorldwide) {
      reasons.push({ type: 'location', icon: '🌎', text: 'You both want international connections', values: ['worldwide'] });
    } else if (input.distance !== null && input.distance !== undefined) {
      reasons.push({
        type: 'distance',
        icon: '📍',
        text: `You're about ${input.distance} km from each other`,
        values: [input.distance],
      });
    } else {
      reasons.push({
        type: 'location',
        icon: '📍',
        text: `You're both open to meeting in ${name('country', input.meP.country)}`,
        values: [input.meP.country],
      });
    }
  }

  const ageOverlap = rangeOverlap(
    [input.mePref.ageMin, input.mePref.ageMax],
    [input.otherPref.ageMin, input.otherPref.ageMax]
  );
  if (input.mutual.age && ageOverlap > 0) {
    reasons.push({
      type: 'age',
      icon: '📅',
      text: `Your preferred age ranges overlap (${input.mePref.ageMin}–${input.mePref.ageMax} and ${input.otherPref.ageMin}–${input.otherPref.ageMax})`,
      values: [input.mePref.ageMin, input.mePref.ageMax, input.otherPref.ageMin, input.otherPref.ageMax],
    });
  }

  if (input.sharedLanguages.length) {
    reasons.push({
      type: 'language',
      icon: '🗣️',
      text: `You both speak ${input.sharedLanguages.slice(0, 3).map((v) => name('language', v)).join(', ')}`,
      values: input.sharedLanguages,
    });
  }

  if (input.sharedExtra.length) {
    reasons.push({
      type: 'extra',
      icon: '✅',
      text: `You gave the same answer for ${input.sharedExtra.join(', ')}`,
      values: input.sharedExtra,
    });
  }

  // Honest negative signals when two-way compatibility failed.
  if (!input.mutual.age) {
    reasons.push({
      type: 'age_conflict',
      icon: '⚠️',
      text: 'Your preferred age ranges do not overlap',
      negative: true,
      values: [input.mePref.ageMin, input.mePref.ageMax, input.otherPref.ageMin, input.otherPref.ageMax],
    });
  }
  if (!input.mutual.location) {
    reasons.push({
      type: 'location_conflict',
      icon: '⚠️',
      text: 'One of you is searching outside the other’s location',
      negative: true,
      values: [input.mePref.searchMode, input.otherPref.searchMode],
    });
  }
  if (!input.mutual.intention) {
    reasons.push({
      type: 'intention_conflict',
      icon: '⚠️',
      text: 'You are looking for different kinds of connection',
      negative: true,
      values: [input.mePref.intentions, input.otherPref.intentions],
    });
  }

  if (!reasons.length) {
    reasons.push({ type: 'general', icon: '✨', text: 'Compatible on the basics — open the profile to see more', values: [] });
  }
  return reasons;
}

/** Deterministic ranking: score, then most recently active. */
export function rankCandidates(results) {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aSeen = a.lastSeenAt || a.createdAt || '';
    const bSeen = b.lastSeenAt || b.createdAt || '';
    return bSeen.localeCompare(aSeen);
  });
}
