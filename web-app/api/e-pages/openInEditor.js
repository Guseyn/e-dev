import fs from 'fs'

import handler from './lib/respond.js'
import openInEditorProcess from './lib/editor.js'
import { projectFile, relativeToProject } from './lib/paths.js'

/**
 * POST /e-pages/open-in-editor { file: "web-app/api/getHealth.js", line, column, search }
 * Opens the file in the editor from config (ePages.editor, "subl" by default).
 * Without `line`, the first line that contains `search` is used (e.g. '[is="e-stack"]' in e-ui.css).
 */
export default handler(({ body, config }) => {
  const file = projectFile(body.file)
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error(`${body.file} doesn't exist`), { statusCode: 404 })
  }
  let line = body.line
  if (!line && body.search) {
    const index = fs.readFileSync(file, 'utf-8').indexOf(String(body.search))
    line = index === -1 ? 1 : fs.readFileSync(file, 'utf-8').slice(0, index).split('\n').length
  }
  const editor = (config.ePages && config.ePages.editor) || 'subl'
  const result = openInEditorProcess(file, line, body.column, editor)
  return { file: relativeToProject(file), ...result }
})
