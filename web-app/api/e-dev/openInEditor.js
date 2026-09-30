import fs from 'fs'

import handler from './lib/respond.js'
import openInEditorProcess from './lib/editor.js'
import { projectFile, fileOfUrl, relativeToProject } from './lib/paths.js'
import settings from './lib/settings.js'

/**
 * POST /e-dev/open-in-editor { file: "web-app/api/getHealth.js", line, column, search }
 *                             { url: "/js/e-ui/e-date.js?v=1", line, column } (a file served by the app)
 * Opens the file in the editor from config (eDev.editor, "subl" by default).
 * Without `line`, the first line that contains `search` is used (e.g. '[is="e-stack"]' in e-ui.css).
 */
export default handler(({ body }) => {
  const file = body.url ? fileOfUrl(String(body.url)) : projectFile(body.file)
  if (!file || !fs.existsSync(file)) {
    throw Object.assign(new Error(`${body.url || body.file} doesn't exist`), { statusCode: 404 })
  }
  let line = body.line
  if (!line && body.search) {
    const content = fs.readFileSync(file, 'utf-8')
    const index = content.indexOf(String(body.search))
    line = index === -1 ? 1 : content.slice(0, index).split('\n').length
  }
  const editor = settings().editor
  const result = openInEditorProcess(file, line, body.column, editor)
  return { file: relativeToProject(file), ...result }
})
