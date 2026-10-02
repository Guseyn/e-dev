import fs from 'fs'

import handler, { respondHTML } from './lib/respond.js'
import { pageOfUrl, pageFile, notFoundFile, relativeToProject } from './lib/paths.js'
import { annotateHTML } from './lib/annotate.js'
import { injectEDev } from './lib/inject.js'

/**
 * GET /?dev=true, GET /html/...html?dev=true, GET <pageUrls prefix>/...?dev=true (local environment only)
 * Serves the page with data-e-src="<file>:<line>:<column>" on elements, so any element
 * on the page can be opened in the code editor. Pages that don't include e-dev
 * get the import map entry and the loader. Html files on disk are not changed.
 */
export default handler(({ stream, headers }) => {
  const url = String(headers[':path'] || '/')
  const page = pageOfUrl(url)
  if (!page || !fs.existsSync(pageFile(page))) {
    return respondHTML(stream, 404, fs.readFileSync(notFoundFile(), 'utf-8'))
  }
  const file = pageFile(page)
  const html = annotateHTML(fs.readFileSync(file, 'utf-8'), relativeToProject(file))
  return respondHTML(stream, 200, injectEDev(html))
})
