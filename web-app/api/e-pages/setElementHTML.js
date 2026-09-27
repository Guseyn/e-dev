import handler from './lib/respond.js'
import { loadModel, saveModel, assertVersion, cloneModel, replaceChildrenWithHTML, syncImports } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/**
 * POST /e-pages/element/html { page, version, id, html }
 * Replaces the inner html of the element: the html is parsed into the page model,
 * then the html file is generated from the model as with any other change.
 */
export default handler(({ body }) => {
  const page = normalizePage(body.page)
  const model = loadModel(page)
  assertVersion(model, body.version)
  const previous = cloneModel(model)
  const node = replaceChildrenWithHTML(model, body.id, body.html)
  // Components written in the html get their scripts imported too
  const imports = syncImports(page, model, node.children)
  const saved = saveModel(page, model, previous)
  return { id: body.id, version: saved.version, imports }
})
