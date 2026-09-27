import { pathToFileURL } from 'url'
import updateCacheVersionsInUrls from '#nodes/updateCacheVersionsInUrls.js'

/**
 * Rewrites ?v=<hash> in static files (html, md, import maps, js imports)
 * based on real file hashes, so browsers re-download only changed files.
 */
export default async function updateCacheVersions() {
  await updateCacheVersionsInUrls('web-app/static')
}

/* Run directly: `node web-app/cache.js` */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await updateCacheVersions()
}
