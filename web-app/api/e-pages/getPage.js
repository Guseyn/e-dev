import handler from './lib/respond.js'
import { loadModel, undoAvailable, redoAvailable } from './lib/model.js'
import { normalizePage, urlOfPage, pageFile, modelFile, relativeToProject } from './lib/paths.js'
import { walkElements, attributeValue } from './lib/html.js'
import { resolveUrl } from './lib/routesInfo.js'

// Attributes that point to endpoints or pages, resolved to files for editor links
const SOURCE_ATTRIBUTES = ['data-src', 'data-request-url', 'data-socket', 'data-event-source']

/**
 * GET /e-pages/page?path=html/index.html
 * Model of the page + where each data-src/data-request-url leads in code.
 */
export default handler(({ queries }) => {
  const page = normalizePage(decodeURIComponent(queries.path || ''))
  const model = loadModel(page)
  return {
    ...model,
    url: urlOfPage(page),
    file: relativeToProject(pageFile(page)),
    modelFile: relativeToProject(modelFile(page)),
    undoAvailable: undoAvailable(page),
    redoAvailable: redoAvailable(page),
    sources: sourcesOf(model)
  }
})

export function sourcesOf(model) {
  const sources = {}
  walkElements(model.root, (node) => {
    for (const attribute of SOURCE_ATTRIBUTES) {
      const value = attributeValue(node, attribute)
      if (!value || /^https?:|^wss?:/.test(value)) continue
      const entry = { attribute, url: value }
      if (value.startsWith('/html/')) {
        entry.kind = 'page'
        entry.file = `web-app/static${value.split('?')[0]}`
        entry.line = 1
      } else {
        const method = attribute === 'data-request-url'
          ? (attributeValue(node, 'data-request-method') || 'POST')
          : 'GET'
        const route = resolveUrl(value, method)
        if (route) {
          entry.kind = 'endpoint'
          entry.method = route.method
          entry.urlPattern = route.urlPattern
          entry.file = route.file
          entry.line = route.handlerLine
        } else {
          entry.kind = 'unknown'
        }
      }
      sources[node.id] = sources[node.id] || []
      sources[node.id].push(entry)
    }
  })
  return sources
}
