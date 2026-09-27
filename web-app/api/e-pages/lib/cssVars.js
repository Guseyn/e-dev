import fs from 'fs'
import path from 'path'

import { PROJECT_ROOT } from './paths.js'

// Defaults come from e-ui (and fonts.css, which sets the font variables),
// overrides are written to app.css (loaded last) between these markers.
const DEFAULT_SOURCES = ['web-app/static/css/e-ui.css', 'web-app/static/css/fonts.css']
export const OVERRIDES_FILE = 'web-app/static/css/app.css'
const START = '/* e-pages: css variables (edited in e-pages, "Edit CSS Variables") */'
const END = '/* e-pages: end of css variables */'

class CssVarsError extends Error {
  constructor(message) {
    super(message)
    this.statusCode = 400
  }
}

/** Declarations of the first `:root { ... }` block in css text */
function rootDeclarations(css) {
  const start = css.search(/(^|\n)\s*:root\s*\{/)
  if (start === -1) return []
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++
    else if (css[end] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = []
  let current = ''
  let parens = 0
  for (const char of body) {
    if (char === '(') parens++
    if (char === ')') parens--
    if (char === ';' && parens === 0) {
      declarations.push(current)
      current = ''
    } else {
      current += char
    }
  }
  declarations.push(current)
  return declarations
    .map(d => d.trim())
    .filter(d => d.startsWith('--'))
    .map(d => {
      const colon = d.indexOf(':')
      return { name: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() }
    })
}

function read(file) {
  const full = path.join(PROJECT_ROOT, file)
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : ''
}

function overridesBlock(css) {
  const start = css.indexOf(START)
  const end = css.indexOf(END)
  if (start === -1 || end === -1) return null
  return { start, end: end + END.length, text: css.slice(start, end) }
}

function groupOf(name, value) {
  if (/^--e-font-size|^--e-font-h\d/.test(name)) return 'Font sizes'
  if (/^--e-font|^--font/.test(name)) return 'Fonts'
  if (/^--e-spacing/.test(name)) return 'Spacing'
  if (/^--e-radius|radius/.test(name)) return 'Radius'
  if (/^--e-shadow/.test(name)) return 'Shadows'
  if (/^#|^rgb|^hsl|^color-mix/.test(value)) return 'Colors'
  if (/^--e-width|^--e-main|^--e-img|^--e-sidebar/.test(name)) return 'Sizes'
  return 'Other'
}

/** All variables with default and current (overridden) values */
export function readCssVars() {
  const defaults = new Map()
  for (const file of DEFAULT_SOURCES) {
    for (const { name, value } of rootDeclarations(read(file))) {
      defaults.set(name, value)
    }
  }
  const block = overridesBlock(read(OVERRIDES_FILE))
  const overrides = new Map(block ? rootDeclarations(block.text).map(d => [d.name, d.value]) : [])
  const vars = []
  for (const [name, value] of defaults) {
    vars.push({ name, default: value, value: overrides.get(name) || null, group: groupOf(name, value) })
  }
  for (const [name, value] of overrides) {
    if (!defaults.has(name)) vars.push({ name, default: null, value, group: 'Other' })
  }
  return { file: OVERRIDES_FILE, vars }
}

/**
 * Writes overrides (only variables with a value) into app.css.
 * @param {{ name: string, value: string }[]} vars
 */
export function writeCssVars(vars) {
  const lines = []
  for (const { name, value } of vars || []) {
    if (value === undefined || value === null || String(value).trim() === '') continue
    if (!/^--[a-zA-Z0-9-]+$/.test(name)) throw new CssVarsError(`Invalid variable name: ${name}`)
    if (/[;{}]/.test(value) || /\*\//.test(value)) throw new CssVarsError(`Invalid value of ${name}: ${value}`)
    lines.push(`  ${name}: ${String(value).trim()};`)
  }
  const block = lines.length ? `${START}\n:root {\n${lines.join('\n')}\n}\n${END}` : ''
  const css = read(OVERRIDES_FILE)
  const existing = overridesBlock(css)
  let next
  if (existing) {
    next = css.slice(0, existing.start) + block + css.slice(existing.end)
  } else {
    next = block ? `${css.replace(/\s*$/, '')}\n\n${block}\n` : css
  }
  fs.writeFileSync(path.join(PROJECT_ROOT, OVERRIDES_FILE), next.replace(/\n{3,}/g, '\n\n'))
  return readCssVars()
}
