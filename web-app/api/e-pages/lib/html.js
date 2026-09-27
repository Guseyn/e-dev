// HTML ⇄ JSON model for e-pages.
//
// Model nodes:
//   { type: 'document', doctype: 'html', children: [...] }
//   { type: 'fragment', children: [...] }                        (templates, page parts)
//   { type: 'element', id: 'n1', tag: 'div', attrs: [['is', 'e-stack'], ['hidden', null]], children: [...] }
//   { type: 'text', value: 'Hello' }                             (raw html text, entities kept)
//   { type: 'comment', value: ' note ' }
//
// Attribute values and text are kept raw (exactly as written in HTML, entities included),
// so the generated HTML reads like hand-written HTML. Multi-line attribute values
// (like data-actions-on-response) are stored dedented and re-indented on render.

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'
])

// Content is not parsed as html
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title'])

// Whitespace is significant
const PREFORMATTED_ELEMENTS = new Set(['pre', 'textarea'])

export const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'img',
  'input', 'kbd', 'label', 'mark', 'option', 'q', 's', 'samp', 'select', 'small', 'span', 'strong',
  'sub', 'sup', 'textarea', 'time', 'u', 'var', 'wbr', 'title'
])

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

const MAX_LINE_LENGTH = 100
const INDENT = '  '

/* ──────────────────────────────────────────────────────────────── */
/* PARSE                                                            */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Parses html into a model. Elements get `line` (1-based line of their opening tag).
 * Returns a 'document' node if html has <!DOCTYPE> or <html>, otherwise a 'fragment'.
 *
 * @param {string} html
 */
export function parseHTML(html) {
  const rootChildren = []
  const stack = [] // open elements
  let doctype = null
  let i = 0
  let line = 1

  const currentChildren = () => stack.length ? stack[stack.length - 1].children : rootChildren
  const advance = (to) => {
    for (let k = i; k < to; k++) {
      if (html.charCodeAt(k) === 10) line++
    }
    i = to
  }
  const closeUntil = (tag) => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].tag === tag) {
        stack.length = k
        return true
      }
    }
    return false
  }

  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4)
      const stop = end === -1 ? html.length : end
      currentChildren().push({ type: 'comment', value: html.slice(i + 4, stop) })
      advance(end === -1 ? html.length : end + 3)
      continue
    }

    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i)
      const stop = end === -1 ? html.length : end
      const content = html.slice(i + 2, stop).trim()
      if (/^doctype/i.test(content)) {
        doctype = content.replace(/^doctype\s*/i, '') || 'html'
      }
      advance(end === -1 ? html.length : end + 1)
      continue
    }

    const endTagMatch = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(i, i + 200))
    if (endTagMatch) {
      closeUntil(endTagMatch[1].toLowerCase())
      advance(i + endTagMatch[0].length)
      continue
    }

    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] || '')) {
      const startLine = line
      const tagMatch = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(i, i + 200))
      const tag = tagMatch[1].toLowerCase()
      let j = i + tagMatch[0].length
      const attrs = []
      let selfClosing = false

      while (j < html.length) {
        while (j < html.length && /\s/.test(html[j])) j++
        if (html[j] === '>') { j++; break }
        if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 2; break }
        if (html[j] === '/') { j++; continue }
        const nameMatch = /^[^\s"'>/=]+/.exec(html.slice(j, j + 500))
        if (!nameMatch) { j++; continue }
        const name = nameMatch[0]
        j += name.length
        let k = j
        while (k < html.length && /\s/.test(html[k])) k++
        if (html[k] === '=') {
          k++
          while (k < html.length && /\s/.test(html[k])) k++
          const quote = html[k]
          let value
          if (quote === '"' || quote === '\'') {
            const end = html.indexOf(quote, k + 1)
            const stop = end === -1 ? html.length : end
            value = html.slice(k + 1, stop)
            j = end === -1 ? html.length : end + 1
          } else {
            const valueMatch = /^[^\s>]*/.exec(html.slice(k, k + 2000))
            value = valueMatch[0]
            j = k + value.length
          }
          attrs.push([name, normalizeAttributeValue(value)])
        } else {
          attrs.push([name, null])
        }
      }

      // Implicitly closed elements (<li>, <p>, <td>...)
      const top = stack[stack.length - 1]
      if (top && IMPLICITLY_CLOSED_BY[tag] && IMPLICITLY_CLOSED_BY[tag].has(top.tag)) {
        stack.length--
      } else if (top && top.tag === 'p' && CLOSES_P.has(tag)) {
        stack.length--
      }

      const element = { type: 'element', tag, attrs, children: [], line: startLine }
      currentChildren().push(element)
      advance(j)

      if (VOID_ELEMENTS.has(tag) || selfClosing) {
        continue
      }

      if (RAW_TEXT_ELEMENTS.has(tag)) {
        const closeRegex = new RegExp(`</${tag}\\s*>`, 'i')
        const rest = html.slice(i)
        const closeMatch = closeRegex.exec(rest)
        const contentEnd = closeMatch ? i + closeMatch.index : html.length
        const content = html.slice(i, contentEnd)
        if (content.length > 0) {
          element.children.push({ type: 'text', value: content, raw: true })
        }
        advance(closeMatch ? contentEnd + closeMatch[0].length : html.length)
        continue
      }

      stack.push(element)
      continue
    }

    // Text until the next tag-like "<"
    let next = i + 1
    while (next < html.length) {
      next = html.indexOf('<', next)
      if (next === -1) { next = html.length; break }
      const after = html[next + 1] || ''
      if (/[a-zA-Z/!?]/.test(after)) break
      next++
    }
    currentChildren().push({ type: 'text', value: html.slice(i, next) })
    advance(next)
  }

  const hasHtmlElement = rootChildren.some(n => n.type === 'element' && n.tag === 'html')
  const root = (doctype || hasHtmlElement)
    ? { type: 'document', doctype: doctype || 'html', children: rootChildren }
    : { type: 'fragment', children: rootChildren }
  normalizeWhitespace(root, false)
  return root
}

