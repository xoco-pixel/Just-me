# QuickSense

**Meet people who make sense for you.**

An 18+ compatibility-first matching platform. Instead of endless swiping, QuickSense
calculates real compatibility from real stored preferences, explains **why** two people
matched, and only reveals contact details after **both** people consent.

This is a working full-stack application: real server, real persistent database, real
matching engine. Nothing here is a mock.

---

## The one rule this project follows

> **If it looks like it works, it must actually work. If it can't work yet, say so — do not fake it.**

Every button, toggle and screen in this app is either fully implemented or explicitly
labelled as not implemented. There are no decorative controls, no hard-coded match
scores, no fake users and no fake success messages.

---

## Quick start

```bash
npm install          # install dependencies
npm run migrate      # create the database and seed the vocabularies
npm run seed:demo    # optional: add 8 clearly-labelled DEMO profiles
npm start            # http://localhost:3000
```

Requires **Node.js 22.5+** (uses the built-in `node:sqlite` engine — no native compile).

```bash
npm test             # 46 tests: matching engine, API, and client screens
```

### Admin

On first boot in development the server creates an admin account and prints the
**generated password to the log once**. Sign in at `/#/admin-login` → the app uses
`POST /api/auth/login` with the admin email/password.

In production you must set `QUICKSENSE_ADMIN_PASSWORD`; the server refuses to start
without it, so there is never a default password in a live deployment.

---

## How the matching engine works

`server/services/matching.js` is a pure, deterministic module — no database access, no
randomness. Given two people it returns a score and the reasons behind it.

| Factor | Weight |
| --- | --- |
| Shared interests | 30% |
| Relationship intention | 20% |
| Location / search area | 20% |
| Age preference | 20% |
| Language | 5% |
| Other shared criteria | 5% |

**Two-way compatibility is enforced.** A preference that only works in one direction is
not allowed to look like a strong match. If the age preference fails mutually the score
is capped at 42, location at 45, intention at 40 — so a one-sided match can never be
presented as a great one. Gender preference that fails in either direction is a hard
gate: the pair is never shown at all.

The score is always recomputed **server-side** from database values. The client never
supplies a compatibility score, and the server never trusts one.

### "Why did we match?"

Every result carries explanations generated from the data that actually produced the
score — and honest negative signals when a two-way check failed:

```
86%  Sam · 25 · Nigeria
  🎯 You both like Music, Gaming and Food
  💬 You're both open to Dating and Friendship
  🌎 You both want international connections
```

---

## Contact exchange requires two approvals

This is QuickSense's core safety idea, and it is enforced on the server, not just in the UI.

1. Both people must **mutually match** first.
2. Either can request an exchange — backed by a real database record.
3. The request lands as a real notification for the other person.
4. Contact values are returned **only** when `requester_status = accepted` **AND**
   `recipient_status = accepted`.

`getExchangeDetails()` is the single place in the codebase that returns contact values,
and it re-checks both statuses itself. Verified by test: reading details before the other
person accepts returns **403**, and a third party gets **403** too.

If either person declines, nothing is revealed — ever.

---

## Architecture

```
server/
  index.js              express app, admin bootstrap, capabilities manifest
  config.js             environment, rate limits, matching weights
  db/schema.sql         18 tables
  services/
    matching.js         compatibility engine (pure)
    search.js           candidate discovery, persists discoveries
    matches.js          like/pass → mutual match
    exchange.js         two-person consent gate
    notifications.js    real events only, respects preferences
    safety.js           block / report
    moderation.js       rule-based flags (not ML — see below)
    photos.js           upload validation + storage
    users.js            profiles, preferences, participants
  routes/               12 API route modules
public/
  index.html            mobile-first shell
  css/app.css           design system
  js/                   api client, router, 9 screen modules
tests/                  46 tests
```

### Data model

18 tables: `users`, `sessions`, `recovery_codes`, `profiles`, `photos`, `preferences`,
`contact_methods`, `matches`, `match_actions`, `discoveries`, `contact_exchanges`,
`notifications`, `profile_views`, `blocks`, `reports`, `moderation_flags`,
`security_log`, `taxonomy`.

