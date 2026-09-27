import handler from './lib/respond.js'
import { loadModel, htmlOfElement } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/**
 * GET /e-pages/element/html?path=html/index.html&id=n12
 * Inner and outer html of the element (for "Edit as HTML" and the subtree preview).
 */
export default handler(({ queries }) => {
  const page = normalizePage(decodeURIComponent(queries.path || ''))
  const model = loadModel(page)
  return { version: model.version, ...htmlOfElement(model, decodeURIComponent(queries.id || 'root')) }
})
