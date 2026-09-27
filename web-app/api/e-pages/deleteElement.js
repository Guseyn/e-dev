import handler from './lib/respond.js'
import { loadModel, saveModel, assertVersion, cloneModel, removeElement } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/** POST /e-pages/element/delete { page, version, id } */
export default handler(({ body }) => {
  const page = normalizePage(body.page)
  const model = loadModel(page)
  assertVersion(model, body.version)
  const previous = cloneModel(model)
  removeElement(model, body.id)
  const saved = saveModel(page, model, previous)
  return { version: saved.version }
})
