/**
 * Matching engine unit tests.
 * The engine is pure, so these assert the actual scoring and two-way rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCompatibility,
  dice,
  haversineKm,
  intersection,
  locationFit,
  overlapRatio,
  rangeOverlap,
  rankCandidates,
} from '../server/services/matching.js';

function person(overrides = {}) {
  return {
    userId: overrides.userId || 'u1',
    profile: {
      userId: overrides.userId || 'u1',
      age: 22,
      gender: 'woman',
      country: 'NG',
      city: 'Port Harcourt',
      latitude: 4.81,
      longitude: 7.0,
      interests: ['music', 'gaming', 'travel'],
      languages: ['english'],
      intentions: ['dating', 'friendship'],
      status: 'active',
      ...(overrides.profile || {}),
    },
    preferences: {
      ageMin: 18,
      ageMax: 30,
      genders: [],
      intentions: ['dating', 'friendship'],
      interests: [],
      languages: [],
      searchMode: 'worldwide',
      radiusKm: 100,
      countries: [],
      city: null,
      country: 'NG',
      latitude: 4.81,
      longitude: 7.0,
      extra: {},
      ...(overrides.preferences || {}),
    },
  };
}

test('helpers: dice, overlapRatio, intersection, rangeOverlap', () => {
  assert.equal(intersection(['a', 'b'], ['b', 'c']).length, 1);
  assert.equal(dice(['a', 'b'], ['a', 'b']), 1);
  assert.equal(dice(['a'], ['b']), 0);
  assert.equal(overlapRatio(['a', 'b', 'c'], ['a']), 1);
  // [18,25] and [19,26] share [19,25] = 6 of the narrower 7-year span.
  assert.equal(rangeOverlap([18, 25], [19, 26]), 6 / 7);
  // A range fully contained in the other is a complete overlap.
  assert.equal(rangeOverlap([18, 30], [19, 24]), 1);
  assert.equal(rangeOverlap([18, 25], [40, 50]), 0);
});

test('haversine: Port Harcourt to Lagos is roughly 440 km', () => {
  const km = haversineKm(4.81, 7.0, 6.52, 3.37);
  assert.ok(km > 380 && km < 500, `expected ~440km, got ${km}`);
  assert.equal(haversineKm(4.81, 7.0, null, null), null);
});

test('identical compatible profiles score high and produce real reasons', () => {
  const a = person({ userId: 'a' });
  const b = person({ userId: 'b' });
  const result = computeCompatibility(a, b);
  assert.equal(result.eligible, true);
  assert.ok(result.score >= 90, `expected a high score, got ${result.score}`);
  assert.deepEqual(result.mutual, { age: true, location: true, intention: true, gender: true });
  assert.equal(result.appliedCaps.length, 0);

  const types = result.reasons.map((r) => r.type);
  assert.ok(types.includes('shared_interests'), 'should explain shared interests');
  assert.ok(types.includes('intention'), 'should explain intention overlap');
  assert.ok(types.includes('age'), 'should explain age range overlap');
  // Every reason must carry the data it claims.
  for (const reason of result.reasons) {
    assert.ok(reason.text && reason.text.length > 0, 'reason needs text');
    assert.ok(Array.isArray(reason.values), 'reason needs the values behind it');
  }
});

test('two-way rule: one-sided age preference is capped, never a strong match', () => {
  const a = person({ userId: 'a', preferences: { ageMin: 18, ageMax: 25 } });
  // B is 22 (inside A's range) but B only wants 40-50, so A is outside B's range.
  const b = person({ userId: 'b', preferences: { ageMin: 40, ageMax: 50 } });
  const result = computeCompatibility(a, b);
  assert.equal(result.eligible, true);
  assert.equal(result.mutual.age, false);
  assert.ok(result.score <= 42, `expected a capped score, got ${result.score}`);
  assert.ok(result.appliedCaps.includes('mutual_age'));
  const conflict = result.reasons.find((r) => r.type === 'age_conflict');
  assert.ok(conflict, 'must surface the age conflict honestly');
  assert.equal(conflict.negative, true);
});

test('gender preference must work in BOTH directions or the pair is excluded', () => {
  const a = person({ userId: 'a', preferences: { genders: ['man'] } });
  const b = person({ userId: 'b', profile: { gender: 'woman' } });
  const result = computeCompatibility(a, b);
  assert.equal(result.eligible, false);
  assert.equal(result.gate, 'gender');
});

test('under-18 profiles are never eligible', () => {
  const a = person({ userId: 'a' });
  const b = person({ userId: 'b', profile: { age: 17 } });
  const result = computeCompatibility(a, b);
  assert.equal(result.eligible, false);
  assert.equal(result.gate, 'age');
});

test('cannot match with yourself', () => {
  const a = person({ userId: 'a' });
  const result = computeCompatibility(a, person({ userId: 'a' }));
  assert.equal(result.eligible, false);
  assert.equal(result.gate, 'self');
});

test('country search mode only fits people in the selected countries', () => {
  const prefs = { searchMode: 'countries', countries: ['US', 'GB'] };
  assert.equal(locationFit(prefs, { country: 'US' }).ok, true);
  assert.equal(locationFit(prefs, { country: 'NG' }).ok, false);
  assert.equal(locationFit({ searchMode: 'worldwide' }, { country: 'NG' }).ok, true);
});

test('radius mode respects the distance budget', () => {
  const prefs = { searchMode: 'radius', radiusKm: 50, latitude: 4.81, longitude: 7.0, country: 'NG' };
  const near = locationFit(prefs, { latitude: 4.85, longitude: 7.05, country: 'NG' });
  const far = locationFit(prefs, { latitude: 6.52, longitude: 3.37, country: 'NG' });
  assert.equal(near.ok, true);
  assert.equal(far.ok, false);
});

test('one-sided location preference caps the score', () => {
  const a = person({ userId: 'a', preferences: { searchMode: 'country', country: 'NG' } });
  const b = person({
    userId: 'b',
    profile: { country: 'US', city: 'Austin' },
    preferences: { searchMode: 'country', country: 'US' },
  });
  const result = computeCompatibility(a, b);
  assert.equal(result.mutual.location, false);
  assert.ok(result.score <= 45, `expected capped score, got ${result.score}`);
});

test('shared interests move the score', () => {
  const a = person({ userId: 'a', profile: { interests: ['music', 'gaming', 'travel'] } });
  const many = person({ userId: 'b', profile: { interests: ['music', 'gaming', 'travel'] } });
  const none = person({ userId: 'c', profile: { interests: ['cooking', 'hiking', 'pets'] } });
  const high = computeCompatibility(a, many).score;
  const low = computeCompatibility(a, none).score;
  assert.ok(high > low, `shared interests should score higher (${high} vs ${low})`);
});

test('score is deterministic and within bounds', () => {
  const a = person({ userId: 'a' });
  const b = person({ userId: 'b', profile: { interests: ['music', 'food'] } });
  const first = computeCompatibility(a, b).score;
  const second = computeCompatibility(a, b).score;
  assert.equal(first, second);
  assert.ok(first >= 0 && first <= 100);
});

test('ranking sorts by score then recency', () => {
  const ranked = rankCandidates([
    { userId: 'x', score: 50, lastSeenAt: '2026-01-01T00:00:00Z' },
    { userId: 'y', score: 90, lastSeenAt: '2025-01-01T00:00:00Z' },
    { userId: 'z', score: 50, lastSeenAt: '2026-06-01T00:00:00Z' },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.userId),
    ['y', 'z', 'x']
  );
});
