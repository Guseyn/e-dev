import fs from 'fs'
import path from 'path'

import runtime from '#nodes/runtime.js'

// Defaults fit the e-dev blueprint. Other projects (like apps that bring e-dev in later)
// override them in package.json → "e-dev", and eDev in web-app/env/local.json
const DEFAULTS = {
  // File with endpoint(...) declarations and handler imports (data-src → handler file links)
  routesFile: 'web-app/routes.js',
  // Page served at "/"
  indexPage: 'html/index.html',
  // Code editor that opens elements: subl, code or zed
  editor: 'subl'
}

let fromPackage = null

function packageSettings() {
  if (fromPackage) return fromPackage
  try {
    const packageJSON = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'))
    fromPackage = packageJSON['e-dev'] || {}
  } catch {
    fromPackage = {}
  }
  return fromPackage
}

/** e-dev settings: defaults ← package.json "e-dev" ← env config "eDev" */
export default function settings() {
  const fromEnv = (runtime.config && runtime.config.eDev) || {}
  return { ...DEFAULTS, ...packageSettings(), ...fromEnv }
}
