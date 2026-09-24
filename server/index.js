/**
 * QuickSense server bootstrap.
 *
 * Responsibilities: open the real database, apply schema, seed vocabularies,
 * ensure an admin account exists, mount the API, serve the mobile-first client,
 * and run a startup self-check that fails loudly instead of serving a broken app.
 */
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';

import config, { ROOT } from './config.js';
import { db, initDatabase, verifySchema } from './db/index.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { ApiError } from './lib/errors.js';
import { generateToken, hashPassword, newId, nowIso } from './lib/util.js';
import { resetTaxonomyCache, seedTaxonomy } from './lib/taxonomy.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import preferencesRoutes from './routes/preferences.js';
import matchesRoutes from './routes/matches.js';
import exchangeRoutes from './routes/exchange.js';
import notificationsRoutes from './routes/notifications.js';
import safetyRoutes from './routes/safety.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';
import taxonomyRoutes from './routes/taxonomy.js';
import photosRoutes from './routes/photos.js';

export function createApp({ dbPath } = {}) {
  initDatabase(dbPath || config.dbPath);
  fs.mkdirSync(config.uploadDir, { recursive: true });
  seedTaxonomy();
  resetTaxonomyCache();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '12mb' }));
  app.use(cookieParser());

  // Basic security headers.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (req, res) => {
    const schemaOk = verifySchema();
    const users = schemaOk ? db().prepare('SELECT COUNT(*) AS c FROM users').get().c : 0;
    res.status(schemaOk ? 200 : 503).json({
      status: schemaOk ? 'ok' : 'database_unavailable',
      environment: config.env,
      demoDataEnabled: config.allowDemoData,
      users,
      serverTime: nowIso(),
    });
  });

  /** Declares exactly what is and is not implemented in this build. */
  app.get('/api/capabilities', (req, res) => {
    res.json({
      appName: 'QuickSense',
      tagline: 'Meet people who make sense for you.',
      minimumAge: config.minimumAge,
      environment: config.env,
      demoDataEnabled: config.allowDemoData,
      implemented: [
        'accountless_identity',
        'device_restore',
        'recovery_code_restore',
        'profile_creation_and_editing',
        'photo_upload_validation_storage',
        'interests_intentions_languages_taxonomy',
        'match_preferences',
        'location_search_modes',
        'matching_engine_with_reasons',
        'two_way_compatibility_gates',
        'match_actions_and_mutual_match',
        'contact_exchange_with_mutual_consent',
        'notifications_with_preferences',
        'profile_views',
        'block_and_report',
        'rule_based_moderation_flags',
        'admin_dashboard',
        'account_deletion',
        'privacy_field_visibility',
      ],
      notImplemented: [
        {
          feature: 'email_delivery',
          detail: 'No email transport is configured. Recovery codes are shown once in the app and never sent.',
        },
        {
          feature: 'push_notifications',
          detail: 'Notifications are in-app only.',
        },
        {
          feature: 'automated_image_analysis',
          detail: 'Photos are stored with moderation_status=pending for human review; no automated scan runs.',
        },
        {
          feature: 'payments',
          detail: 'No monetisation, subscriptions or card handling exists in this build.',
        },
        {
          feature: 'native_mobile_app',
          detail: 'This is a mobile-first web application, not an iOS/Android binary.',
        },
        {
          feature: 'image_resizing',
          detail: 'Uploads are validated and stored as-is; no server-side resizing or EXIF stripping.',
        },
      ],
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/preferences', preferencesRoutes);
  app.use('/api/matches', matchesRoutes);
  app.use('/api/exchange', exchangeRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/safety', safetyRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/taxonomy', taxonomyRoutes);
  app.use('/api/photos', photosRoutes);

  // /api/users/:id lives on the profile router.
  app.use('/api', profileRoutes);

  app.use('/api', notFoundHandler);

  const publicDir = path.join(ROOT, 'public');
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    const indexFile = path.join(publicDir, 'index.html');
    if (!fs.existsSync(indexFile)) {
      return next(
        ApiError.notFound('The client bundle is missing from /public. Run the build or restore the public folder.')
      );
    }
    res.sendFile(indexFile);
  });

  app.use(errorHandler);
  return app;
}

/** Creates the admin account if none exists. Never hard-codes a usable password. */
export function ensureAdminAccount() {
  const existing = db().prepare("SELECT id, qs_id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) return { created: false, qsId: existing.qs_id };

  const email = config.admin.email;
  let password = config.admin.password;
  let generated = false;
  if (!password) {
    if (config.isProduction) {
      throw new Error(
        'Refusing to start in production without QUICKSENSE_ADMIN_PASSWORD. Set it in the environment.'
      );
    }
    password = generateToken().slice(0, 16);
    generated = true;
  }
  const id = newId('usr');
  const qsId = 'QS-ADMIN1';
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO users (id, qs_id, email, password_hash, role, status, is_demo, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', 0, '{}', ?, ?)`
    )
    .run(id, qsId, email, hashPassword(password), now, now);

  return { created: true, qsId, email, password, generated };
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isDirectRun) {
  const app = createApp();
  const admin = ensureAdminAccount();
  if (admin.created) {
    console.log('\n┌─ QuickSense admin account created ─────────────────────────');
    console.log(`│  Sign in at /#/admin`);
    console.log(`│  Identifier : ${admin.email}`);
    console.log(
      admin.generated
        ? `│  Password   : ${admin.password}   (generated — change it after first sign-in)`
        : `│  Password   : (from QUICKSENSE_ADMIN_PASSWORD)`
    );
    console.log('└────────────────────────────────────────────────────────────\n');
  }
  const server = app.listen(config.port, config.host, () => {
    console.log(`QuickSense listening on http://${config.host}:${config.port} (${config.env})`);
    console.log(`Database: ${config.dbPath}`);
    console.log(`Uploads : ${config.uploadDir}`);
    if (config.allowDemoData) {
      console.log('Demo data is ENABLED. Run `npm run seed:demo` to add clearly-labelled demo profiles.');
    }
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