// Multi-line values are stored without the indentation of the html around them.
// Two styles are kept as written:
//   block:  attr="            → stored as '\n' + dedented lines
//             code
//           "
//   inline: attr="${{         → stored as first line + '\n' + dedented other lines
//             a: 1
//           }}"
export function normalizeAttributeValue(value) {
  if (!value.includes('\n')) {
    return value
  }
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  if (lines[0].trim() === '') {
    const body = dedent(value)
    return body ? '\n' + body : ''
  }
  const rest = dedent(lines.slice(1).join('\n'))
  return rest ? lines[0].replace(/[ \t]+$/, '') + '\n' + rest : lines[0].trim()
}

/**
 * Removes blank first/last lines and common indentation.
 * @param {string} text
 */
export function dedent(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  const indents = lines.filter(l => l.trim() !== '').map(l => l.match(/^[ \t]*/)[0].length)
  const minIndent = indents.length ? Math.min(...indents) : 0
  return lines.map(l => l.slice(minIndent).replace(/[ \t]+$/, '')).join('\n')
}

// Drops formatting whitespace between block elements, collapses runs of whitespace
function normalizeWhitespace(node, preformatted) {
  if (!node.children) {
    return
  }
  const isPre = preformatted || (node.type === 'element' && PREFORMATTED_ELEMENTS.has(node.tag))
  if (isPre) {
    return
  }
  const isInlineParent = node.type === 'element' && INLINE_ELEMENTS.has(node.tag)
  const result = []
  node.children.forEach((child, index) => {
    if (child.type === 'text' && !child.raw) {
      let value = child.value.replace(/\s+/g, ' ')
      if (value === ' ') {
        const prev = node.children[index - 1]
        const next = node.children[index + 1]
        const inlineAround = isInline(prev) && isInline(next)
        if (!inlineAround) {
          return
        }
      }
      if (!isInlineParent) {
        if (result.length === 0 || !isInline(node.children[index - 1])) value = value.replace(/^ /, '')
        if (index === node.children.length - 1 || !isInline(node.children[index + 1])) value = value.replace(/ $/, '')
      }
      if (value !== '') {
        result.push({ type: 'text', value })
      }
      return
    }
    normalizeWhitespace(child, false)
    result.push(child)
  })
  node.children = result
}

