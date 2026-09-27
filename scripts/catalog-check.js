// Warns about EHTML / e-ui elements that have no entry in the e-pages catalog
// (e.g. after `npm run ehtml:update` brings a new element).
//   node scripts/catalog-check.js

import fs from 'fs'
import path from 'path'

const CATALOG_DIR = 'web-app/static/js/e-pages/catalog'
// Folders with elements (EHTML's other folders have internal probes and polyfills)
const SOURCES = {
  ehtml: 'web-app/static/js/ehtml/E',
  'e-ui': 'web-app/static/js/e-ui'
}

const catalog = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json'))
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf-8')).elements)
const known = new Set(catalog.flatMap(e => [e.is, e.tag].filter(Boolean)))

// Only elements that are really registered (imported) count, like EHTML's E/exports.js
const exported = new Set()
const exportsFile = path.join(SOURCES.ehtml, 'exports.js')
if (fs.existsSync(exportsFile)) {
  for (const [, file] of fs.readFileSync(exportsFile, 'utf-8').matchAll(/import\s+(?:\w+\s+from\s+)?['"]#ehtml\/E\/([^'"]+)['"]/g)) {
    exported.add(file)
  }
}

let missing = 0
for (const [library, dir] of Object.entries(SOURCES)) {
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.js'))
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, String(file)), 'utf-8')
    for (const [, name] of source.matchAll(/customElements\.define\(\s*['"]([a-z0-9-]+)['"]/g)) {
      const registered = library !== 'ehtml' || exported.size === 0 || exported.has(path.basename(String(file)))
      if (!known.has(name)) {
        if (registered) missing++
        console.log(`⚠ ${library}: <${name}> (${path.join(dir, String(file))}) has no catalog entry${registered ? '' : ' (skipped: not imported in E/exports.js, so browsers never register it)'}`)
      }
    }
  }
}
console.log(missing === 0 ? '✓ Every registered element has a catalog entry' : `${missing} element(s) without catalog entries`)
