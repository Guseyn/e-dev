import fs from 'fs'
import path from 'path'

import { PROJECT_ROOT } from './paths.js'

// Import map comes from package.json ("browser.importmap"), so every new page has the same one
function importMap() {
  const packageJSON = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'))
  const imports = packageJSON['browser.importmap'] || {}
  return JSON.stringify({ imports }, null, 2)
}

function headAssets(imports = []) {
  const map = importMap().split('\n').map(line => `    ${line}`).join('\n')
  const extraImports = imports.map(spec => `\n    import '${spec}'`).join('')
  return `  <link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/normalize.css">
  <link rel="stylesheet" href="/css/e-ui.css">
  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/app.css">
  <script type="importmap">
${map}
  </script>
  <script type="module">
    import '#ehtml/main'
    import '#e-pages/loader.js'${extraImports}
  </script>`
}

function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Html of a new page */
export function newPageHTML({ title }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeText(title || 'New page')}</title>
${headAssets()}
</head>
<body>
  <main is="e-main" data-centralized>
    <section is="e-section" data-padding="2xl">
      <h1 is="e-h" data-font-family="typography">${escapeText(title || 'New page')}</h1>
    </section>
  </main>
</body>
</html>
`
}

/**
 * Html of a new template for <template is="e-wrapper">: no html/head/body,
 * the page content is placed into the element with id="content"
 * (data-where-to-place="#content" data-how-to-place="inside").
 */
export function newTemplateHTML() {
  return `<header is="e-section" data-padding="lg">
  <a is="e-link" href="/">Home</a>
</header>
<main is="e-main" data-centralized>
  <div id="content"></div>
</main>
`
}

/**
 * Wraps a template into a page, so it can be previewed and edited in the browser
 * (a template alone has no styles and scripts).
 */
export function templatePreviewHTML(templateHTML, { title, imports = [] }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeText(title)} (template preview)</title>
${headAssets(imports)}
  <style>
    /* Preview only: shows where e-wrapper puts page content */
    #content:empty { min-height: 160px; border: 2px dashed #c0c0c0; border-radius: 8px; display: grid; place-items: center; }
    #content:empty::before { content: 'page content goes here (#content)'; color: #888; font: 14px system-ui, sans-serif; }
  </style>
</head>
<body data-e-pages-template-preview>
${templateHTML}
</body>
</html>
`
}
