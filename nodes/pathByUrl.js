import defaultSrcMapper, { isInsideFolder } from '#nodes/defaultSrcMapper.js'

/**
 * Resolves the file path for a given request URL using a source mapper or a base folder.
 *
 * @param {string} requestUrl - The URL of the incoming request.
 * @param {Function} [srcMapper] - A custom function to map the request URL to a file path.
 * @param {string} [baseFolder] - The base folder to use if no `srcMapper` is provided. Defaults to the current working directory.
 * @returns {string|null} The resolved file path, or `null` if it must not be served.
 *
 * @description
 * This function determines the file path for a request by:
 * 1. Using a provided `srcMapper` function, if available.
 * 2. Falling back to the `defaultSrcMapper` with the specified `baseFolder`.
 * 3. Using the current working directory as the default base folder if none is specified.
 *
 * When both `srcMapper` and `baseFolder` are provided, the path returned by `srcMapper`
 * must stay inside `baseFolder`, otherwise `null` is returned.
 */
export default function pathByUrl(requestUrl, srcMapper, baseFolder) {
  if (srcMapper) {
    const resolvedFilePath = srcMapper(requestUrl)
    if (!resolvedFilePath) {
      return null
    }
    if (baseFolder && !isInsideFolder(resolvedFilePath, baseFolder)) {
      return null
    }
    return resolvedFilePath
  }
  return defaultSrcMapper(baseFolder || process.cwd(), requestUrl)
}
