// Runs on the server right after `git pull` (see deploy.sh → "pull").
// Static files are served straight from disk, so updating ?v= cache versions
// is all that's needed for static changes to reach browsers without a restart.
import setupFileLogging from '#nodes/setupFileLogging.js'
import updateCacheVersions from '#web-app/cache.js'

const environment = process.env.ENV || 'local'

if (environment !== 'local') {
  // Store logs into output.log so they don't pollute stdout
  setupFileLogging('./output.log')
  await updateCacheVersions()
  console.log(`[OK] Cache versions updated (environment: ${environment}).`)
} else {
  console.log('[OK] Nothing to do locally.')
}
