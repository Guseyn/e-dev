import endpoint from '#nodes/endpoint.js'
import src from '#nodes/src.js'

/* ──────────────────────────────────────────────────────────────── */
/* API HANDLERS (one handler per file in web-app/api)               */
/* ──────────────────────────────────────────────────────────────── */
// Keep one `import handler from '#web-app/api/...'` per line and
// `endpoint(url, method, handler)` calls below: e-pages reads this file
// to map endpoints (like data-src on e-json) to handler files.
import getHealth from '#web-app/api/getHealth.js'

const STATIC_FOLDER = './web-app/static'
const NOT_FOUND_PAGE = './web-app/static/html/404.html'

/**
 * All routes of the app. Used by worker.js,
 * and by e-pages (locally) to list available endpoints.
 *
 * @param {any} config
 */
export default async function routes(config) {
  const api = [
    endpoint('/health', 'GET', getHealth)
  ]

  // e-pages endpoints modify files on disk,
  // so they must never exist outside of local environment
  if (config.env === 'local') {
    const { default: ePagesApi } = await import('#web-app/api/e-pages/routes.js')
    api.push(...ePagesApi(config))
  }

  return {
    indexFile: `${STATIC_FOLDER}/html/index.html`,
    api,
    static: [
      // static/json is not served on purpose: it has e-pages models of pages
      src(/^\/(css|js|images|font|md|xml|html)\//, {
        baseFolder: STATIC_FOLDER,
        useGzip: true,
        useCache: config.useCache,
        cacheControl: config.cacheControl,
        fileNotFound: NOT_FOUND_PAGE
      })
    ]
  }
}
