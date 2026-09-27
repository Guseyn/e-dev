import handler from './lib/respond.js'
import { loadModel, saveModel, assertVersion, cloneModel, updateElement } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/**
 * POST /e-pages/element/update
 * { page, version, id, attributes: [{ name, value }], text }
 * `attributes` replaces all attributes; `text` replaces text content (only without child elements).
 */
export default handler(({ body }) => {
  const page = normalizePage(body.page)
  const model = loadModel(page)
  assertVersion(model, body.version)
  const previous = cloneModel(model)
  updateElement(model, body.id, body)
  const saved = saveModel(page, model, previous)
  return { id: body.id, version: saved.version, line: saved.lines[body.id] }
})
