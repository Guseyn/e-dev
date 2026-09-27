// All changes go through EHTML's e-form: a hidden <form is="e-form"> is built from
// the request object (nested objects/arrays → e-form-object / e-form-array), and its
// button with data-request-url sends it, like any e-form on a page.

import { h } from '#e-pages/dom.js'
import { store } from '#e-pages/store.js'

let formsHost = null
let counter = 0
const callbacks = new Map()

// Called from data-actions-on-response of the hidden forms
window.__ePagesOnResponse = function (button, response) {
  const id = button.getAttribute('data-e-pages-request')
  const callback = callbacks.get(id)
  callbacks.delete(id)
  button.closest('form')?.remove()
  if (callback) callback(response)
}

export function setFormsHost(element) {
  formsHost = element
}

/**
 * Sends `body` to `url` with an e-form and resolves with { statusCode, body }.
 * Falls back to fetch when EHTML is not on the page.
 *
 * @param {string} url
 * @param {object} body
 * @param {{ method?: string }} [options]
 */
export function send(url, body, { method = 'POST' } = {}) {
  if (!window.activateNode || !customElements.get('e-form') || !formsHost) {
    return sendWithFetch(url, body, method)
  }
  return new Promise((resolve) => {
    const id = `r${++counter}`
    // e-form throws on responses that are not JSON (e.g. 405 when the API isn't registered)
    const timer = setTimeout(() => {
      callbacks.delete(id)
      resolve({ statusCode: 0, body: { error: `No JSON response from ${url} (is the app running in local environment?)` } })
    }, 20000)
    callbacks.set(id, (response) => { clearTimeout(timer); resolve(response) })
    const button = h('button', {
      type: 'button',
      'data-e-pages-request': id,
      'data-request-url': url,
      'data-request-method': method,
      'data-response-name': 'response',
      'data-actions-on-response': 'window.__ePagesOnResponse(this, response)'
    })
    const form = document.createElement('form', { is: 'e-form' })
    form.setAttribute('is', 'e-form')
    form.setAttribute('data-do-not-trigger-on-enter', '')
    form.append(...fieldsOf(body).filter(Boolean), button)
    // e-form skips direct children of a shadow root, so it's placed into a wrapper
    formsHost.append(form)
    window.activateNode(form)
    queueMicrotask(() => form.ehtmlSubmit(button))
  })
}

// Fields are textareas (the forms host is display: none): they keep line breaks (text inputs
// drop them), and their value is not an attribute (for hidden inputs setting .value also
// sets the value attribute, and EHTML would evaluate ${...} in it).
function fieldsOf(object) {
  const fields = []
  for (const [name, value] of Object.entries(object)) {
    fields.push(fieldOf(name, value))
  }
  return fields
}

function fieldOf(name, value) {
  if (value === undefined) return null
  if (Array.isArray(value)) {
    return h('e-form-array', { name }, value.map(item => arrayItemOf(item)))
  }
  if (value !== null && typeof value === 'object') {
    return h('e-form-object', { name }, fieldsOf(value))
  }
  return h('textarea', { name, value: value === null ? '' : String(value) })
}

function arrayItemOf(item) {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    return h('e-form-object', {}, fieldsOf(item))
  }
  return h('textarea', { value: item === null ? '' : String(item) })
}

async function sendWithFetch(url, body, method) {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { statusCode: response.status, body: await response.json() }
}

/* ──────────────────────────────────────────────────────────────── */
/* API                                                              */
/* ──────────────────────────────────────────────────────────────── */

function withPage(body) {
  return { page: store.page, version: store.model.version, ...body }
}

export const api = {
  addElement: (body) => send('/e-pages/element/add', withPage(body)),
  updateElement: (body) => send('/e-pages/element/update', withPage(body)),
  deleteElement: (id) => send('/e-pages/element/delete', withPage({ id })),
  moveElement: (body) => send('/e-pages/element/move', withPage(body)),
  setElementHTML: (body) => send('/e-pages/element/html', withPage(body)),
  undo: () => send('/e-pages/undo', { page: store.page }),
  redo: () => send('/e-pages/redo', { page: store.page }),
  saveCssVars: (vars) => send('/e-pages/css-vars', { vars }),
  newPage: (body) => send('/e-pages/page/new', body),
  newTemplate: (body) => send('/e-pages/template/new', body),
  openInEditor: (file, line, search) => send('/e-pages/open-in-editor', { file, line: line || '', search: search || '' })
}
