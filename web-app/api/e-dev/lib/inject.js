// Adds e-dev to a page when it's served in dev mode (html files on disk are not changed),
// so e-dev works in existing apps without editing their pages. Lines of the page stay the same.

const LOADER = '#e-dev/loader.js'
const IMPORT_MAP = /<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script\s*>/i

/**
 * Adds "#e-dev/" to the import map of the page (or an import map, if there is none),
 * and imports the loader right after it, before other module scripts, so e-dev
 * observes the page before EHTML renders anything.
 *
 * @param {string} html
 */
export function injectEDev(html) {
  const loader = `<script type="module">import '${LOADER}'</script>`
  const match = IMPORT_MAP.exec(html)
  if (match) {
    let map
    try {
      map = JSON.parse(match[1].trim() || '{}')
    } catch {
      return html
    }
    map.imports = map.imports || {}
    let script = match[0]
    if (!map.imports['#e-dev/']) {
      map.imports['#e-dev/'] = '/js/e-dev/'
      // Same number of lines, so lines of inline scripts in the browser match the file
      const newLines = (match[1].match(/\n/g) || []).length
      script = script.replace(match[1], JSON.stringify(map) + '\n'.repeat(newLines))
    }
    const end = match.index + match[0].length
    return html.slice(0, match.index) + script + loader + html.slice(end)
  }
  const importMap = `<script type="importmap">${JSON.stringify({ imports: { '#e-dev/': '/js/e-dev/' } })}</script>`
  // Import map must come before module scripts
  const firstScript = html.search(/<script\b/i)
  const headEnd = html.search(/<\/head\s*>/i)
  const at = firstScript !== -1 && (headEnd === -1 || firstScript < headEnd)
    ? firstScript
    : (headEnd !== -1 ? headEnd : 0)
  return html.slice(0, at) + importMap + loader + html.slice(at)
}
