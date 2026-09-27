import handler from './lib/respond.js'
import { redo, undoAvailable, redoAvailable } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/** POST /e-pages/redo { page } — brings back the change that was undone */
export default handler(({ body }) => {
  const page = normalizePage(body.page)
  const model = redo(page)
  return { version: model.version, undoAvailable: undoAvailable(page), redoAvailable: redoAvailable(page) }
})
