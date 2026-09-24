/**
 * Seeds clearly-labelled demo profiles.
 *
 * Demo users are tagged is_demo=1 and rendered with a DEMO badge everywhere they
 * appear. Refuses to run when NODE_ENV=production, so development users can never
 * leak into production data.
 */
import crypto from 'node:crypto';
import config from '../server/config.js';
import { db, initDatabase } from '../server/db/index.js';
import { seedTaxonomy } from '../server/lib/taxonomy.js';
import { ageFromDob, generateQsId, newId, nowIso } from '../server/lib/util.js';
import { createProfileRows, createUser } from '../server/services/users.js';

if (!config.allowDemoData) {
  console.error('Refusing to seed demo data: NODE_ENV=production.');
  process.exit(1);
}

initDatabase(config.dbPath);
seedTaxonomy();

const DEMO_PEOPLE = [
  {
    displayName: 'Amara',
    dateOfBirth: '2001-04-12',
    gender: 'woman',
    country: 'NG',
    city: 'Port Harcourt',
    region: 'Rivers State',
    latitude: 4.81,
    longitude: 7.0,
    bio: 'Music, good food and long conversations. Here for something real.',
    interests: ['music', 'afrobeats', 'travel', 'food', 'photography'],
    languages: ['english', 'pidgin'],
    intentions: ['dating', 'serious_relationship'],
    prefs: { ageMin: 23, ageMax: 34, genders: ['man'], searchMode: 'worldwide', radiusKm: 100, countries: [] },
  },
  {
    displayName: 'Tunde',
    dateOfBirth: '1998-09-30',
    gender: 'man',
    country: 'NG',
    city: 'Lagos',
    region: 'Lagos State',
    latitude: 6.52,
    longitude: 3.37,
    bio: 'Software engineer. Gaming on weekends, hiking when I can escape the city.',
    interests: ['gaming', 'technology', 'hiking', 'movies', 'fitness'],
    languages: ['english', 'yoruba'],
    intentions: ['dating', 'friendship', 'international'],
    prefs: { ageMin: 21, ageMax: 32, genders: ['woman'], searchMode: 'worldwide', radiusKm: 250, countries: [] },
  },
  {
    displayName: 'Zainab',
    dateOfBirth: '2000-01-18',
    gender: 'woman',
    country: 'NG',
    city: 'Abuja',
    region: 'FCT',
    latitude: 9.06,
    longitude: 7.49,
    bio: 'Books, art galleries and quiet mornings. Looking for genuine friendship first.',
    interests: ['books', 'art', 'education', 'spirituality', 'music'],
    languages: ['english', 'hausa'],
    intentions: ['friendship', 'serious_relationship'],
    prefs: { ageMin: 22, ageMax: 35, genders: ['man'], searchMode: 'countries', radiusKm: 100, countries: ['NG', 'GH', 'KE'] },
  },
  {
    displayName: 'Chidi',
    dateOfBirth: '1996-06-05',
    gender: 'man',
    country: 'NG',
    city: 'Enugu',
    region: 'Enugu State',
    latitude: 6.44,
    longitude: 7.49,
    bio: 'Chef and football lover. I make a mean jollof rice and I will argue about it.',
    interests: ['food', 'football', 'cooking', 'music', 'travel'],
    languages: ['english', 'igbo'],
    intentions: ['dating', 'friendship', 'social'],
    prefs: { ageMin: 21, ageMax: 33, genders: ['woman'], searchMode: 'country', radiusKm: 100, countries: [] },
  },
  {
    displayName: 'Ngozi',
    dateOfBirth: '2002-11-22',
    gender: 'woman',
    country: 'NG',
    city: 'Port Harcourt',
    region: 'Rivers State',
    latitude: 4.79,
    longitude: 7.01,
    bio: 'Student, dancer, and very into fashion. Let’s talk about music for hours.',
    interests: ['dancing', 'fashion', 'music', 'afrobeats', 'movies'],
    languages: ['english', 'igbo'],
    intentions: ['friendship', 'social', 'dating'],
    prefs: { ageMin: 20, ageMax: 30, genders: [], searchMode: 'radius', radiusKm: 50, countries: [] },
  },
  {
    displayName: 'Emeka',
    dateOfBirth: '1994-03-14',
    gender: 'man',
    country: 'NG',
    city: 'Lagos',
    region: 'Lagos State',
    latitude: 6.46,
    longitude: 3.42,
    bio: 'Business, travel and fitness. Looking for international connections.',
    interests: ['business', 'travel', 'fitness', 'technology', 'food'],
    languages: ['english', 'igbo', 'french'],
    intentions: ['international', 'serious_relationship', 'long_distance'],
    prefs: { ageMin: 24, ageMax: 38, genders: ['woman'], searchMode: 'worldwide', radiusKm: 500, countries: [] },
  },
  {
    displayName: 'Bisi',
    dateOfBirth: '1999-07-27',
    gender: 'woman',
    country: 'GB',
    city: 'Manchester',
    region: 'England',
    latitude: 53.48,
    longitude: -2.24,
    bio: 'Nurse, book lover, and always planning the next trip.',
    interests: ['books', 'travel', 'fitness', 'volunteering', 'music'],
    languages: ['english', 'yoruba'],
    intentions: ['serious_relationship', 'long_distance', 'international'],
    prefs: { ageMin: 25, ageMax: 40, genders: ['man'], searchMode: 'worldwide', radiusKm: 250, countries: [] },
  },
  {
    displayName: 'Marcus',
    dateOfBirth: '1997-02-09',
    gender: 'man',
    country: 'US',
    city: 'Atlanta',
    region: 'Georgia',
    latitude: 33.75,
    longitude: -84.39,
    bio: 'Photographer and gamer. Big on movies and late-night drives.',
    interests: ['photography', 'gaming', 'movies', 'music', 'anime'],
    languages: ['english'],
    intentions: ['friendship', 'international', 'dating'],
    prefs: { ageMin: 22, ageMax: 36, genders: ['woman'], searchMode: 'worldwide', radiusKm: 250, countries: [] },
  },
];

