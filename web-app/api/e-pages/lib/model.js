import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

import { parseHTML, renderHTML, walkElements, normalizeAttributeValue, dedent } from './html.js'
import { pageFile, modelFile, HISTORY_DIR } from './paths.js'
import { requiredImportsOf, pagesUsingTemplate } from './requires.js'

const HISTORY_LIMIT = 50
// Added only to html served in dev mode, never saved
export const ID_ATTRIBUTE = 'data-eid'
const PROTECTED_TAGS = new Set(['html', 'head', 'body'])

export class ModelError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message)
    this.statusCode = statusCode
    this.details = details
  }
}

export function hashOf(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/* ──────────────────────────────────────────────────────────────── */
/* LOAD / SAVE                                                      */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Returns the model of the page.
 * The JSON model is the source of truth, but if the html file was changed by hand
 * (its hash differs) or has no model yet, the html is imported into a new model.
 * Importing never rewrites the html file.
 *
 * @param {string} page e.g. "html/index.html"
 */
export function loadModel(page) {
  const htmlPath = pageFile(page)
  if (!fs.existsSync(htmlPath)) {
    throw new ModelError(`Page ${page} doesn't exist`, 404)
  }
  const html = fs.readFileSync(htmlPath, 'utf-8')
  const htmlHash = hashOf(html)
  const file = modelFile(page)
  if (fs.existsSync(file)) {
    const model = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (model.htmlHash === htmlHash) {
      return model
    }
    return importModel(page, html, htmlHash, (model.version || 0) + 1)
  }
  return importModel(page, html, htmlHash, 1)
}

function importModel(page, html, htmlHash, version) {
  const root = parseHTML(html)
  const lines = {}
  let nextId = 1
  walkElements(root, (node) => {
    node.id = `n${nextId++}`
    lines[node.id] = node.line
    delete node.line
  })
  const model = {
    page,
    kind: root.type === 'document' ? 'page' : 'template',
    version,
    htmlHash,
    nextId,
    lines,
    root
  }
  writeModelFile(page, model)
  return model
}

/**
 * Renders the model into the html file and saves the model.
 * The previous model goes to the undo history.
 */
export function saveModel(page, model, previousModel) {
  if (previousModel) {
    pushHistory(page, previousModel)
  }
  const { html, lines } = renderHTML(model.root)
  fs.mkdirSync(path.dirname(pageFile(page)), { recursive: true })
  fs.writeFileSync(pageFile(page), html)
  model.htmlHash = hashOf(html)
  model.lines = lines
  model.version = (previousModel ? previousModel.version : model.version || 0) + 1
  writeModelFile(page, model)
  return model
}

/** Creates a new page (or template) from html */
export function createModel(page, html) {
  if (fs.existsSync(pageFile(page))) {
    throw new ModelError(`${page} already exists`, 409)
  }
  const root = parseHTML(html)
  let nextId = 1
  walkElements(root, (node) => {
    node.id = `n${nextId++}`
    delete node.line
  })
  const model = { page, kind: root.type === 'document' ? 'page' : 'template', version: 0, nextId, root }
  return saveModel(page, model, null)
}

function writeModelFile(page, model) {
  const file = modelFile(page)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(model, null, 2) + '\n')
}

/* ──────────────────────────────────────────────────────────────── */
/* UNDO / REDO HISTORY                                              */
/* ──────────────────────────────────────────────────────────────── */
// Each page has two stacks of previous models (files sorted by name):
//   .history/undo/<page>/  and  .history/redo/<page>/
// A normal change pushes the previous model to undo and clears redo.

function stackDir(kind, page) {
  return path.join(HISTORY_DIR, kind, page.replace(/\.html$/, ''))
}

function stackFiles(kind, page) {
  const dir = stackDir(kind, page)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
}

