import handler from './lib/respond.js'
import { loadModel, saveModel, assertVersion, cloneModel, moveElement } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/** POST /e-pages/element/move { page, version, id, parentId, index } */
export default handler(({ body }) => {
  const page = normalizePage(body.page)
  const model = loadModel(page)
  assertVersion(model, body.version)
  const previous = cloneModel(model)
  moveElement(model, body.id, body.parentId, body.index)
  const saved = saveModel(page, model, previous)
  return { id: body.id, version: saved.version, line: saved.lines[body.id] }
})
