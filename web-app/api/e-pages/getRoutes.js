import handler from './lib/respond.js'
import { readRoutes } from './lib/routesInfo.js'

/**
 * GET /e-pages/routes
 * Endpoints from web-app/routes.js with their handler files
 * (autofill for data-src of e-json, data-request-url of e-form buttons...).
 */
export default handler(() => readRoutes())
