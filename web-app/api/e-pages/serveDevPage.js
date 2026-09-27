import fs from 'fs'

import handler, { respondHTML } from './lib/respond.js'
import { loadModel, saveModel, cloneModel, ensureModuleImports, ID_ATTRIBUTE } from './lib/model.js'
import { pageOfUrl, pageFile } from './lib/paths.js'
import { renderHTML } from './lib/html.js'
import { templatePreviewHTML } from './lib/skeleton.js'
import { requiredImportsOf } from './lib/requires.js'

/**
 * GET /?dev=true, GET /html/...html?dev=true (local environment only)
 * Serves the page rendered from its model, with data-eid="<id>" on elements in <body>,
 * so the editor knows which model element was clicked. Html files on disk stay clean.
 * Templates (no <html>) are wrapped into a page with styles and scripts to preview them.
 */
export default handler(({ stream, headers }) => {
  const url = String(headers[':path'] || '/')
  const page = pageOfUrl(url)
  if (!page || !fs.existsSync(pageFile(page))) {
    return respondHTML(stream, 404, fs.readFileSync('./web-app/static/html/404.html', 'utf-8'))
  }
  let model = loadModel(page)
  // Components of the page and of templates it shows need their scripts: missing imports
  // (like after adding a sidebar to a template) are added to the page, so it works outside of dev mode too
  if (model.kind === 'page') {
    const previous = cloneModel(model)
    const { added } = ensureModuleImports(model, requiredImportsOf(model.root.children, loadModel))
    if (added.length) {
      model = saveModel(page, model, previous)
      console.log(`[e-pages] Added imports to ${page}: ${added.join(', ')}`)
    } else {
      model = previous
    }
  }
  const { html } = renderHTML(model.root, { idAttribute: ID_ATTRIBUTE })
  if (model.kind === 'template') {
    // A template has no <head>: the preview imports what its components need (e-sidebar, e-kbd...)
    const imports = requiredImportsOf(model.root.children, loadModel)
    return respondHTML(stream, 200, templatePreviewHTML(html, { title: page, imports }))
  }
  return respondHTML(stream, 200, html)
})
