// Mount point of the e-dev UI: a shadow root on an element attached to <html>
// (outside of <body>), so the page CSS doesn't affect it and EHTML's observer
// (which watches <body>) doesn't touch it.

import { styleSheets } from '#e-dev/styles.js'

export const ui = {
  host: null,
  root: null, // shadow root
  layer: null // container for overlays
}

export async function mountUI() {
  const host = document.createElement('e-dev-ui')
  host.setAttribute('data-no-ehtml', 'true')
  document.documentElement.append(host)
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = await styleSheets()
  const layer = h('div', { 'data-ed': 'layer' })
  root.append(layer)
  Object.assign(ui, { host, root, layer })
  return ui
}

/** Is the event target part of the e-dev UI */
export function isUIEvent(event) {
  return event.composedPath().includes(ui.host)
}

/**
 * Creates an element: h('a', { href: '#', onclick }, 'text', otherElement)
 * Attributes with null / false are skipped, functions become listeners.
 */
export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag, attrs.is ? { is: attrs.is } : undefined)
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (typeof value === 'function') {
      element.addEventListener(name.replace(/^on/, ''), value)
    } else {
      element.setAttribute(name, value === true ? '' : String(value))
    }
  }
  element.append(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false))
  return element
}

let toastTimer = null
export function toast(message, { error = false } = {}) {
  ui.root.querySelectorAll('[data-ed="toast"]').forEach(t => t.remove())
  // Popover: above modal dialogs of the page
  const element = h('div', { 'data-ed': 'toast', 'data-error': error, popover: 'manual' }, message)
  ui.layer.append(element)
  element.showPopover()
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => element.remove(), error ? 7000 : 3500)
}

/**
 * Opens file:line:column in the code editor (eDev.editor in web-app/env/local.json, Sublime by default).
 * @param {string} src "web-app/static/html/index.html:12:5" or "/js/e-ui/e-date.js:462:21"
 */
export async function openInEditor(src) {
  const [, file, line, column] = /^(.+):(\d+):(\d+)$/.exec(src) || [null, src, 1, 1]
  // Project files ("web-app/...") or urls of files served by the app ("/js/e-ui/e-date.js", "/md/post.md")
  const location = file.startsWith('/') ? { url: file } : { file }
  try {
    const response = await fetch('/e-dev/open-in-editor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...location, line: Number(line), column: Number(column) })
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      toast(body.error || `Could not open ${src}`, { error: true })
    }
  } catch (error) {
    toast(`Could not open ${src}: ${error.message}`, { error: true })
  }
}
