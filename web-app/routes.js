import endpoint from '#nodes/endpoint.js'
import src from '#nodes/src.js'

/* ──────────────────────────────────────────────────────────────── */
/* API HANDLERS (one handler per file in web-app/api)               */
/* ──────────────────────────────────────────────────────────────── */
// Keep one `import handler from '#web-app/api/...'` per line and
// `endpoint(url, method, handler)` calls below: e-dev reads this file
// to map endpoints (like data-src on e-json) to handler files.
import getHealth from '#web-app/api/getHealth.js'

const STATIC_FOLDER = './web-app/static'
const NOT_FOUND_PAGE = './web-app/static/html/404.html'

/**
 * All routes of the app. Used by worker.js,
 * and by e-dev (locally) to list available endpoints.
 *
 * @param {any} config
 */
export default async function routes(config) {
  const api = [
    endpoint('/health', 'GET', getHealth)
  ]

  // e-dev endpoints open files in the code editor and serve html with source locations,
  // so they must never exist outside of local environment
  if (config.env === 'local') {
    const { default: eDevApi } = await import('#web-app/api/e-dev/routes.js')
    api.push(...eDevApi(config))
  }

  return {
    indexFile: `${STATIC_FOLDER}/html/index.html`,
    api,
    static: [
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
