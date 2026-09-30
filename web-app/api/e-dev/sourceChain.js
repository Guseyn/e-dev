import fs from 'fs'
import path from 'path'

import handler from './lib/respond.js'
import { projectFile, fileOfUrl, relativeToProject } from './lib/paths.js'
import { sourceChainAt } from './lib/annotate.js'
import { resolveUrl, handlerLineInFile } from './lib/routesInfo.js'

// Attributes with urls of html, files or endpoints. data-request-url is sent by e-form with POST
// unless data-request-method says otherwise. (data-socket / data-event-source are names, not urls.)
const URL_ATTRIBUTES = { 'data-src': 'GET', 'data-request-url': 'POST' }

/**
 * GET /e-dev/source-chain?src=web-app/static/html/index.html:12:5
 * The element at that location and its ancestors in the file (outermost first),
 * with files of templates and endpoint handlers that their urls point to.
 */
export default handler(({ queries }) => {
  const src = decodeURIComponent(queries.src || '')
  const match = /^(.+):(\d+):(\d+)$/.exec(src)
  if (!match) {
    throw Object.assign(new Error(`Invalid src: ${src}`), { statusCode: 400 })
  }
  const file = projectFile(match[1])
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error(`${match[1]} doesn't exist`), { statusCode: 404 })
  }
  const chain = sourceChainAt(fs.readFileSync(file, 'utf-8'), Number(match[2]), Number(match[3]))
  if (!chain) {
    // The file was changed after the page was loaded
    return { file: relativeToProject(file), chain: null }
  }
  return {
    file: relativeToProject(file),
    chain: chain.map(({ tag, attrs, line, column }) => ({
      tag,
      is: attrs.is || null,
      id: attrs.id || null,
      title: attrs['data-title'] || null,
      src: `${relativeToProject(file)}:${line}:${column}`,
      links: linksOf(attrs)
    }))
  }
})

function linksOf(attrs) {
  const links = []
  const seen = new Set()
  const add = (link) => {
    if (seen.has(link.src)) return
    seen.add(link.src)
    links.push(link)
  }
  // Explicit handler: data-endpoint-handler="web-app/endpoint-handlers/getPosts.js"
  const handlerFile = attrs['data-endpoint-handler']
  if (handlerFile && !handlerFile.includes('${')) {
    const file = safeProjectFile(handlerFile)
    if (file && fs.existsSync(file)) {
      add({ attribute: 'data-endpoint-handler', url: handlerFile, src: `${handlerFile}:${handlerLineInFile(handlerFile)}:1` })
    }
  }
  for (const [name, defaultMethod] of Object.entries(URL_ATTRIBUTES)) {
    const url = attrs[name]
    if (!url) continue
    // A file served by the app: templates, markdown, svg...
    if (!url.includes('${')) {
      const file = fileOfUrl(path.posix.normalize(url.split(/[?#]/)[0]))
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
        add({ attribute: name, url, src: `${relativeToProject(file)}:1:1` })
        continue
      }
    }
    // An endpoint: data-src-pattern / data-request-url-pattern say which one, when the url is dynamic
    const method = name === 'data-request-url' ? (attrs['data-request-method'] || defaultMethod) : defaultMethod
    const route = resolveUrl(attrs[`${name}-pattern`] || url, method)
    if (route && route.file) {
      add({ attribute: name, url, src: `${route.file}:${route.handlerLine || 1}:1` })
    }
  }
  return links
}

function safeProjectFile(file) {
  try {
    return projectFile(file)
  } catch {
    return null
  }
}
