import fs from 'fs'

import handler, { respondHTML } from './lib/respond.js'
import { pageOfUrl, pageFile, relativeToProject } from './lib/paths.js'
import { annotateHTML } from './lib/annotate.js'

/**
 * GET /html/...html (local environment only)
 * Html that EHTML fetches (e-wrapper, e-html, loadHTMLInto...) for a page opened with ?dev=true
 * (the request is made from it, so its referer has dev=true) gets data-e-src on elements too.
 * Other requests get the file as it is.
 */
export default handler(({ stream, headers }) => {
  const page = pageOfUrl(String(headers[':path'] || ''))
  if (!page || !fs.existsSync(pageFile(page))) {
    return respondHTML(stream, 404, fs.readFileSync('./web-app/static/html/404.html', 'utf-8'))
  }
  const file = pageFile(page)
  const html = fs.readFileSync(file, 'utf-8')
  return respondHTML(stream, 200, isFromDevPage(headers.referer) ? annotateHTML(html, relativeToProject(file)) : html)
})

function isFromDevPage(referer) {
  try {
    return new URL(String(referer)).searchParams.get('dev') === 'true'
  } catch {
    return false
  }
}
