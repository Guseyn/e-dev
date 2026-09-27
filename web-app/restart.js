// Zero-downtime restart of workers (everything that worker.js imports).
// Changes in main.js / primary.js require a full rerun of the app instead.
import fs from 'fs/promises'

import setupFileLogging from '#nodes/setupFileLogging.js'
import migrate from '#web-app/runners/migrate.js'
import updateCacheVersions from '#web-app/cache.js'

const environment = process.env.ENV || 'local'

try {
  /* ────────────────────────────────────────────────────────────── */
  /* LOAD PRIMARY PROCESS PID, APP VERSION AND CONFIG               */
  /* ────────────────────────────────────────────────────────────── */
  const primaryProcessId = Number((await fs.readFile('primary.pid', 'utf-8')).trim())
  const { version } = JSON.parse(await fs.readFile('./package.json', 'utf-8'))
  const config = JSON.parse(await fs.readFile(`./web-app/env/${environment}.json`, 'utf-8'))

  if (environment !== 'local') {
    setupFileLogging('./output.log')
    await updateCacheVersions()
  }

  /* ────────────────────────────────────────────────────────────── */
  /* RUN DATABASE MIGRATIONS BEFORE NEW WORKERS START               */
  /* ────────────────────────────────────────────────────────────── */
  await migrate(config)

  /* ────────────────────────────────────────────────────────────── */
  /* ASK PRIMARY PROCESS TO RESTART WORKERS ONE BY ONE              */
  /* ────────────────────────────────────────────────────────────── */
  process.kill(primaryProcessId, 'SIGUSR1')

  console.log(`
[OK] Sent SIGUSR1 to the primary process (pid: ${primaryProcessId}).
Version: ${version}, environment: ${environment}.

Workers are restarted one by one, so the app keeps serving requests.
If you changed main.js or primary.js, rerun the whole app instead.
`)
} catch (error) {
  if (error.code === 'ENOENT' && String(error.path).endsWith('primary.pid')) {
    console.error('[ERR] primary.pid not found: the app is not running (start it with npm start).')
  } else if (error.code === 'ESRCH') {
    console.error('[ERR] The process from primary.pid is not running anymore (start the app with npm start).')
  } else {
    console.error('[ERR]', error)
  }
  process.exit(1)
}
