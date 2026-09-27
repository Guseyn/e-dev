// Shared state of the editor: current page model, catalog, routes, pages.

export const store = {
  page: null, // "html/index.html"
  model: null, // page model from /e-pages/page (root, version, lines, sources...)
  catalog: [], // all catalog elements (ehtml + e-ui + html)
  groups: {}, // attribute groups by name
  routes: [], // endpoints from web-app/routes.js
  pages: [] // html pages and templates
}

/** "html/..." page of the current url ("/" is html/index.html) */
export function pageFromLocation() {
  const path = window.location.pathname
  if (path === '/' || path === '') return 'html/index.html'
  return decodeURIComponent(path.replace(/^\//, ''))
}

export async function getJSON(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error || `${url}: ${response.status}`)
  }
  return body
}

export async function loadAll() {
  store.page = pageFromLocation()
  const [model, routes, pages, ...catalogs] = await Promise.all([
    getJSON(`/e-pages/page?path=${encodeURIComponent(store.page)}`),
    getJSON('/e-pages/routes'),
    getJSON('/e-pages/pages'),
    getJSON('/js/e-pages/catalog/ehtml.json'),
    getJSON('/js/e-pages/catalog/e-ui.json'),
    getJSON('/js/e-pages/catalog/html.json')
  ])
  store.model = model
  store.routes = routes
  store.pages = pages
  store.catalog = []
  store.groups = {}
  for (const catalog of catalogs) {
    Object.assign(store.groups, catalog.groups || {})
    for (const element of catalog.elements) {
      store.catalog.push({ ...element, library: catalog.library, libraryTitle: catalog.title })
    }
  }
}

export async function reloadModel() {
  store.model = await getJSON(`/e-pages/page?path=${encodeURIComponent(store.page)}`)
  return store.model
}

/* ──────────────────────────────────────────────────────────────── */
/* MODEL HELPERS                                                    */
/* ──────────────────────────────────────────────────────────────── */

/** Element that new top-level elements go to: <body> of a page, root of a template */
export function rootNode() {
  const root = store.model.root
  if (root.type === 'document') {
    const html = root.children.find(n => n.type === 'element' && n.tag === 'html')
    const body = html && html.children.find(n => n.type === 'element' && n.tag === 'body')
    return body || root
  }
  return root
}

export function rootId() {
  const root = rootNode()
  return root.id || 'root'
}

/** { node, parent, path: [ancestor nodes] } or null */
export function findNode(id) {
  if (!id || id === 'root') return { node: store.model.root, parent: null, path: [] }
  let result = null
  const walk = (node, path) => {
    for (const child of node.children || []) {
      if (result) return
      if (child.type !== 'element') continue
      if (child.id === id) {
        result = { node: child, parent: node, path }
        return
      }
      walk(child, [...path, child])
    }
  }
  walk(store.model.root, [])
  return result
}

export function elementChildren(node) {
  return (node.children || []).filter(c => c.type === 'element')
}

export function attr(node, name) {
  const found = (node.attrs || []).find(([n]) => n === name)
  return found ? found[1] : undefined
}

/** Id of the element on the top level (child of body / template root) that contains the element */
export function topLevelIdOf(id) {
  const found = findNode(id)
  if (!found) return null
  const root = rootNode()
  const chain = [...found.path, found.node]
  const rootIndex = chain.findIndex(n => n === root)
  if (rootIndex !== -1) return chain[rootIndex + 1] ? chain[rootIndex + 1].id : null
  if (root === store.model.root) return chain[0].id
  // element is outside of body (in head)
  return null
}

/** Path of nodes from root element (body) to the node, for breadcrumbs */
export function breadcrumbsOf(id) {
  const root = rootNode()
  if (!id || id === rootId()) return [root]
  const found = findNode(id)
  if (!found) return []
  const chain = [...found.path, found.node]
  const rootIndex = chain.indexOf(root)
  return rootIndex === -1 ? chain : chain.slice(rootIndex)
}

/** Catalog entry that describes a model element */
export function catalogEntryOf(node) {
  if (!node || node.type !== 'element') return null
  const is = attr(node, 'is')
  const candidates = store.catalog.filter(item => (item.is || null) === (is || null) &&
    (item.tag === node.tag || (item.tagChoices || []).includes(node.tag)))
  if (candidates.length <= 1) return candidates[0] || null
  // Several entries for the same tag: pick the most specific one
  if (node.tag === 'button' && attr(node, 'data-request-url') !== undefined) {
    return candidates.find(c => c.id === 'button-submit') || candidates[0]
  }
  if (node.tag === 'template' && attr(node, 'data-object-name') !== undefined) {
    return candidates.find(c => c.id === 'template-object') || candidates[0]
  }
  if (node.tag === 'script') {
    return candidates.find(c => c.id === (attr(node, 'src') !== undefined ? 'script-src' : 'script-module')) || candidates[0]
  }
  return candidates.find(c => !c.presetAttributes && !c.parents) || candidates[0]
}

/** Short label of an element: tag + is + id/class */
export function labelOf(node) {
  if (!node) return ''
  if (node.type !== 'element') return node.type === 'fragment' ? 'template root' : node.type
  const is = attr(node, 'is')
  const id = attr(node, 'id')
  const name = attr(node, 'data-object-name') || attr(node, 'data-title')
  let label = node.tag
  if (is) label += `[is=${is}]`
  if (id) label += `#${id}`
  else if (name) label += ` (${name})`
  return label
}

export function textOf(node) {
  return (node.children || []).filter(c => c.type === 'text').map(c => c.value).join(' ').trim()
}

export function catalogById(id) {
  return store.catalog.find(item => item.id === id)
}
