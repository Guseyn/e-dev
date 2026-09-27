import fs from 'fs'
import path from 'path'

import { walkElements, attributeValue } from './html.js'
import { PROJECT_ROOT, listPages, pageOfUrl } from './paths.js'

const CATALOG_DIR = 'web-app/static/js/e-pages/catalog'

let cache = null

// Component name (tag or `is`) → scripts it needs, from "requires" in the catalog
function requiresByName() {
  if (cache) return cache
  cache = new Map()
  const dir = path.join(PROJECT_ROOT, CATALOG_DIR)
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
    for (const entry of catalog.elements || []) {
      if (!entry.requires) continue
      const name = entry.is || entry.tag
      cache.set(name, [...new Set([...(cache.get(name) || []), ...entry.requires])])
    }
  }
  return cache
}

/**
 * Scripts (like "#e-ui/e-sidebar.js") needed by elements in `nodes` and their subtrees.
 * Elements that load html templates (e-wrapper, e-html) bring what their templates need.
 *
 * @param {any[]} nodes
 * @param {(page: string) => any} loadModel to read models of templates
 * @param {Set<string>} [visited] pages already scanned (templates can include templates)
 * @returns {string[]}
 */
export function requiredImportsOf(nodes, loadModel, visited = new Set()) {
  const byName = requiresByName()
  const specs = new Set()
  const scan = (node) => {
    const names = [attributeValue(node, 'is'), node.tag].filter(Boolean)
    for (const name of names) {
      for (const spec of byName.get(name) || []) specs.add(spec)
    }
    const src = attributeValue(node, 'data-src')
    if (src && (node.tag === 'e-html' || attributeValue(node, 'is') === 'e-wrapper')) {
      const page = pageOfUrl(src)
      if (page && !visited.has(page)) {
        visited.add(page)
        try {
          const template = loadModel(page)
          for (const spec of requiredImportsOf(template.root.children, loadModel, visited)) specs.add(spec)
        } catch {
          // template doesn't exist (yet)
        }
      }
    }
  }
  for (const node of nodes) {
    if (node.type !== 'element') continue
    scan(node)
    walkElements(node, scan)
  }
  return [...specs]
}

/**
 * Pages that show the template with e-wrapper or e-html (data-src="/html/templates/...").
 * @param {string} templatePage e.g. "html/templates/account.html"
 */
export function pagesUsingTemplate(templatePage, loadModel) {
  const result = []
  for (const page of listPages()) {
    if (page === templatePage) continue
    let model
    try {
      model = loadModel(page)
    } catch {
      continue
    }
    let uses = false
    walkElements(model.root, (node) => {
      const src = attributeValue(node, 'data-src')
      if (src && pageOfUrl(src) === templatePage) uses = true
    })
    if (uses) result.push(page)
  }
  return result
}
