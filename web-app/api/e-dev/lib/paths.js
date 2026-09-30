import path from 'path'

import defaultSrcMapper from '#nodes/defaultSrcMapper.js'
import settings from './settings.js'

// All paths are resolved from the project root (the app always runs from there)
export const PROJECT_ROOT = path.resolve('.')
export const STATIC_DIR = path.resolve('web-app/static')
export const HTML_DIR = path.join(STATIC_DIR, 'html')

// Own copy (not from nodes), so e-dev works with older copies of nodes too
export function isInsideFolder(filePath, folder) {
  const relative = path.relative(path.resolve(folder), path.resolve(filePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export class PathError extends Error {
  constructor(message) {
    super(message)
    this.statusCode = 400
  }
}

/** Absolute path of the page html file (page ids are paths relative to web-app/static, like "html/blog/post.html") */
export function pageFile(page) {
  return path.join(STATIC_DIR, page)
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
    return settings().indexPage
  }
  const file = defaultSrcMapper(STATIC_DIR, pathname)
  if (!file || !isInsideFolder(file, HTML_DIR) || !file.endsWith('.html')) {
    return null
  }
  return path.relative(STATIC_DIR, file).split(path.sep).join('/')
}

/**
 * File of a url served by the app: "/" → the index page, "/html/x.html", "/js/e-ui/e-date.js?v=1",
 * "/md/post.md"... (static files, resolved with the same mapper nodes uses). Null if there is none.
 *
 * @param {string} url
 */
export function fileOfUrl(url) {
  let pathname
  try {
    pathname = new URL(url, 'http://localhost').pathname
  } catch {
    return null
  }
  if (pathname === '/' || pathname === '') {
    return pageFile(settings().indexPage)
  }
  const file = defaultSrcMapper(STATIC_DIR, pathname)
  if (!file || !isInsideFolder(file, STATIC_DIR)) return null
  return file
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
