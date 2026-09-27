import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import runtime from '#nodes/runtime.js'
import { connectionOptions } from '#web-app/db/client.js'

/* ──────────────────────────────────────────────────────────────── */
/* CONSTANTS                                                        */
/* ──────────────────────────────────────────────────────────────── */
const MIGRATIONS_DIR = path.join('web-app', 'db', 'migrations')
const SCHEMA_DIR = path.join('web-app', 'db', 'schema')
const SCHEMA_SUBDIRS = ['tables', 'triggers', 'indices', 'functions']

/* ──────────────────────────────────────────────────────────────── */
/* PG CLIENT FACTORY                                                */
/* ──────────────────────────────────────────────────────────────── */
async function createClient(config, database) {
  const { default: pg } = await import('pg')
  return new pg.Client(connectionOptions(config, database))
}

/* ──────────────────────────────────────────────────────────────── */
/* ENSURE DATABASE EXISTS                                           */
/* ──────────────────────────────────────────────────────────────── */
// CREATE DATABASE can't run while being connected to the target database,
// so we connect to the maintenance database (`postgres` by default).
// Managed databases often don't allow it, in that case we just continue,
// and connecting to the target database will tell if it really doesn't exist.
async function ensureDatabaseExists(config) {
  const targetDbName = config.db.database
  const maintenanceDbName = config.db.maintenanceDatabase || 'postgres'
  const client = await createClient(config, maintenanceDbName)
  try {
    await client.connect()
    const res = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1', [targetDbName]
    )
    if (res.rowCount === 0) {
      runtime.log('[migrate]', `Creating database: ${targetDbName}`)
      await client.query(`CREATE DATABASE "${targetDbName.replace(/"/g, '""')}"`)
    } else {
      runtime.log('[migrate]', `Database "${targetDbName}" already exists.`)
    }
  } catch (err) {
    runtime.log('[migrate]', `Could not check database "${targetDbName}" via "${maintenanceDbName}" (${err.message}). Continuing.`)
  } finally {
    await client.end().catch(() => {})
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* ENSURE MIGRATIONS TABLE EXISTS                                   */
/* ──────────────────────────────────────────────────────────────── */
async function ensureMigrationsTable(client, config) {
  runtime.log('[migrate]', 'Ensuring migrations table exists...')
  // The owning role has to be the configured user (not a provider-specific one like doadmin)
  const owner = `"${config.db.user.replace(/"/g, '""')}"`
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION ${owner};
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

/* ──────────────────────────────────────────────────────────────── */
/* SCHEMA SNAPSHOT                                                  */
/* ──────────────────────────────────────────────────────────────── */
// Snapshot is regenerated from scratch, so dropped tables/indices/... disappear from it too
function prepareSchemaDirs() {
  for (const subdir of SCHEMA_SUBDIRS) {
    const dir = path.join(SCHEMA_DIR, subdir)
    fs.mkdirSync(dir, { recursive: true })
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.sql')) {
        fs.unlinkSync(path.join(dir, file))
      }
    }
  }
}

function writeSchemaFile(subdir, name, sql) {
  const safeName = name
    .replace(/\s+/g, '_')
    .replace(/\(/g, '_')
    .replace(/\)/g, '')
    .replace(/,/g, '_')
  fs.writeFileSync(path.join(SCHEMA_DIR, subdir, `${safeName}.sql`), sql)
}

async function generateCreateTables(client) {
  const { rows } = await client.query(/*sql*/`
WITH tbls AS (
  SELECT c.oid AS tbl_oid, n.nspname AS schema_name, c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p')                              -- ordinary or partitioned tables
    AND n.nspname NOT IN ('pg_catalog','information_schema')
)
SELECT
  schema_name,
  table_name,
  'CREATE TABLE '
  || quote_ident(schema_name) || '.' || quote_ident(table_name) || E' (\n'
  || (
       SELECT string_agg(
         '  '
         || quote_ident(a.attname) || ' '
         || pg_catalog.format_type(a.atttypid, a.atttypmod)
         || CASE
              WHEN a.attidentity <> '' THEN
                   ' GENERATED ' || CASE a.attidentity WHEN 'a' THEN 'ALWAYS' ELSE 'BY DEFAULT' END || ' AS IDENTITY'
              WHEN a.attgenerated <> '' THEN
                   ' GENERATED ALWAYS AS (' || pg_get_expr(ad.adbin, ad.adrelid) || ') STORED'
              ELSE
                   COALESCE(' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid), '')
            END
         || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
       , E',\n' ORDER BY a.attnum)
       FROM pg_attribute a
       LEFT JOIN pg_attrdef ad
         ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       WHERE a.attrelid = tbl_oid AND a.attnum > 0 AND NOT a.attisdropped
     )
  || COALESCE(
       E',\n' || (
         SELECT string_agg('  '||condef, E',\n')
         FROM (
           SELECT 'CONSTRAINT '||quote_ident(conname)||' '||pg_get_constraintdef(oid, true) AS condef
           FROM pg_constraint
           WHERE conrelid = tbl_oid AND contype IN ('p','u','c','f','x')
           ORDER BY CASE contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'f' THEN 3 WHEN 'c' THEN 4 WHEN 'x' THEN 5 END
         ) s
       )
     , '')
  || E'\n);\n' AS create_table_sql
FROM tbls
ORDER BY schema_name, table_name;
`)
  for (const row of rows) {
    writeSchemaFile('tables', `${row.schema_name}.${row.table_name}`, row.create_table_sql)
  }
  runtime.log('[migrate]', `Generated ${rows.length} table(s)`)
}