Interests, intentions, genders, languages, countries and contact types are seeded into
the `taxonomy` table. The API rejects any value not in it, so clients cannot invent
matching vocabulary.

### Identity without a password

Onboarding creates an anonymous **QuickSense ID** (`QS-7F29K4`) and a device session.
The client stores an opaque token; the database stores only its **hash**.

- **Reinstall on the same device** → *Restore My QuickSense* reuses the session.
- **New device** → a recovery code (`QS-XXXX-XXXX-XXXX`), optionally linked to an email.

Recovery codes are stored hashed and shown once.

---

## Security and privacy

- Session tokens and recovery codes are stored as SHA-256 hashes only.
- Passwords use `scrypt` with a per-password salt.
- Rate limits on auth, uploads, searches and sensitive actions (per IP, sliding window).
- Uploads are validated by declared MIME **and** magic bytes; a file renamed `.png` is
  rejected. Files are written, then `stat`-verified before success is reported.
- Photos are served only to authenticated sessions and are never publicly readable.
- Locations are stored coarse — city/region, plus coordinates rounded to ~1 km when
  distance search is enabled. **Exact addresses are never stored or shown.**
- Admin routes require `role = 'admin'`; admin actions are written to `security_log`.
- Per-field visibility controls (bio, city, interests, intentions…) are honoured by the
  API when building public profiles.
- Account deletion removes the user and cascades to all their data.

---

## What is NOT implemented

Stated plainly, per the rule above. The app exposes these at `GET /api/capabilities`
rather than hiding them behind polished UI.

| Not implemented | Why it says so |
| --- | --- |
| **Email delivery** | No SMTP transport. Recovery codes are shown in-app once; the API returns `emailDelivery: 'not_configured'` instead of claiming an email was sent. |
| **Push notifications** | In-app notifications only. |
| **Automated image analysis** | Photos are stored with `moderation_status = 'pending'` for **human** review in the admin queue. No automated scan runs, so the UI says "pending review", not "verified". |
| **Payments** | No monetisation, subscriptions or card handling. |
| **Native mobile app** | This is a mobile-first **web** app, not an iOS/Android binary. |
| **Server-side image resizing / EXIF stripping** | Uploads are validated and stored as-is. |
| **Automated scam detection (ML)** | The moderation rules are deterministic pattern checks — scam phrases, contact details in bios, duplicate profiles, rapid-action rates. They create **flags for human review**; they never claim to have verified anyone. |

Settings that are implemented genuinely work: turning off a notification type means the
notification is never created server-side; hiding from search removes you from other
people's results and clears their stored discoveries.

---

## Demo data

`npm run seed:demo` adds 8 profiles tagged `is_demo = 1`. They render with a **DEMO**
badge everywhere they appear, and the command **refuses to run** when
`NODE_ENV=production` — so development users can never leak into production data.

---

## Testing

46 tests across three layers, all against a real server and a real database:

- **`tests/matching.test.js`** (13) — the engine: scoring, two-way caps, gender gates,
  18+ enforcement, distance maths, deterministic output.
- **`tests/api.test.js`** (20) — end-to-end HTTP: registration, profile validation,
  two-way matching, the consent gate (403 before / unlocked after), blocks, reports,
  notification preferences, photo validation, restore, deletion, admin.
- **`tests/client.test.js`** (13) — the real browser modules executed against a DOM:
  every screen renders, mounts and wires its handlers without throwing.

`scripts/smoke-test.sh` runs a full walkthrough against a live server.

---

## Known limitations

- SQLite on a single node is fine for development and small deployments. Moving to
  Postgres means replacing `server/db/index.js`; the services above it are unchanged.
- Rate limiting is in-memory, so it is per-instance rather than cluster-wide.
- The matching engine is O(n) over eligible profiles per search, which is fine to a few
  tens of thousands of users; beyond that it needs indexing and pre-filtering.
- No email transport, so there is no automated way to recover a lost device *and* a lost
  recovery code.
