import handler from './lib/respond.js'
import { resolveUrl } from './lib/routesInfo.js'

/**
 * GET /e-dev/resolve-src?url=/posts/${id}&method=GET
 * Endpoint and handler file for a url used in html.
 */
export default handler(({ queries }) => {
  const url = decodeURIComponent(queries.url || '')
  const method = decodeURIComponent(queries.method || 'GET')
  return { url, route: resolveUrl(url, method) }
})
