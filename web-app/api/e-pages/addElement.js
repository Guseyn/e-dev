import handler from './lib/respond.js'
import { loadModel, saveModel, assertVersion, cloneModel, createElement, insertElement, syncImports } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/**
 * POST /e-pages/element/add
 * { page, version, parentId, index, tag, attributes: [{ name, value }], text, innerHTML, requires }
 * `index` is the position among element children of the parent (appended if empty).
 * `requires`: scripts the element needs (like "#e-ui/e-toast.js"), imported in the page if missing.
 */
export default handler(({ body }) => {
  const page = normalizePage(body.page)
  const model = loadModel(page)
  assertVersion(model, body.version)
  const previous = cloneModel(model)
  const node = createElement(model, body)
  insertElement(model, body.parentId, body.index, node)
  // Scripts of components inside the new element (and of templates it loads)
  const imports = syncImports(page, model, [node], listOf(body.requires))
  const saved = saveModel(page, model, previous)
  return { id: node.id || null, version: saved.version, line: node.id ? saved.lines[node.id] : null, imports }
})

// e-form sends arrays as arrays, but a comma separated string is fine too
function listOf(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return String(value).split(',').map(s => s.trim()).filter(Boolean)
}
