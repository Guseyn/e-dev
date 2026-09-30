import fs from 'fs'
import { spawn, execFileSync } from 'child_process'

// Where editors put their command line tools when they are not in PATH
const KNOWN_LOCATIONS = {
  subl: [
    '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl',
    '/opt/sublime_text/sublime_text',
    '/usr/bin/subl',
    '/snap/bin/subl'
  ],
  code: [
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    '/usr/bin/code',
    '/snap/bin/code'
  ],
  zed: [
    '/Applications/Zed.app/Contents/MacOS/cli',
    '/usr/bin/zed'
  ]
}

const resolved = {}

function resolveBinary(editor) {
  if (resolved[editor]) {
    return resolved[editor]
  }
  try {
    const found = execFileSync('which', [editor], { encoding: 'utf-8' }).trim()
    if (found) {
      return (resolved[editor] = found)
    }
  } catch {
    // not in PATH
  }
  const known = (KNOWN_LOCATIONS[editor] || []).find(location => fs.existsSync(location))
  if (known) {
    return (resolved[editor] = known)
  }
  throw Object.assign(
    new Error(`Editor "${editor}" is not found. Put it in PATH or set "eDev.editor" in web-app/env/local.json`),
    { statusCode: 500 }
  )
}

/**
 * Opens a file at line:column in the editor from config (`eDev.editor`, "subl" by default).
 * Works like "open in editor" in dev servers: no browser protocol handler is needed.
 *
 * @param {string} absoluteFile
 * @param {number} line
 * @param {number} column
 * @param {string} [editor]
 */
export default function openInEditor(absoluteFile, line = 1, column = 1, editor = 'subl') {
  const binary = resolveBinary(editor)
  const location = `${absoluteFile}:${Math.max(1, Number(line) || 1)}:${Math.max(1, Number(column) || 1)}`
  // VS Code needs -g to understand file:line:column
  const args = editor === 'code' ? ['-g', location] : [location]
  const child = spawn(binary, args, { detached: true, stdio: 'ignore' })
  child.on('error', (error) => console.error('[e-dev] Could not open editor:', error))
  child.unref()
  return { editor, binary, location }
}
