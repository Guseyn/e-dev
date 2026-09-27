import fs from 'fs'
import cluster from '#nodes/cluster.js'

/* ──────────────────────────────────────────────────────────────── */
/* SET DEFAULT ENVIRONMENT                                          */
/* ──────────────────────────────────────────────────────────────── */
process.env.ENV = process.env.ENV || 'local'

/* ──────────────────────────────────────────────────────────────── */
/* LOAD ENV CONFIG FILE                                             */
/* ──────────────────────────────────────────────────────────────── */
const configFile = `./web-app/env/${process.env.ENV}.json`
if (!fs.existsSync(configFile)) {
  console.error(`[ERR] Config file ${configFile} does not exist. Copy web-app/env/prod.example.json and fill it in.`)
  process.exit(1)
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
config.env = process.env.ENV

/* ──────────────────────────────────────────────────────────────── */
/* PREPARE LOG FILE (REMOTE ENVIRONMENTS ONLY)                      */
/* ──────────────────────────────────────────────────────────────── */
let logFile
if (process.env.ENV !== 'local') {
  logFile = './output.log'
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '', { flag: 'w' })
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* START PRIMARY + WORKER CLUSTER                                   */
/* ──────────────────────────────────────────────────────────────── */
cluster('web-app/primary.js', 'web-app/worker.js')({
  config,
  logFile,
  numberOfWorkers: process.env.WORKERS
    ? Number(process.env.WORKERS)
    : config.numberOfWorkers,
  // In milliseconds: time between restarts of each worker on `npm run restart`.
  // A disconnected worker is killed after 5s and its replacement loads worker.js after
  // another 5s, so it must be > 10s for the next worker to wait until the new one listens.
  restartTime: 12000
})