function pushTo(kind, page, model) {
  const dir = stackDir(kind, page)
  fs.mkdirSync(dir, { recursive: true })
  const name = `${String(Date.now()).padStart(15, '0')}-${String(model.version).padStart(6, '0')}.json`
  fs.writeFileSync(path.join(dir, name), JSON.stringify(model))
  const files = stackFiles(kind, page)
  for (const old of files.slice(0, Math.max(0, files.length - HISTORY_LIMIT))) {
    fs.unlinkSync(path.join(dir, old))
  }
}

function popFrom(kind, page) {
  const files = stackFiles(kind, page)
  if (files.length === 0) return null
  const file = path.join(stackDir(kind, page), files[files.length - 1])
  const model = JSON.parse(fs.readFileSync(file, 'utf-8'))
  fs.unlinkSync(file)
  return model
}

function pushHistory(page, model) {
  pushTo('undo', page, model)
  fs.rmSync(stackDir('redo', page), { recursive: true, force: true })
}

function restore(page, fromKind, toKind, emptyMessage) {
  const current = loadModel(page)
  const restored = popFrom(fromKind, page)
  if (!restored) {
    throw new ModelError(emptyMessage, 409)
  }
  pushTo(toKind, page, current)
  // Version keeps growing, so open editors notice the change
  restored.version = current.version
  return saveModel(page, restored, null)
}

/** Restores the previous version of the page */
export function undo(page) {
  return restore(page, 'undo', 'redo', 'Nothing to undo')
}

/** Brings back the version that was undone */
export function redo(page) {
  return restore(page, 'redo', 'undo', 'Nothing to redo')
}

export function undoAvailable(page) {
  return stackFiles('undo', page).length > 0
}

export function redoAvailable(page) {
  return stackFiles('redo', page).length > 0
}

/* ──────────────────────────────────────────────────────────────── */
/* TREE OPERATIONS                                                  */
/* ──────────────────────────────────────────────────────────────── */

export function assertVersion(model, version) {
  if (version !== undefined && version !== null && version !== '' && Number(version) !== model.version) {
    throw new ModelError(
      `The page was changed (version ${model.version}, you have ${version}). Reload the page.`,
      409,
      { version: model.version }
    )
  }
}

/**
 * @returns {{ node: any, parent: any, path: string[] }} path: ids of ancestors
 */
export function findNode(model, id) {
  if (id === null || id === undefined || id === '' || id === 'root') {
    return { node: model.root, parent: null, path: [] }
  }
  let found = null
  const search = (node, ancestors) => {
    for (const child of node.children || []) {
      if (found) return
      if (child.type !== 'element') continue
      if (child.id === id) {
        found = { node: child, parent: node, path: ancestors }
        return
      }
      search(child, [...ancestors, child.id])
    }
  }
  search(model.root, [])
  if (!found) {
    throw new ModelError(`Element ${id} is not found (the page may have changed, reload it)`, 404)
  }
  return found
}

/**
 * Builds a new element from request data.
 *
 * @param {any} model (for ids)
 * @param {{ tag: string, attributes?: any[], text?: string, innerHTML?: string }} data
 */
export function createElement(model, { tag, attributes, text, innerHTML }) {
  // Plain text node ("Text" in the catalog)
  if (tag === '#text') {
    if (text === undefined || text === null || String(text) === '') {
      throw new ModelError('Text is required')
    }
    return { type: 'text', value: String(text) }
  }
  if (typeof tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(tag)) {
    throw new ModelError(`Invalid tag: ${tag}`)
  }
  const node = { type: 'element', id: null, tag, attrs: normalizeAttributes(attributes), children: [] }
  if (innerHTML) {
    node.children = parseHTML(String(innerHTML)).children
  } else if (text !== undefined && text !== null && text !== '') {
    node.children = [{ type: 'text', value: String(text) }]
  }
  assignIds(model, node)
  return node
}

function assignIds(model, node) {
  if (node.type !== 'element') return
  node.id = `n${model.nextId++}`
  walkElements(node, (child) => {
    child.id = `n${model.nextId++}`
    delete child.line
  })
}

/**
 * Accepts [{ name, value }] or [[name, value]].
 * Empty value means boolean attribute (rendered as just the name).
 */
