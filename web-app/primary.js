import fs from 'fs'

import runtime from '#nodes/runtime.js'
import registerJobs from '#nodes/registerJobs.js'

import migrate from '#web-app/runners/migrate.js'
import updateCacheVersions from '#web-app/cache.js'

/* ──────────────────────────────────────────────────────────────── */
/* STARTUP BANNER: Logo + Version Info                              */
/* ──────────────────────────────────────────────────────────────── */
const txtLogo = fs.readFileSync('./web-app/logo.txt', 'utf-8')
const version = JSON.parse(fs.readFileSync('./package.json', 'utf-8')).version
const environment = process.env.ENV

runtime.log(
  `\x1b[33m${txtLogo}\n\n` +
  ` version: ${version}\n` +
  ` environment: ${environment}\x1b[0m`
)

/* ──────────────────────────────────────────────────────────────── */
/* STATIC ASSET VERSIONING (CACHE-BUSTING)                          */
/* ──────────────────────────────────────────────────────────────── */
// Locally files change all the time and `cacheControl` is `no-cache`,
// so we don't rewrite ?v= in files there.
if (environment !== 'local') {
  await updateCacheVersions()
  runtime.log('[OK] Static asset cache versions updated.')
}

/* ──────────────────────────────────────────────────────────────── */
/* DATABASE MIGRATIONS                                              */
/* ──────────────────────────────────────────────────────────────── */
// Throws on failure, so the app doesn't start with a partially migrated database
await migrate(runtime.config)

/* ──────────────────────────────────────────────────────────────── */
/* BACKGROUND JOBS                                                  */
/* ──────────────────────────────────────────────────────────────── */
// Jobs run only in the primary process, so each job runs once (not once per worker).
// Put job functions in web-app/jobs/ and register them here, for example:
//
// import someJob from '#web-app/jobs/someJob.js'
// import createDbClient from '#web-app/db/client.js'
// const dbClient = await createDbClient(runtime.config, { max: 5 })
// jobs.push({ name: 'someJob', everyMins: 5, fn: someJob, deps: { dbClient }, runOnStart: true })
const jobs = []

if (jobs.length > 0) {
  await registerJobs(jobs, runtime.log)
}