function countryLabel(code) {
  return db().prepare('SELECT label FROM taxonomy WHERE kind = ? AND value = ?').get('country', code)?.label || code;
}

function demoExists(displayName) {
  return Boolean(
    db()
      .prepare(
        `SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.display_name = ? AND u.is_demo = 1`
      )
      .get(displayName)
  );
}

function uniqueQsId() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateQsId();
    if (!db().prepare('SELECT id FROM users WHERE qs_id = ?').get(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique QuickSense ID.');
}

let created = 0;
let skipped = 0;

for (const person of DEMO_PEOPLE) {
  if (demoExists(person.displayName)) {
    skipped += 1;
    continue;
  }

  const userId = newId('usr');
  const qsId = uniqueQsId();
  const age = ageFromDob(person.dateOfBirth);

  createUser({ id: userId, qsId, isDemo: 1 });
  createProfileRows(
    userId,
    {
      displayName: person.displayName,
      dateOfBirth: person.dateOfBirth,
      age,
      gender: person.gender,
      bio: person.bio,
      country: person.country,
      countryName: countryLabel(person.country),
      city: person.city,
      region: person.region,
      latitude: person.latitude,
      longitude: person.longitude,
      interests: person.interests,
      languages: person.languages,
      intentions: person.intentions,
      setupComplete: true,
    },
    {
      ageMin: person.prefs.ageMin,
      ageMax: person.prefs.ageMax,
      genders: person.prefs.genders,
      intentions: person.intentions,
      interests: [],
      languages: [],
      searchMode: person.prefs.searchMode,
      radiusKm: person.prefs.radiusKm,
      countries: person.prefs.countries,
      city: person.city,
      country: person.country,
      latitude: person.latitude,
      longitude: person.longitude,
    }
  );

  // Demo users get a shareable contact method so the exchange flow is testable.
  db()
    .prepare(
      `INSERT INTO contact_methods (id, user_id, type, label, value, shareable, created_at)
       VALUES (?, ?, 'instagram', 'Instagram', ?, 1, ?)`
    )
    .run(newId('ctc'), userId, `@${person.displayName.toLowerCase()}_demo`, nowIso());

  created += 1;
}

const total = db().prepare('SELECT COUNT(*) AS c FROM users WHERE is_demo = 1').get().c;
console.log(`Demo seed complete. Created ${created}, skipped ${skipped}.`);
console.log(`Demo profiles in database: ${total} (all tagged is_demo=1 and shown with a DEMO badge).`);
