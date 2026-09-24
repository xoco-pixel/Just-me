/** Applies the schema to the configured database. Safe to run repeatedly. */
import config from '../config.js';
import { db, initDatabase, verifySchema } from './index.js';
import { seedTaxonomy } from '../lib/taxonomy.js';

const database = initDatabase(config.dbPath);
seedTaxonomy();

const tables = database
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);

console.log(`Schema applied to ${config.dbPath}`);
console.log(`Tables (${tables.length}): ${tables.join(', ')}`);
console.log(`Taxonomy rows: ${db().prepare('SELECT COUNT(*) AS c FROM taxonomy').get().c}`);
console.log(`Self-check: ${verifySchema() ? 'OK' : 'FAILED'}`);
