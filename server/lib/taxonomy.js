/**
 * Server-owned vocabularies.
 *
 * These values are seeded into the `taxonomy` table at migration time and are the
 * only values the API accepts for interests, intentions, genders, languages and
 * contact types. Clients cannot invent their own matching vocabulary.
 */
import { all, run, db } from '../db/index.js';

export const INTERESTS = [
  ['music', 'Music', '🎵'],
  ['gaming', 'Gaming', '🎮'],
  ['movies', 'Movies', '🎬'],
  ['travel', 'Travel', '✈️'],
  ['football', 'Football', '⚽'],
  ['technology', 'Technology', '💻'],
  ['education', 'Education', '📚'],
  ['art', 'Art', '🎨'],
  ['fitness', 'Fitness', '🏋️'],
  ['books', 'Books', '📖'],
  ['food', 'Food', '🍳'],
  ['photography', 'Photography', '📸'],
  ['afrobeats', 'Afrobeats', '🥁'],
  ['anime', 'Anime', '🌸'],
  ['fashion', 'Fashion', '👗'],
  ['hiking', 'Hiking', '🥾'],
  ['cooking', 'Cooking', '🍲'],
  ['dancing', 'Dancing', '💃'],
  ['spirituality', 'Spirituality', '🙏'],
  ['business', 'Business', '💼'],
  ['pets', 'Pets', '🐕'],
  ['volunteering', 'Volunteering', '🤝'],
].map(([value, label, emoji]) => ({ kind: 'interest', value, label, emoji }));

export const INTENTIONS = [
  ['dating', 'Dating', '❤️'],
  ['serious_relationship', 'Serious relationship', '💍'],
  ['friendship', 'Friendship', '🤝'],
  ['long_distance', 'Long-distance relationship', '🌉'],
  ['international', 'International connection', '🌎'],
  ['social', 'Social connection', '💬'],
  ['marriage', 'Marriage-minded', '💒'],
].map(([value, label, emoji]) => ({ kind: 'intention', value, label, emoji }));

export const GENDERS = [
  ['woman', 'Woman', '👩'],
  ['man', 'Man', '👨'],
  ['nonbinary', 'Non-binary', '🌈'],
  ['other', 'Other / self-describe', '✨'],
].map(([value, label, emoji]) => ({ kind: 'gender', value, label, emoji }));

export const LANGUAGES = [
  ['english', 'English', ''],
  ['french', 'French', ''],
  ['spanish', 'Spanish', ''],
  ['portuguese', 'Portuguese', ''],
  ['arabic', 'Arabic', ''],
  ['swahili', 'Swahili', ''],
  ['hausa', 'Hausa', ''],
  ['yoruba', 'Yoruba', ''],
  ['igbo', 'Igbo', ''],
  ['pidgin', 'Pidgin', ''],
  ['mandarin', 'Mandarin', ''],
  ['hindi', 'Hindi', ''],
  ['german', 'German', ''],
  ['italian', 'Italian', ''],
  ['russian', 'Russian', ''],
  ['japanese', 'Japanese', ''],
].map(([value, label, emoji]) => ({ kind: 'language', value, label, emoji }));

export const CONTACT_TYPES = [
  ['phone', 'Phone number', '📞'],
  ['email', 'Email', '✉️'],
  ['instagram', 'Instagram', '📷'],
  ['x', 'X', '🐦'],
  ['snapchat', 'Snapchat', '👻'],
  ['whatsapp', 'WhatsApp', '💬'],
  ['telegram', 'Telegram', '✈️'],
  ['other', 'Other', '🔗'],
].map(([value, label, emoji]) => ({ kind: 'contact_type', value, label, emoji }));

export const REPORT_CATEGORIES = [
  ['scam', 'Scam', ''],
  ['fake_profile', 'Fake profile', ''],
  ['harassment', 'Harassment', ''],
  ['spam', 'Spam', ''],
  ['impersonation', 'Impersonation', ''],
  ['inappropriate', 'Inappropriate behaviour', ''],
  ['underage', 'Suspected underage user', ''],
  ['other', 'Other safety concern', ''],
].map(([value, label, emoji]) => ({ kind: 'report_category', value, label, emoji }));

/**
 * Country list used for profile location and search-area selection.
 * Stored as taxonomy rows (kind='country') so location searching runs against
 * real stored values, not hard-coded client strings.
 */