export function normalizeAttributes(attributes) {
  if (!attributes) return []
  const list = Array.isArray(attributes) ? attributes : Object.entries(attributes).map(([name, value]) => ({ name, value }))
  const result = []
  for (const attr of list) {
    const name = String(Array.isArray(attr) ? attr[0] : attr.name || '').trim()
    let value = Array.isArray(attr) ? attr[1] : attr.value
    if (!name) continue
    if (!/^[^\s"'>/=]+$/.test(name)) {
      throw new ModelError(`Invalid attribute name: ${name}`)
    }
    if (name === ID_ATTRIBUTE) continue
    value = (value === null || value === undefined || value === '' || value === true) ? null : normalizeAttributeValue(String(value))
    const existing = result.find(([n]) => n === name)
    if (existing) {
      existing[1] = value
    } else {
      result.push([name, value])
    }
  }
  return result
}

/**
 * Converts an index among element children to an index in `children` (which has text too).
 */
function childrenIndex(parent, elementIndex) {
  const children = parent.children
  if (elementIndex === undefined || elementIndex === null || elementIndex === '') {
    return children.length
  }
  let count = 0
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === 'element') {
      if (count === Number(elementIndex)) return i
      count++
    }
  }
  return children.length
}

function assertCanHaveChildren(parent) {
  if (parent.type === 'element' && /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/.test(parent.tag)) {
    throw new ModelError(`<${parent.tag}> can't have children`)
  }
}

export function insertElement(model, parentId, index, node) {
  const { node: parent } = findNode(model, parentId)
  assertCanHaveChildren(parent)
  parent.children = parent.children || []
  parent.children.splice(childrenIndex(parent, index), 0, node)
  return node
}

export function removeElement(model, id) {
  const { node, parent } = findNode(model, id)
  if (PROTECTED_TAGS.has(node.tag)) {
    throw new ModelError(`<${node.tag}> can't be deleted`)
  }
  parent.children.splice(parent.children.indexOf(node), 1)
  return node
}

export function moveElement(model, id, parentId, index) {
  const { node } = findNode(model, id)
  if (PROTECTED_TAGS.has(node.tag)) {
    throw new ModelError(`<${node.tag}> can't be moved`)
  }
  const target = findNode(model, parentId)
  if (target.node === node || target.path.includes(id)) {
    throw new ModelError('Element can\'t be moved inside itself')
  }
  removeElement(model, id)
  insertElement(model, parentId, index, node)
  return node
}

export function updateElement(model, id, { attributes, text, tag }) {
  const { node } = findNode(model, id)
  if (tag !== undefined && tag !== node.tag) {
    if (PROTECTED_TAGS.has(node.tag) || typeof tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(tag)) {
      throw new ModelError(`Invalid tag: ${tag}`)
    }
    node.tag = tag
  }
  if (attributes !== undefined) {
    node.attrs = normalizeAttributes(attributes)
  }
  if (text !== undefined && text !== null) {
    const hasElementChildren = (node.children || []).some(c => c.type === 'element')
    if (hasElementChildren) {
      throw new ModelError('Text can be set only for elements without child elements')
    }
    node.children = text === '' ? [] : [{ type: 'text', value: String(text), raw: node.children?.[0]?.raw }]
  }
  return node
}

/** Deep copy (for undo history) */
export function cloneModel(model) {
  return JSON.parse(JSON.stringify(model))
}

/**
 * Makes sure the page imports scripts that an element needs, e.g. '#e-ui/e-toast.js'
 * (adds `import '...'` lines to the first inline <script type="module"> in <head>).
 * Templates have no <head>: returns specs that the pages using them must import.
 *
 * @param {any} model
 * @param {string[]} specs
 * @returns {{ added: string[], missing: string[] }}
 */