function isInline(node) {
  if (!node) return false
  if (node.type === 'text') return true
  return node.type === 'element' && INLINE_ELEMENTS.has(node.tag)
}

/* ──────────────────────────────────────────────────────────────── */
/* RENDER                                                           */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Renders a model into html.
 *
 * @param {any} root document or fragment
 * @param {{ idAttribute?: string }} [options] if set, each element in <body>
 * (or in a fragment) gets this attribute with its id (used by the dev server)
 * @returns {{ html: string, lines: Record<string, number> }} lines: element id → line of its opening tag
 */
export function renderHTML(root, { idAttribute } = {}) {
  const out = []
  const lines = {}
  const ctx = { out, lines, idAttribute }

  if (root.type === 'document') {
    out.push(`<!DOCTYPE ${root.doctype || 'html'}>`)
    for (const child of root.children) {
      renderNode(child, 0, ctx, { inBody: false })
    }
  } else {
    for (const child of root.children) {
      renderNode(child, 0, ctx, { inBody: true })
    }
  }
  return { html: out.join('\n') + '\n', lines }
}

function renderNode(node, level, ctx, scope) {
  const indent = INDENT.repeat(level)
  if (node.type === 'text') {
    const value = node.value.trim()
    if (value) ctx.out.push(indent + value)
    return
  }
  if (node.type === 'comment') {
    ctx.out.push(`${indent}<!--${node.value}-->`)
    return
  }
  if (node.type !== 'element') {
    return
  }

  const inBody = scope.inBody || node.tag === 'body'
  const attrs = attributesToRender(node, ctx, inBody)
  const tag = node.tag

  if (node.id) {
    ctx.lines[node.id] = ctx.out.length + 1
  }

  const openTagLines = renderOpenTag(tag, attrs, indent)
  const openTag = openTagLines.join('\n')

  if (VOID_ELEMENTS.has(tag)) {
    ctx.out.push(openTag)
    return
  }

  const children = node.children || []

  // <html> children (head, body) are not indented, like in most hand-written pages
  const childLevel = tag === 'html' ? level : level + 1

  if (children.length === 0) {
    ctx.out.push(`${openTag}</${tag}>`)
    return
  }

  // Raw text content: script, style, textarea, title
  if (RAW_TEXT_ELEMENTS.has(tag) || PREFORMATTED_ELEMENTS.has(tag)) {
    const content = children.map(c => c.value || '').join('')
    if (PREFORMATTED_ELEMENTS.has(tag) || tag === 'title' || !content.includes('\n')) {
      const inlineContent = (tag === 'script' || tag === 'style') ? content.trim() : content
      ctx.out.push(`${openTag}${inlineContent}</${tag}>`)
      return
    }
    ctx.out.push(openTag)
    let contentLines = dedent(content).split('\n')
    // Scripts with only imports (like the module script of pages) are lined up,
    // even if their lines were indented differently before
    if (tag === 'script' && contentLines.every(l => l.trim() === '' || /^\s*import\s/.test(l))) {
      contentLines = contentLines.map(l => l.trim()).filter(Boolean)
    }
    for (const contentLine of contentLines) {
      ctx.out.push(contentLine ? INDENT.repeat(childLevel) + contentLine : '')
    }
    ctx.out.push(`${indent}</${tag}>`)
    return
  }

  // Inline layout: <p is="e-p">Some <b>text</b></p>
  const prefersBlock = tag === 'template' && children.some(c => c.type === 'element')
  if (!prefersBlock && openTagLines.length === 1 && children.every(canBeInline)) {
    const inlineContent = children.map(c => renderInline(c, ctx, inBody)).join('')
    const candidate = `${openTag}${inlineContent}</${tag}>`
    if (candidate.length <= MAX_LINE_LENGTH + 20 && !inlineContent.includes('\n')) {
      // ids of inline children are on the same line
      markInlineLines(children, ctx.out.length + 1, ctx)
      ctx.out.push(candidate)
      return
    }
  }

  ctx.out.push(openTag)
  for (const child of children) {
    renderNode(child, childLevel, ctx, { inBody })
  }
  ctx.out.push(`${indent}</${tag}>`)
}

