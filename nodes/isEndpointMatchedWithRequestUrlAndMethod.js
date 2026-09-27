/**
 * @param {import('./types.js').NodesRoutable} endpoint
 * @param {string} requestUrl
 * @param {string} requestMethod
 * @returns {boolean}
 */
export default function isEndpointMatchedWithRequestUrlAndMethod(endpoint, requestUrl, requestMethod) {
  let match = false
  if (endpoint.method && requestMethod) {
    const isEndpointCors = endpoint.useCors || endpoint.allowedOrigins !== undefined
    const allowedMethods = endpoint.method.split(',').map(t => t.trim())
    if (isEndpointCors) {
      allowedMethods.push('OPTIONS')
    }
    const methodIsIncluded = allowedMethods.includes(requestMethod)
    match = methodIsIncluded && matchUrlPattern(endpoint.urlPattern, requestUrl)
  } else {
    match = matchUrlPattern(endpoint.urlPattern, requestUrl)
  }
  return match
}

/**
 * @param {string | RegExp} pattern
 * @param {string} url
 */
function matchUrlPattern(pattern, url) {
  if (pattern instanceof RegExp) {
    return pattern.test(url)
  }
  const patternParts = pattern.split('?')
  const patternPathParts = patternParts[0].split('/').filter(p => p !== '')

  const urlParts = url.split('?')
  const urlPathParts = urlParts[0].split('/').filter(p => p !== '')

  if (patternPathParts.length !== urlPathParts.length) {
    return false
  }

  for (let i = 0; i < patternPathParts.length; i++) {
    const patternPathPart = patternPathParts[i]
    const urlPathPart = urlPathParts[i]
    
    if (patternPathPart.startsWith(':')) {
      continue
    }
    
    if (patternPathPart === '*') {
      continue
    }
    
    if (patternPathPart !== urlPathPart) {
      return false
    }
  }
  return true
}