export function ensureModuleImports(model, specs) {
  const result = { added: [], missing: [] }
  if (!specs || specs.length === 0) return result
  const head = model.kind === 'page' ? findFirst(model.root, n => n.tag === 'head') : null
  if (!head) {
    result.missing.push(...specs)
    return result
  }
  let script = findFirst(head, n =>
    n.tag === 'script' &&
    (n.attrs || []).some(([name, value]) => name === 'type' && value === 'module') &&
    !(n.attrs || []).some(([name]) => name === 'src')
  )
  if (!script) {
    script = { type: 'element', id: `n${model.nextId++}`, tag: 'script', attrs: [['type', 'module']], children: [] }
    head.children.push(script)
  }
  // Without the indentation of the html around it, so added lines line up with existing ones
  let code = '\n' + dedent((script.children || []).map(c => c.value || '').join('')) + '\n'
  for (const spec of specs) {
    const specWithoutVersion = spec.replace(/\?v=[0-9a-f]+$/, '')
    const alreadyImported = new RegExp(`import\\s+['"]${specWithoutVersion.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\?v=[0-9a-f]+)?['"]`).test(code)
    if (!alreadyImported) {
      code = `${code.replace(/\s*$/, '')}\nimport '${specWithoutVersion}'\n`
      result.added.push(specWithoutVersion)
    }
  }
  script.children = [{ type: 'text', value: code }]
  return result
}

function findFirst(node, predicate) {
  for (const child of node.children || []) {
    if (child.type !== 'element') continue
    if (predicate(child)) return child
    const found = findFirst(child, predicate)
    if (found) return found
  }
  return null
}

/**
 * Replaces children of the element with elements parsed from html (its inner html).
 * @param {any} model
 * @param {string} id element id, or 'root' for the template root
 * @param {string} html
 */
export function replaceChildrenWithHTML(model, id, html) {
  const { node } = findNode(model, id)
  if (node.type === 'element' && /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr|script|style|title|textarea)$/.test(node.tag)) {
    throw new ModelError(`<${node.tag}> can't have html inside`)
  }
  const fragment = parseHTML(String(html || ''))
  if (fragment.type !== 'fragment') {
    throw new ModelError('Inner html can\'t have <!DOCTYPE> or <html>')
  }
  walkElements(fragment, (child) => {
    child.id = `n${model.nextId++}`
    delete child.line
  })
  node.children = fragment.children
  return node
}

/** Inner and outer html of the element (as it's written in the html file) */
export function htmlOfElement(model, id) {
  const { node } = findNode(model, id)
  const inner = renderHTML({ type: 'fragment', children: node.children || [] }).html
  const outer = node.type === 'element' ? renderHTML({ type: 'fragment', children: [node] }).html : inner
  return { innerHTML: inner, outerHTML: outer }
}

/**
 * Makes sure scripts needed by `nodes` (e-ui components inside them, and templates they load)
 * are imported: in the page itself, or, for a template, in every page that uses it
 * (those pages are saved right away, with their own undo history).
 *
 * @param {string} page
 * @param {any} model not saved yet (saved by the caller)
 * @param {any[]} nodes added or changed nodes
 * @param {string[]} [extra] scripts requested explicitly (catalog "requires")
 * @returns {{ added: string[], missing: string[], pages: { page: string, added: string[] }[] }}
 */
export function syncImports(page, model, nodes, extra = []) {
  const specs = [...new Set([...extra, ...requiredImportsOf(nodes, loadModel)])]
  const result = { added: [], missing: [], pages: [] }
  if (specs.length === 0) return result
  if (model.kind === 'page') {
    result.added = ensureModuleImports(model, specs).added
    return result
  }
  const pages = pagesUsingTemplate(page, loadModel)
  if (pages.length === 0) {
    result.missing = specs
    return result
  }
  for (const usingPage of pages) {
    const usingModel = loadModel(usingPage)
    const previous = cloneModel(usingModel)
    const { added } = ensureModuleImports(usingModel, specs)
    if (added.length) {
      saveModel(usingPage, usingModel, previous)
      result.pages.push({ page: usingPage, added })
    }
  }
  return result
}
