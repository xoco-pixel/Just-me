/**
 * QuickSense configuration.
 *
 * Everything that differs between development and production lives here so that
 * demo data, verbose logging and generated admin credentials can never leak into
 * a production deployment by accident.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const env = (process.env.NODE_ENV || 'development').toLowerCase();
const isProduction = env === 'production';

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  env,
  isProduction,
  isDevelopment: !isProduction,

  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',

  // --- Persistence -----------------------------------------------------------
  // SQLite file. In production this MUST live on a volume that survives restarts.
  dbPath: process.env.QUICKSENSE_DB || path.join(ROOT, 'data', 'quicksense.db'),
  uploadDir: process.env.QUICKSENSE_UPLOADS || path.join(ROOT, 'data', 'uploads'),

  // --- Uploads ---------------------------------------------------------------
  maxUploadBytes: int(process.env.QUICKSENSE_MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
  maxPhotosPerUser: int(process.env.QUICKSENSE_MAX_PHOTOS, 6),
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],

  // --- Sessions / identity ---------------------------------------------------
  sessionTtlDays: int(process.env.QUICKSENSE_SESSION_TTL_DAYS, 180),
  recoveryCodeTtlDays: int(process.env.QUICKSENSE_RECOVERY_TTL_DAYS, 3650),
  cookieName: 'qs_session',
  secureCookies: bool(process.env.QUICKSENSE_SECURE_COOKIES, isProduction),

  // --- Product rules ---------------------------------------------------------
  minimumAge: 18,
  maximumAge: 100,
  defaultPreferences: {
    ageMin: 18,
    ageMax: 45,
    genders: [],
    intentions: [],
    interests: [],
    languages: [],
    searchMode: 'worldwide',
    radiusKm: 100,
    countries: [],
    city: null,
    country: null,
    latitude: null,
    longitude: null,
  },

  // --- Matching engine -------------------------------------------------------
  matching: {
    weights: {
      interests: 0.3,
      intention: 0.2,
      location: 0.2,
      age: 0.2,
      language: 0.05,
      extra: 0.05,
    },
    // Caps applied when a preference is only satisfied in ONE direction.
    // Two-way compatibility is a product requirement: a match that only works for
    // one person is never allowed to look like a strong match.
    caps: {
      mutualAgeFailed: 42,
      mutualLocationFailed: 45,
      mutualIntentionFailed: 40,
    },
    minResultScore: int(process.env.QUICKSENSE_MIN_SCORE, 20),
    maxResultsPerSearch: int(process.env.QUICKSENSE_MAX_RESULTS, 25),
  },

  // --- Rate limiting (per IP, sliding window) --------------------------------
  // In-memory buckets: effective for a single node. Documented, not overstated.
  rateLimits: {
    windowMs: 60_000,
    sensitive: int(process.env.QUICKSENSE_RATE_SENSITIVE, 30),
    upload: int(process.env.QUICKSENSE_RATE_UPLOAD, 20),
    search: int(process.env.QUICKSENSE_RATE_SEARCH, 20),
    auth: int(process.env.QUICKSENSE_RATE_AUTH, 20),
    // Only ever disabled by the automated test suite, which shares one source IP
    // across many synthetic accounts. Production never sets this.
    enabled: bool(process.env.QUICKSENSE_RATE_LIMITS, env !== 'test'),
  },

  // --- Admin -----------------------------------------------------------------
  // No hard-coded admin password. In development an admin account is created with
  // a generated password that is printed to the server log ONCE. In production
  // QUICKSENSE_ADMIN_EMAIL + QUICKSENSE_ADMIN_PASSWORD are required.
  admin: {
    email: process.env.QUICKSENSE_ADMIN_EMAIL || (isProduction ? null : 'admin@quicksense.local'),
    password: process.env.QUICKSENSE_ADMIN_PASSWORD || null,
  },

  // --- Demo data -------------------------------------------------------------
  // Demo users are tagged is_demo=1 and rendered with a DEMO badge. Seeding is
  // refused entirely when NODE_ENV=production.
  allowDemoData: !isProduction,
};

export default config;
