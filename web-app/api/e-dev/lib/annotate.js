// Source locations of elements in html files.
//
// annotateHTML() inserts data-e-src="<file>:<line>:<column>" right after the tag name
// of every start tag, and changes nothing else, so line numbers stay the same as on disk.
// EHTML keeps such attributes when it renders templates (clones, innerHTML, unwrapping),
// so any rendered element still knows where it's written.

export const SRC_ATTRIBUTE = 'data-e-src'

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'
])

// Content is not parsed as html
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript'])

// Opening one of these closes an open <p>
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav',
  'ol', 'p', 'pre', 'section', 'table', 'ul'
])

// Opening <key> closes an open element from the set
const IMPLICITLY_CLOSED_BY = {
  li: new Set(['li']),
  option: new Set(['option']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  tr: new Set(['tr', 'td', 'th']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th'])
}

// Elements that are not annotated (with everything inside of <head>)
const NOT_ANNOTATED = new Set(['html', 'head'])

/**
 * Walks start tags of html. For each one calls onStartTag with
 * { tag, attrs, line, column, nameEnd, stack } where `stack` is the list of open ancestors.
 *
 * @param {string} html
 * @param {(tag: any) => boolean | void} onStartTag return true to stop
 */
export function scanTags(html, onStartTag) {
  const stack = []
  let i = 0
  let line = 1
  let lineStart = 0

  const advance = (to) => {
    for (let k = i; k < to; k++) {
      if (html.charCodeAt(k) === 10) {
        line++
        lineStart = k + 1
      }
    }
    i = to
  }
  const closeUntil = (tag) => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].tag === tag) {
        stack.length = k
        return
      }
    }
  }

  while (i < html.length) {
    const next = html.indexOf('<', i)
    if (next === -1) break
    advance(next)

    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4)
      advance(end === -1 ? html.length : end + 3)
      continue
    }

    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i)
      advance(end === -1 ? html.length : end + 1)
      continue
    }

    const endTagMatch = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(i, i + 200))
    if (endTagMatch) {
      closeUntil(endTagMatch[1].toLowerCase())
      advance(i + endTagMatch[0].length)
      continue
    }

    const tagMatch = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(i, i + 200))
    if (!tagMatch) {
      advance(i + 1)
      continue
    }
    const tag = tagMatch[1].toLowerCase()
    const startLine = line
    const column = i - lineStart + 1
    const nameEnd = i + tagMatch[0].length
    let j = nameEnd
    const attrs = {}
    let selfClosing = false

    while (j < html.length) {
      while (j < html.length && /\s/.test(html[j])) j++
      if (html[j] === '>') { j++; break }
      if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 2; break }
      if (html[j] === '/') { j++; continue }
      const nameMatch = /^[^\s"'>/=]+/.exec(html.slice(j, j + 500))
      if (!nameMatch) { j++; continue }
      const name = nameMatch[0].toLowerCase()
      j += nameMatch[0].length
      let k = j
      while (k < html.length && /\s/.test(html[k])) k++
      if (html[k] !== '=') {
        attrs[name] = ''
        continue
      }
      k++
      while (k < html.length && /\s/.test(html[k])) k++
      const quote = html[k]
      if (quote === '"' || quote === '\'') {
        const end = html.indexOf(quote, k + 1)
        attrs[name] = html.slice(k + 1, end === -1 ? html.length : end)
        j = end === -1 ? html.length : end + 1
      } else {
        const value = /^[^\s>]*/.exec(html.slice(k, k + 2000))[0]
        attrs[name] = value
        j = k + value.length
      }
    }

    // Implicitly closed elements (<li>, <p>, <td>...)
    const top = stack[stack.length - 1]
    if (top && IMPLICITLY_CLOSED_BY[tag] && IMPLICITLY_CLOSED_BY[tag].has(top.tag)) {
      stack.length--
    } else if (top && top.tag === 'p' && CLOSES_P.has(tag)) {
      stack.length--
    }

    const element = { tag, attrs, line: startLine, column }
    if (onStartTag({ ...element, nameEnd, stack: stack.slice() })) return
    advance(j)

    if (VOID_ELEMENTS.has(tag) || selfClosing) continue

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      const closeMatch = new RegExp(`</${tag}\\s*>`, 'i').exec(html.slice(i))
      advance(closeMatch ? i + closeMatch.index + closeMatch[0].length : html.length)
      continue
    }

    stack.push(element)
  }
}

/**
 * Adds data-e-src="<file>:<line>:<column>" to elements (not to <html>, <head> and its children).
 *
 * @param {string} html
 * @param {string} file project-relative path, like "web-app/static/html/index.html"
 */
export function annotateHTML(html, file) {
  const parts = []
  let last = 0
  scanTags(html, ({ tag, attrs, line, column, nameEnd, stack }) => {
    if (NOT_ANNOTATED.has(tag) || SRC_ATTRIBUTE in attrs || stack.some(el => el.tag === 'head')) return
    parts.push(html.slice(last, nameEnd), ` ${SRC_ATTRIBUTE}="${escapeAttribute(file)}:${line}:${column}"`)
    last = nameEnd
  })
  parts.push(html.slice(last))
  return parts.join('')
}

/**
 * The element at line:column and its ancestors in the file, outermost first.
 *
 * @param {string} html
 * @param {number} line
 * @param {number} column
 * @returns {{ tag: string, attrs: Object<string, string>, line: number, column: number }[] | null}
 */
export function sourceChainAt(html, line, column) {
  let chain = null
  scanTags(html, (element) => {
    if (element.line === line && element.column === column) {
      const { tag, attrs } = element
      chain = [...element.stack, { tag, attrs, line, column }]
      return true
    }
  })
  return chain
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
