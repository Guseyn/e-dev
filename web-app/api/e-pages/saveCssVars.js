import handler from './lib/respond.js'
import { writeCssVars } from './lib/cssVars.js'

/**
 * POST /e-pages/css-vars { vars: [{ name, value }] }
 * Saves overrides of CSS variables into the :root block of app.css (empty value = default).
 */
export default handler(({ body }) => writeCssVars(body.vars))