async function generateTriggers(client) {
  const { rows } = await client.query(/*sql*/`
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid, true) || ';' AS create_trigger_sql
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY schema_name, table_name, t.tgname;
`)
  for (const row of rows) {
    writeSchemaFile('triggers', `${row.schema_name}.${row.table_name}.${row.trigger_name}`, row.create_trigger_sql)
  }
  runtime.log('[migrate]', `Generated ${rows.length} trigger(s)`)
}

async function generateIndices(client) {
  const { rows } = await client.query(/*sql*/`
SELECT
  n.nspname              AS schema_name,
  t.relname              AS table_name,
  idx.relname            AS index_name,
  pg_get_indexdef(i.indexrelid) || ';' AS create_index_sql
FROM pg_index i
JOIN pg_class      t   ON t.oid = i.indrelid
JOIN pg_namespace  n   ON n.oid = t.relnamespace
JOIN pg_class      idx ON idx.oid = i.indexrelid
LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND i.indisprimary = false
  AND c.oid IS NULL
ORDER BY schema_name, table_name, index_name;
`)
  for (const row of rows) {
    writeSchemaFile('indices', `${row.schema_name}.${row.table_name}.${row.index_name}`, row.create_index_sql)
  }
  runtime.log('[migrate]', `Generated ${rows.length} index(es)`)
}

async function generateFunctions(client) {
  const { rows } = await client.query(/*sql*/`
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_functiondef(p.oid) || ';' AS function_sql
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND p.prokind = 'f'         -- only functions, not aggregates or procedures
  AND p.prosrc IS NOT NULL    -- has source
ORDER BY schema_name, function_name;
`)
  for (const row of rows) {
    writeSchemaFile('functions', `${row.schema_name}.${row.function_name}`, row.function_sql)
  }
  runtime.log('[migrate]', `Generated ${rows.length} function(s)`)
}

/* ──────────────────────────────────────────────────────────────── */
/* MAIN MIGRATION RUNNER                                            */
/* ──────────────────────────────────────────────────────────────── */
/**
 * Runs all not yet applied migrations from web-app/db/migrations (sorted by name),
 * each one in its own transaction, and regenerates web-app/db/schema snapshot.
 *
 * Throws if any migration fails, so the app doesn't boot (or restart)
 * with a partially migrated database.
 *
 * @param {any} [config] defaults to web-app/env/${ENV}.json
 */
export default async function migrate(config) {
  config = config || JSON.parse(
    fs.readFileSync(path.join('web-app', 'env', `${process.env.ENV || 'local'}.json`), 'utf8')
  )

  if (!config.db) {
    runtime.log('[migrate]', 'No "db" in config, skipping migrations.')
    return
  }

  runtime.log('[migrate]', 'Starting migrations...')
  await ensureDatabaseExists(config)

  const client = await createClient(config)
  await client.connect()

  let currentMigration = null
  try {
    await ensureMigrationsTable(client, config)

    const applied = new Set(
      (await client.query('SELECT name FROM migrations')).rows.map(r => r.name)
    )

    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
      : []

    for (const file of files) {
      if (applied.has(file)) {
        continue
      }
      currentMigration = file
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      runtime.log('[migrate]', `Running migration: ${file}`)
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      currentMigration = null
    }

    prepareSchemaDirs()
    await generateCreateTables(client)
    await generateTriggers(client)
    await generateIndices(client)
    await generateFunctions(client)

    runtime.log('[migrate]', 'Migrations complete.')
  } catch (err) {
    // Without ROLLBACK the failed BEGIN stays open and holds locks
    await client.query('ROLLBACK').catch(() => {})
    if (currentMigration) {
      err.message = `Migration ${currentMigration} failed and was rolled back: ${err.message}`
    }
    throw err
  } finally {
    await client.end().catch(() => {})
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* RUN DIRECTLY: `npm run migrate`                                  */
/* ──────────────────────────────────────────────────────────────── */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await migrate()
  } catch (err) {
    console.error('[ERR]', err)
    process.exit(1)
  }
}
