import handler from './lib/respond.js'
import { createModel } from './lib/model.js'
import { normalizePage, urlOfPage, pageOfUrl } from './lib/paths.js'
import { newPageHTML, newTemplateHTML } from './lib/skeleton.js'

/**
 * POST /e-pages/page/new { path: "blog/post.html", title }
 * POST /e-pages/template/new { path: "templates/account.html" }
 * Creates the html file (and its model), responds with the url to open.
 */
export function createPageOfKind(kind) {
  return handler(({ body }) => {
    let page = normalizePage(body.path)
    if (kind === 'template' && !page.startsWith('html/templates/')) {
      page = page.replace(/^html\//, 'html/templates/')
    }
    const url = urlOfPage(page)
    // The url must lead back to the same file through the static mapper
    if (pageOfUrl(url) !== page) {
      throw Object.assign(new Error(`${page} is not reachable by url ${url}`), { statusCode: 400 })
    }
    const html = kind === 'template' ? newTemplateHTML() : newPageHTML({ title: body.title })
    const model = createModel(page, html)
    return { page, url, kind: model.kind, version: model.version }
  })
}

export default createPageOfKind('page')
