import fs from 'fs'
import path from 'path'

import defaultSrcMapper, { isInsideFolder } from '#nodes/defaultSrcMapper.js'

// All paths are resolved from the project root (the app always runs from there)
export const PROJECT_ROOT = path.resolve('.')
export const STATIC_DIR = path.resolve('web-app/static')
export const HTML_DIR = path.join(STATIC_DIR, 'html')
export const MODELS_DIR = path.join(STATIC_DIR, 'json', 'e-pages')
export const HISTORY_DIR = path.join(MODELS_DIR, '.history')
export const INDEX_PAGE = 'html/index.html'

export class PathError extends Error {
  constructor(message) {
    super(message)
    this.statusCode = 400
  }
}

/**
 * Page ids are paths relative to web-app/static, like "html/blog/post.html".
 * Accepts "blog/post.html", "/html/blog/post.html", "html/blog/post" as well.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizePage(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathError('Page path is required')
  }
  let page = input.trim().replace(/\\/g, '/').replace(/^\/+/, '').split('?')[0]
  if (!page.startsWith('html/')) {
    page = `html/${page}`
  }
  if (!page.endsWith('.html')) {
    page = `${page}.html`
  }
  const parts = page.split('/')
  if (parts.some(p => p === '' || p === '.' || p === '..' || p.includes('\0'))) {
    throw new PathError(`Invalid page path: ${input}`)
  }
  if (!parts.every(p => /^[\w.-]+$/.test(p))) {
    throw new PathError(`Page path can contain only letters, digits, "-", "_" and ".": ${input}`)
  }
  if (!isInsideFolder(path.join(STATIC_DIR, page), HTML_DIR)) {
    throw new PathError(`Page must be inside web-app/static/html: ${input}`)
  }
  return page
}

/** Absolute path of the page html file */
export function pageFile(page) {
  return path.join(STATIC_DIR, page)
}

/** Absolute path of the page model (web-app/static/json/e-pages/<page without html/>.json) */
export function modelFile(page) {
  return path.join(MODELS_DIR, page.replace(/^html\//, '').replace(/\.html$/, '.json'))
}

/** Url of the page, as served by the static mapping in web-app/routes.js */
export function urlOfPage(page) {
  return page === INDEX_PAGE ? '/' : `/${page}`
}

/**
 * Page of a request url, resolved with the same mapper nodes uses for static files.
 * Returns null if url doesn't point to an html page.
 *
 * @param {string} url
 */
export function pageOfUrl(url) {
  const pathname = url.split('?')[0].split('#')[0]
  if (pathname === '/' || pathname === '') {
    return INDEX_PAGE
  }
  const file = defaultSrcMapper(STATIC_DIR, pathname)
  if (!file || !isInsideFolder(file, HTML_DIR) || !file.endsWith('.html')) {
    return null
  }
  return path.relative(STATIC_DIR, file).split(path.sep).join('/')
}

/** Project-relative path (for display and editor links) */
export function relativeToProject(absolutePath) {
  return path.relative(PROJECT_ROOT, absolutePath).split(path.sep).join('/')
}

/**
 * Resolves a project-relative file path and makes sure it stays inside the project.
 * @param {string} file
 */
export function projectFile(file) {
  if (typeof file !== 'string' || file === '') {
    throw new PathError('File is required')
  }
  const absolute = path.resolve(PROJECT_ROOT, file)
  if (!isInsideFolder(absolute, PROJECT_ROOT)) {
    throw new PathError(`File must be inside the project: ${file}`)
  }
  return absolute
}

/** All html pages under web-app/static/html, as page ids */
export function listPages() {
  const pages = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.html')) {
        pages.push(path.relative(STATIC_DIR, full).split(path.sep).join('/'))
      }
    }
  }
  if (fs.existsSync(HTML_DIR)) {
    walk(HTML_DIR)
  }
  return pages.sort()
}