const COUNTRY_ROWS = [
  'NG|Nigeria|🇳🇬', 'US|United States|🇺🇸', 'GB|United Kingdom|🇬🇧', 'CA|Canada|🇨🇦',
  'AU|Australia|🇦🇺', 'ZA|South Africa|🇿🇦', 'GH|Ghana|🇬🇭', 'KE|Kenya|🇰🇪',
  'EG|Egypt|🇪🇬', 'MA|Morocco|🇲🇦', 'DE|Germany|🇩🇪', 'FR|France|🇫🇷',
  'ES|Spain|🇪🇸', 'IT|Italy|🇮🇹', 'NL|Netherlands|🇳🇱', 'BE|Belgium|🇧🇪',
  'SE|Sweden|🇸🇪', 'NO|Norway|🇳🇴', 'DK|Denmark|🇩🇰', 'FI|Finland|🇫🇮',
  'PL|Poland|🇵🇱', 'PT|Portugal|🇵🇹', 'IE|Ireland|🇮🇪', 'CH|Switzerland|🇨🇭',
  'AT|Austria|🇦🇹', 'GR|Greece|🇬🇷', 'TR|Turkey|🇹🇷', 'AE|United Arab Emirates|🇦🇪',
  'SA|Saudi Arabia|🇸🇦', 'QA|Qatar|🇶🇦', 'IL|Israel|🇮🇱', 'IN|India|🇮🇳',
  'PK|Pakistan|🇵🇰', 'BD|Bangladesh|🇧🇩', 'CN|China|🇨🇳', 'JP|Japan|🇯🇵',
  'KR|South Korea|🇰🇷', 'ID|Indonesia|🇮🇩', 'MY|Malaysia|🇲🇾', 'SG|Singapore|🇸🇬',
  'PH|Philippines|🇵🇭', 'TH|Thailand|🇹🇭', 'VN|Vietnam|🇻🇳', 'NZ|New Zealand|🇳🇿',
  'BR|Brazil|🇧🇷', 'MX|Mexico|🇲🇽', 'AR|Argentina|🇦🇷', 'CL|Chile|🇨🇱',
  'CO|Colombia|🇨🇴', 'PE|Peru|🇵🇪', 'JM|Jamaica|🇯🇲', 'TT|Trinidad and Tobago|🇹🇹',
  'CM|Cameroon|🇨🇲', 'CI|Ivory Coast|🇨🇮', 'SN|Senegal|🇸🇳', 'TZ|Tanzania|🇹🇿',
  'UG|Uganda|🇺🇬', 'ET|Ethiopia|🇪🇹', 'RW|Rwanda|🇷🇼', 'ZM|Zambia|🇿🇲',
  'ZW|Zimbabwe|🇿🇼', 'BW|Botswana|🇧🇼', 'DZ|Algeria|🇩🇿', 'TN|Tunisia|🇹🇳',
  'UA|Ukraine|🇺🇦', 'RO|Romania|🇷🇴', 'CZ|Czechia|🇨🇿', 'HU|Hungary|🇭🇺',
  'RU|Russia|🇷🇺', 'IS|Iceland|🇮🇸',
].map((row, index) => {
  const [value, label, emoji] = row.split('|');
  return { kind: 'country', value, label, emoji, position: index };
});

export const ALL_TAXONOMY = [
  ...INTERESTS,
  ...INTENTIONS,
  ...GENDERS,
  ...LANGUAGES,
  ...CONTACT_TYPES,
  ...REPORT_CATEGORIES,
  ...COUNTRY_ROWS,
].map((item, index) => ({ ...item, position: item.position ?? index }));

/** Idempotently seed the taxonomy table. */
export function seedTaxonomy() {
  const insert = db().prepare(
    `INSERT INTO taxonomy (kind, value, label, emoji, position)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind, value) DO UPDATE SET label=excluded.label, emoji=excluded.emoji`
  );
  for (const item of ALL_TAXONOMY) {
    insert.run(item.kind, item.value, item.label, item.emoji ?? '', item.position ?? 0);
  }
}

export function listTaxonomy(kind) {
  return all(
    'SELECT value, label, emoji FROM taxonomy WHERE kind = ? ORDER BY position, label',
    [kind]
  );
}

const CACHE = new Map();

function valuesOf(kind) {
  if (!CACHE.has(kind)) {
    const rows = listTaxonomy(kind);
    CACHE.set(kind, new Set(rows.map((r) => r.value)));
  }
  return CACHE.get(kind);
}

export function resetTaxonomyCache() {
  CACHE.clear();
}

export const isKnownInterest = (v) => valuesOf('interest').has(v);
export const isKnownIntention = (v) => valuesOf('intention').has(v);
export const isKnownGender = (v) => valuesOf('gender').has(v);
export const isKnownLanguage = (v) => valuesOf('language').has(v);
export const isKnownContactType = (v) => valuesOf('contact_type').has(v);
export const isKnownCountry = (v) => valuesOf('country').has(v);
export const isKnownReportCategory = (v) => valuesOf('report_category').has(v);

export function filterKnown(list, predicate) {
  return [...new Set((Array.isArray(list) ? list : []).map(String))].filter(predicate);
}

/** Labels for a list of stored values, used by "Why did we match?" copy. */
export function labelsFor(kind, values) {
  const rows = listTaxonomy(kind);
  const map = new Map(rows.map((r) => [r.value, r]));
  return values.map((v) => map.get(v)).filter(Boolean);
}