function attributesToRender(node, ctx, inBody) {
  const attrs = node.attrs ? [...node.attrs] : []
  if (ctx.idAttribute && inBody && node.id && node.tag !== 'body') {
    attrs.push([ctx.idAttribute, node.id])
  }
  return attrs
}

function renderOpenTag(tag, attrs, indent) {
  if (attrs.length === 0) {
    return [`${indent}<${tag}>`]
  }
  const rendered = attrs.map(([name, value]) => renderAttribute(name, value, indent + INDENT))
  const hasMultiline = rendered.some(a => a.includes('\n'))
  const oneLine = `${indent}<${tag} ${rendered.join(' ')}>`
  if (!hasMultiline && oneLine.length <= MAX_LINE_LENGTH) {
    return [oneLine]
  }
  // One attribute per line
  const result = [`${indent}<${tag}`]
  rendered.forEach((attr, index) => {
    const last = index === rendered.length - 1
    result.push(`${indent}${INDENT}${attr}${last ? '>' : ''}`)
  })
  return result
}

function renderAttribute(name, value, attrIndent) {
  if (value === null || value === undefined) {
    return name
  }
  const quote = value.includes('"') && !value.includes('\'') ? '\'' : '"'
  const safeValue = quote === '"' ? value.replace(/"/g, '&quot;') : value
  if (!safeValue.includes('\n')) {
    return `${name}=${quote}${safeValue}${quote}`
  }
  const indentLines = (lines) => lines.map(l => l ? attrIndent + INDENT + l : '').join('\n')
  if (safeValue.startsWith('\n')) {
    return `${name}=${quote}\n${indentLines(safeValue.slice(1).split('\n'))}\n${attrIndent}${quote}`
  }
  const [firstLine, ...otherLines] = safeValue.split('\n')
  return `${name}=${quote}${firstLine}\n${indentLines(otherLines)}${quote}`
}

function canBeInline(node) {
  if (node.type === 'text') return !node.value.includes('\n')
  if (node.type === 'comment') return false
  if (node.type !== 'element') return false
  if (!INLINE_ELEMENTS.has(node.tag) || node.tag === 'textarea' || node.tag === 'select') return false
  if ((node.attrs || []).some(([, v]) => v && v.includes('\n'))) return false
  return (node.children || []).every(canBeInline)
}

function renderInline(node, ctx, inBody) {
  if (node.type === 'text') {
    return node.value
  }
  const attrs = attributesToRender(node, ctx, inBody)
  const attrsString = attrs.length ? ' ' + attrs.map(([n, v]) => renderAttribute(n, v, '')).join(' ') : ''
  if (VOID_ELEMENTS.has(node.tag)) {
    return `<${node.tag}${attrsString}>`
  }
  const inner = (node.children || []).map(c => renderInline(c, ctx, inBody)).join('')
  return `<${node.tag}${attrsString}>${inner}</${node.tag}>`
}

function markInlineLines(children, lineNumber, ctx) {
  for (const child of children) {
    if (child.type === 'element') {
      if (child.id) ctx.lines[child.id] = lineNumber
      markInlineLines(child.children || [], lineNumber, ctx)
    }
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* HELPERS                                                          */
/* ──────────────────────────────────────────────────────────────── */

/** Walks all element nodes: fn(node, parent, index, depth) */
export function walkElements(node, fn, parent = null, depth = 0) {
  (node.children || []).forEach((child, index) => {
    if (child.type === 'element') {
      fn(child, node, index, depth)
      walkElements(child, fn, child, depth + 1)
    }
  })
}

/** Finds the first element with the tag (e.g. 'body') */
export function findElementByTag(node, tag) {
  for (const child of node.children || []) {
    if (child.type === 'element') {
      if (child.tag === tag) return child
      const found = findElementByTag(child, tag)
      if (found) return found
    }
  }
  return null
}

export function attributeValue(node, name) {
  const attr = (node.attrs || []).find(([n]) => n === name)
  return attr ? attr[1] : undefined
}
