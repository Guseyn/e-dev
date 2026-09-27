import fs from 'fs'

import handler from './lib/respond.js'
import { listPages, pageFile, urlOfPage } from './lib/paths.js'

/**
 * GET /e-pages/pages
 * All html files in web-app/static/html. `kind` is "template" for files
 * without <html> (parts of pages for e-wrapper / e-html), otherwise "page".
 */
export default handler(() => {
  return listPages().map((page) => {
    const head = fs.readFileSync(pageFile(page), 'utf-8').slice(0, 2000)
    const isPage = /<!doctype|<html[\s>]/i.test(head)
    const title = (head.match(/<title>([^<]*)<\/title>/i) || [])[1] || null
    return {
      page,
      url: urlOfPage(page),
      kind: isPage ? 'page' : 'template',
      title
    }
  })
})
