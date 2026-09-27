import fs from 'fs'
import path from 'path'

import isEndpointMatchedWithRequestUrlAndMethod from '#nodes/isEndpointMatchedWithRequestUrlAndMethod.js'
import { PROJECT_ROOT } from './paths.js'

const ROUTES_FILE = 'web-app/routes.js'

/**
 * Reads endpoints declared in web-app/routes.js, with handler files:
 *   import getPosts from '#web-app/api/getPosts.js'
 *   endpoint('/posts?page', 'GET', getPosts)
 *
 * @returns {{ method: string, urlPattern: string, isRegExp: boolean, handler: string, file: string|null, line: number, handlerLine: number, routesLine: number }[]}
 */
export function readRoutes() {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, ROUTES_FILE), 'utf-8')

  const imports = {}
  const importRegex = /^\s*import\s+(\w+)\s+from\s+['"]#web-app\/([^'"]+)['"]/gm
  let match
  while ((match = importRegex.exec(source))) {
    imports[match[1]] = `web-app/${match[2]}`
  }

  const routes = []
  const endpointRegex = /endpoint\(\s*(?:(['"`])((?:\\.|(?!\1).)*)\1|(\/(?:\\.|[^/\n])+\/[a-z]*))\s*,\s*(['"`])([A-Z, ]+)\4\s*,\s*([\w.]+)/g
  while ((match = endpointRegex.exec(source))) {
    const isRegExp = Boolean(match[3])
    const urlPattern = isRegExp ? match[3] : match[2]
    const handler = match[6]
    const file = imports[handler] || null
    const routesLine = source.slice(0, match.index).split('\n').length
    for (const method of match[5].split(',').map(m => m.trim()).filter(Boolean)) {
      routes.push({
        method,
        urlPattern,
        isRegExp,
        handler,
        file,
        handlerLine: file ? handlerLineInFile(file) : 1,
        routesFile: ROUTES_FILE,
        routesLine
      })
    }
  }
  return routes
}

// Line of `export default` in the handler file, so the editor opens right at the handler
function handlerLineInFile(file) {
  try {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf-8')
    const index = content.search(/export\s+default/)
    return index === -1 ? 1 : content.slice(0, index).split('\n').length
  } catch {
    return 1
  }
}

/**
 * Finds the endpoint for a url written in html (data-src, data-request-url...).
 * `${...}` expressions are treated as url params.
 *
 * @param {string} url
 * @param {string} [method]
 */
export function resolveUrl(url, method = 'GET') {
  const concreteUrl = replaceExpressions(String(url)).split('#')[0]
  const routes = readRoutes()
  return routes.find(route => {
    if (route.method !== method.toUpperCase()) return false
    let urlPattern = route.urlPattern
    if (route.isRegExp) {
      try {
        const [, body, flags] = /^\/(.*)\/([a-z]*)$/.exec(route.urlPattern)
        urlPattern = new RegExp(body, flags)
      } catch {
        return false
      }
    }
    return isEndpointMatchedWithRequestUrlAndMethod(
      { urlPattern, method: route.method },
      concreteUrl,
      route.method
    )
  }) || null
}

// "/posts/${post.id}?page=${page}" → "/posts/x?page=x" (handles nested braces)
function replaceExpressions(value) {
  let result = ''
  let i = 0
  while (i < value.length) {
    if (value[i] === '$' && value[i + 1] === '{') {
      let depth = 0
      let j = i + 1
      for (; j < value.length; j++) {
        if (value[j] === '{') depth++
        else if (value[j] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      result += 'x'
      i = j + 1
      continue
    }
    result += value[i]
    i++
  }
  return result
}
