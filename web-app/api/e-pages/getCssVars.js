import handler from './lib/respond.js'
import { readCssVars } from './lib/cssVars.js'

/**
 * GET /e-pages/css-vars
 * CSS variables of e-ui (and fonts.css) with their overrides from app.css.
 */
export default handler(() => readCssVars())
