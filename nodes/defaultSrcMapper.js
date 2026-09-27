import path from 'path'

/**
 * Maps a request URL to a file path within a base folder.
 *
 * @param {string} baseFolder - The base folder where files are located.
 * @param {string} requestUrl - The requested URL to be mapped to a file path.
 * @returns {string|null} The resolved file path, or `null` if the URL is malformed
 * or would resolve to a path outside of `baseFolder`.
 *
 * @description
 * This function maps a given request URL to a corresponding file path within a specified base folder.
 * It removes query parameters from the URL and splits the path into parts, joining them with the base folder.
 *
 * Every segment is URL-decoded, so segments such as `%2e%2e` or `%2f` are rejected
 * to prevent path traversal outside of `baseFolder`.
 *
 * ### Example
 * ```javascript
 * const filePath = defaultSrcMapper('/var/www', '/images/photo.jpg?size=large');
 * console.log(filePath); // Outputs: '/var/www/images/photo.jpg'
 * ```
 */
export default function defaultSrcMapper(baseFolder, requestUrl) {
  let parts
  try {
    parts = requestUrl
      .split('?')[0]
      .split('/')
      .filter(part => part !== '')
      .map(part => decodeURIComponent(part))
  } catch {
    return null
  }
  const hasForbiddenPart = parts.some(part =>
    part === '..' ||
    part === '.' ||
    part.includes('/') ||
    part.includes('\\') ||
    part.includes('\0')
  )
  if (hasForbiddenPart) {
    return null
  }
  const resolvedFilePath = path.join(baseFolder, ...parts)
  if (!isInsideFolder(resolvedFilePath, baseFolder)) {
    return null
  }
  return resolvedFilePath
}

/**
 * @param {string} filePath
 * @param {string} folder
 * @returns {boolean}
 */
export function isInsideFolder(filePath, folder) {
  const relative = path.relative(path.resolve(folder), path.resolve(filePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
