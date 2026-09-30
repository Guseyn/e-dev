import fs from 'fs'

import handler from './lib/respond.js'
import { fileOfUrl, relativeToProject } from './lib/paths.js'

/**
 * GET /e-dev/css-rules?url=/css/e-ui.css
 * Style rules of a stylesheet of the app: [{ selector, line, column }], with @media / @supports /
 * @layer / @container contents, without @keyframes / @font-face...
 */
export default handler(({ queries }) => {
  const url = decodeURIComponent(queries.url || '')
  const file = fileOfUrl(url)
  if (!file || !file.endsWith('.css') || !fs.existsSync(file)) {
    throw Object.assign(new Error(`No stylesheet for ${url}`), { statusCode: 404 })
  }
  return { file: relativeToProject(file), rules: parseRules(fs.readFileSync(file, 'utf-8')) }
})

// At-rules whose blocks contain style rules
const GROUPING_AT_RULES = /^@(media|supports|layer|container|document|scope)\b/i

export function parseRules(css) {
  const rules = []
  const stack = [] // 'group' | 'rule' | 'skip'
  let prelude = ''
  let preludeStart = -1
  let i = 0
  let line = 1
  let lineStart = 0
  let preludeLine = 1
  let preludeColumn = 1

  const skipping = () => stack.includes('skip')

  while (i < css.length) {
    const char = css[i]
    if (char === '\n') {
      line++
      lineStart = i + 1
    }
    if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      for (let k = i; k < stop; k++) {
        if (css[k] === '\n') { line++; lineStart = k + 1 }
      }
      i = stop
      continue
    }
    if (char === '"' || char === '\'') {
      const end = css.indexOf(char, i + 1)
      const stop = end === -1 ? css.length : end + 1
      prelude += css.slice(i, stop)
      i = stop
      continue
    }
    if (char === '{') {
      const text = prelude.trim()
      if (skipping() || stack[stack.length - 1] === 'rule') {
        // Blocks inside of a skipped at-rule, and nested rules (their selectors are relative: not matched)
        stack.push('skip')
      } else if (text.startsWith('@')) {
        stack.push(GROUPING_AT_RULES.test(text) ? 'group' : 'skip')
      } else {
        stack.push('rule')
        if (text) rules.push({ selector: text.replace(/\s+/g, ' '), line: preludeLine, column: preludeColumn })
      }
      prelude = ''
      preludeStart = -1
      i++
      continue
    }
    if (char === '}') {
      stack.pop()
      prelude = ''
      preludeStart = -1
      i++
      continue
    }
    if (char === ';') {
      prelude = ''
      preludeStart = -1
      i++
      continue
    }
    if (preludeStart === -1 && !/\s/.test(char)) {
      preludeStart = i
      preludeLine = line
      preludeColumn = i - lineStart + 1
    }
    if (preludeStart !== -1) prelude += char
    i++
  }
  return rules
}
