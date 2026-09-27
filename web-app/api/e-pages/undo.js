import handler from './lib/respond.js'
import { undo, undoAvailable, redoAvailable } from './lib/model.js'
import { normalizePage } from './lib/paths.js'

/** POST /e-pages/undo { page } — restores the previous version of the page */
export default handler(({ body }) => {
  const page = normalizePage(body.page)
  const model = undo(page)
  return { version: model.version, undoAvailable: undoAvailable(page), redoAvailable: redoAvailable(page) }
})
