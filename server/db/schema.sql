-- QuickSense schema
-- SQLite (node:sqlite). JSON-valued columns are stored as TEXT and validated in JS.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  qs_id         TEXT NOT NULL UNIQUE,          -- public QuickSense ID, e.g. QS-7F29K4
  email         TEXT UNIQUE,                   -- optional recovery method
  password_hash TEXT,                          -- optional; null = accountless device identity
  role          TEXT NOT NULL DEFAULT 'user',  -- user | admin
  status        TEXT NOT NULL DEFAULT 'active',-- active | suspended | deleted
  is_demo       INTEGER NOT NULL DEFAULT 0,
  settings      TEXT NOT NULL DEFAULT '{}',    -- privacy + notification preferences
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,            -- only the hash is stored
  kind        TEXT NOT NULL DEFAULT 'device',  -- device | admin
  user_agent  TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Recovery codes let a user restore their QuickSense on a new device.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,                 -- ISO yyyy-mm-dd
  age           INTEGER NOT NULL,              -- derived, refreshed on write
  gender        TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL,                 -- ISO-3166 alpha-2
  country_name  TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  region        TEXT NOT NULL DEFAULT '',
  latitude      REAL,                          -- optional, coarse; never a home address
  longitude     REAL,
  location_precision TEXT NOT NULL DEFAULT 'city', -- city | region | country
  interests     TEXT NOT NULL DEFAULT '[]',
  languages     TEXT NOT NULL DEFAULT '[]',
  intentions    TEXT NOT NULL DEFAULT '[]',    -- what they are looking for
  visibility    TEXT NOT NULL DEFAULT '{}',    -- per-field public/private
  setup_complete INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_country ON profiles(country);
CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age);

CREATE TABLE IF NOT EXISTS photos (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path              TEXT NOT NULL,             -- relative to uploadDir
  mime              TEXT NOT NULL,
  bytes             INTEGER NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id, position);

CREATE TABLE IF NOT EXISTS preferences (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_min     INTEGER NOT NULL DEFAULT 18,
  age_max     INTEGER NOT NULL DEFAULT 45,
  genders     TEXT NOT NULL DEFAULT '[]',      -- [] = open to any
  intentions  TEXT NOT NULL DEFAULT '[]',
  interests   TEXT NOT NULL DEFAULT '[]',      -- preferred shared interests
  languages   TEXT NOT NULL DEFAULT '[]',
  search_mode TEXT NOT NULL DEFAULT 'worldwide', -- nearby|city|country|countries|worldwide|radius
  radius_km   INTEGER NOT NULL DEFAULT 100,
  countries   TEXT NOT NULL DEFAULT '[]',
  city        TEXT,
  country     TEXT,
  latitude    REAL,
  longitude   REAL,
  extra       TEXT NOT NULL DEFAULT '{}',      -- forward-compatible extra criteria
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_methods (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                   -- phone | email | instagram | x | snapchat | whatsapp | other
  label       TEXT NOT NULL DEFAULT '',
  value       TEXT NOT NULL,
  shareable   INTEGER NOT NULL DEFAULT 0,      -- 1 = may be revealed after MUTUAL consent
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, type, value)
);
CREATE INDEX IF NOT EXISTS idx_contact_user ON contact_methods(user_id);

-- ---------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id           TEXT PRIMARY KEY,
  user_a       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL,
  score        INTEGER NOT NULL,
  reasons      TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | mutual | cancelled
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_matches_a ON matches(user_a, status);
CREATE INDEX IF NOT EXISTS idx_matches_b ON matches(user_b, status);

CREATE TABLE IF NOT EXISTS match_actions (
  id         TEXT PRIMARY KEY,
  match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,                     -- like | pass
  created_at TEXT NOT NULL,
  UNIQUE(match_id, user_id)
);

-- Persisted results of a real matching-engine run, so "Potential Matches" is
-- genuine stored state rather than something recomputed on every page load.
CREATE TABLE IF NOT EXISTS discoveries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  reasons     TEXT NOT NULL DEFAULT '[]',
  components  TEXT NOT NULL DEFAULT '{}',
  seen        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_discoveries_user ON discoveries(user_id, score DESC);

-- ---------------------------------------------------------------------------
-- Contact exchange (two-person consent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_exchanges (
  id                TEXT PRIMARY KEY,
  requester_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_status  TEXT NOT NULL DEFAULT 'accepted', -- accepted | declined
  recipient_status  TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | unlocked | declined | cancelled
  unlocked_at       TEXT,
  cancelled_reason  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exch_recipient ON contact_exchanges(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_exch_requester ON contact_exchanges(requester_id, status);

-- ---------------------------------------------------------------------------
-- Notifications, safety, moderation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  ref_type   TEXT,
  ref_id     TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profile_views (
  id         TEXT PRIMARY KEY,
  viewer_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,                     -- yyyy-mm-dd, used to de-duplicate
  created_at TEXT NOT NULL,
  UNIQUE(viewer_id, viewed_id, day)
);
CREATE INDEX IF NOT EXISTS idx_views_viewed ON profile_views(viewed_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blocks (
  id         TEXT PRIMARY KEY,
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

CREATE TABLE IF NOT EXISTS reports (
  id             TEXT PRIMARY KEY,
  reporter_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | reviewed | dismissed
  resolution     TEXT,
  reviewed_by    TEXT REFERENCES users(id),
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_flags (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                     -- bio_text | contact_value | duplicate_profile | rapid_action
  detail     TEXT NOT NULL DEFAULT '',
  severity   TEXT NOT NULL DEFAULT 'low',       -- low | medium | high
  status     TEXT NOT NULL DEFAULT 'open',      -- open | cleared
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flags_status ON moderation_flags(status, severity);

-- Canonical, server-owned vocabularies. Profiles reference these values, so the
-- interest/intention/gender lists are real stored data rather than client strings.
CREATE TABLE IF NOT EXISTS taxonomy (
  kind     TEXT NOT NULL,
  value    TEXT NOT NULL,
  label    TEXT NOT NULL,
  emoji    TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, value)
);

CREATE TABLE IF NOT EXISTS security_log (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_seclog_at ON security_log(at DESC);
