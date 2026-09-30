// Remembers where every node on the page came from.
//
// Elements on a dev page have data-e-src="<file>:<line>:<column>" (added by the server),
// and EHTML keeps it on everything it renders. But elements that render (templates, e-html,
// e-json...) are removed from the page after that, together with the knowledge of who
// rendered what. The tracker keeps it:
//
//   - Template content. EHTML (and e-ui) always render templates by cloning `template.content`
//     (cloneNode / importNode), so clones are linked to their <template> right when they are
//     made, wherever they are placed then (data-insert-into, data-append-to, e-wrapper slots...).
//     Clones get the e-for-each index and the state of mapToTemplate() / releaseTemplate() too.
//   - Other insertions (MutationObserver):
//       element.innerHTML = html: e-html, e-markdown, e-svg, e-json-view → record.target
//       template.replaceWith(generated): e-ui templates, e-json, unwrapping → record.removedNodes
//       insertBefore(content, element): e-wrapper                         → record.nextSibling
//       an element moved into a generated wrapper (input is="e-date")     → the wrapped element
//   - Requests. Nodes inserted while EHTML handles a response (XHR) are linked to the request,
//     and requests to the element that made them (e-json, e-html, a button of e-form...).
//   - Triggers. Templates released by mapToTemplate() / releaseTemplate() remember the call
//     and who made it: an action of an element (data-actions-on-response of e-json...),
//     or an event (onclick="mapToTemplate(...)"). So the path to an element can be shown:
//     e-json (GET /posts) › mapToTemplate('#post') › template#post › the element.
//   - e-wrapper. Its own content is only placed into a slot of the fetched template: it's
//     linked to the wrapper as "placed", not as something that came with the template.
//   - Scripts. Elements created with createElement / innerHTML remember the stack, so the line
//     of JS that created them can be opened (e-ui components, custom scripts).
//   - Components. customElements.define() remembers the file that defines each element.
//
// Each origin links to the origin of the element that rendered it, so nested templates
// (a wrapper in a wrapped template, e-for-each in e-for-each) form a chain.

const SRC_ATTRIBUTE = 'data-e-src'

// EHTML elements that render markup into themselves (others only unwrap their children)
const EHTML_RENDERERS = new Set(['E-HTML', 'E-MARKDOWN', 'E-SVG', 'E-JSON-VIEW', 'E-JSON'])

/**
 * @typedef {{ node: Element, how: string, code?: string }} Initiator  who did something: an element
 *   running its action (how: 'action', code of the action), being activated by EHTML, or an event target
 * @typedef {{ method: string, url: string, status?: number, response?: string, initiator?: Initiator|null }} Request
 * @typedef {{ action: string, target: any, via: Initiator|null, request: Request|null }} Trigger
 * @typedef {{
 *   src: string|null, tag: string, is: string|null, id: string|null,
 *   parent: Origin|null, index?: number, state?: any, request?: Request, wraps?: boolean,
 *   trigger?: Trigger, placed?: { where: string|null, how: string, into: string|null }
 * }} Origin
 */

/** @type {WeakMap<Node, Origin>} */
const origins = new WeakMap()
// Where removed renderers were (e-html is unwrapped right after it sets innerHTML,
// so when records are handled, it's not on the page anymore)
const removedFrom = new WeakMap()
/** @type {WeakMap<DocumentFragment, HTMLTemplateElement>} */
const contentOwners = new WeakMap()
/** @type {WeakMap<HTMLTemplateElement, any>} state of the last mapToTemplate() / releaseTemplate() */
const triggeredStates = new WeakMap()
/** @type {WeakMap<Node, Error>} where an element was created by script */
const creations = new WeakMap()
/** @type {Map<string, Error>} where a custom element was defined */
const definitions = new Map()
/** Requests made by the page (the last 100), newest last */
export const requests = []

let observer = null
let currentRequest = null // request whose response is being handled
let currentAction = null // action of an element that is running: { node, code }
let currentActivating = null // element that EHTML is activating
let currentTrigger = null // mapToTemplate() / releaseTemplate() call that is running
/** @type {WeakMap<HTMLTemplateElement, Trigger|null>} */
const triggers = new WeakMap()
let clonesInTask = new WeakMap() // template → number of clones made in this task (e-for-each index)
let clonesResetQueued = false

/* ──────────────────────────────────────────────────────────────── */
/* ORIGINS                                                          */
/* ──────────────────────────────────────────────────────────────── */

function parentOf(node) {
  if (node.parentNode && node.parentNode.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return node.parentNode
  const root = node.getRootNode && node.getRootNode()
  return root && root.host ? root.host : node.parentNode
}

/**
 * Origin of the node: the element that rendered it (or one of its ancestors).
 * @param {Node} node
 * @returns {Origin|null}
 */
export function originOf(node) {
  for (let current = node; current; current = parentOf(current)) {
    const origin = origins.get(current)
    if (origin) return origin
  }
  return null
}

/** Origin of the node itself (not of its ancestors) */
export function ownOriginOf(node) {
  return origins.get(node) || null
}

function originFor(renderer, parent, extra = {}, { withRequest = true } = {}) {
  const origin = {
    src: renderer.getAttribute(SRC_ATTRIBUTE),
    tag: renderer.tagName.toLowerCase(),
    is: renderer.getAttribute('is'),
    id: renderer.id || null,
    parent,
    ...extra
  }
  if (withRequest && currentRequest && !origin.request) origin.request = currentRequest
  return origin
}

function setOrigin(node, origin) {
  if (!origins.has(node)) origins.set(node, origin)
}

/* ──────────────────────────────────────────────────────────────── */
/* TEMPLATE CONTENT                                                 */
/* ──────────────────────────────────────────────────────────────── */

function patchTemplates() {
  const content = Object.getOwnPropertyDescriptor(HTMLTemplateElement.prototype, 'content')
  Object.defineProperty(HTMLTemplateElement.prototype, 'content', {
    ...content,
    get() {
      const fragment = content.get.call(this)
      if (fragment) contentOwners.set(fragment, this)
      return fragment
    }
  })

  const cloneNode = Node.prototype.cloneNode
  Node.prototype.cloneNode = function (deep) {
    const clone = cloneNode.call(this, deep)
    if (this.nodeType === Node.DOCUMENT_FRAGMENT_NODE && contentOwners.has(this)) {
      tagClone(clone, contentOwners.get(this))
    }
    return clone
  }

  const importNode = Document.prototype.importNode
  Document.prototype.importNode = function (node, deep) {
    const clone = importNode.call(this, node, deep)
    if (node && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && contentOwners.has(node)) {
      tagClone(clone, contentOwners.get(node))
    }
    return clone
  }

  // mapToTemplate() and releaseTemplate() dispatch it (it doesn't bubble, capture still sees it)
  document.addEventListener('ehtml:template-triggered', (event) => {
    if (event.target instanceof HTMLTemplateElement) {
      triggeredStates.set(event.target, event.detail && event.detail.state)
      triggers.set(event.target, currentTrigger)
    }
  }, true)
}

function tagClone(fragment, template) {
  // Templates created by EHTML to parse fetched html have no source: MutationObserver links those
  if (!template.hasAttribute(SRC_ATTRIBUTE)) return
  const count = (clonesInTask.get(template) || 0) + 1
  clonesInTask.set(template, count)
  if (!clonesResetQueued) {
    clonesResetQueued = true
    queueMicrotask(() => {
      clonesInTask = new WeakMap()
      clonesResetQueued = false
    })
  }
  const extra = {}
  const type = template.getAttribute('is')
  if (type === 'e-for-each') extra.index = count
  if (triggeredStates.has(template)) extra.state = triggeredStates.get(template)
  if (triggers.get(template)) extra.trigger = triggers.get(template)
  // e-wrapper clones its own content when the template it wraps is loaded: the content doesn't
  // come with that template (the request), it's placed into its slot
  const isWrapper = type === 'e-wrapper'
  if (isWrapper) {
    extra.placed = {
      where: template.getAttribute('data-where-to-place'),
      how: template.getAttribute('data-how-to-place') || 'instead',
      into: currentRequest ? currentRequest.url.split('?')[0] : template.getAttribute('data-src')
    }
  }
  const origin = originFor(template, originOf(template), extra, { withRequest: !isWrapper })
  for (const child of fragment.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) setOrigin(child, origin)
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* MUTATIONS                                                        */
/* ──────────────────────────────────────────────────────────────── */

function isRenderer(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE || !node.hasAttribute(SRC_ATTRIBUTE)) return false
  if (node.tagName === 'TEMPLATE' || EHTML_RENDERERS.has(node.tagName)) return true
  // Custom elements (e-sidebar, e-toast...) and customized built-ins (dialog is="e-dialog"...),
  // not CSS-only tags with a dash
  const name = node.getAttribute('is') || node.tagName.toLowerCase()
  return Boolean(window.customElements && customElements.get(name))
}

function contains(nodes, node) {
  for (const added of nodes) {
    if (added === node || (added.contains && added.contains(node))) return true
  }
  return false
}

function rendererOf(record) {
  for (const node of record.removedNodes) {
    if (isRenderer(node)) return { renderer: node }
  }
  if (isRenderer(record.nextSibling)) return { renderer: record.nextSibling }
  if (isRenderer(record.target)) return { renderer: record.target }
  // An element that was replaced by a wrapper and moved inside of it (input is="e-date")
  for (const node of record.removedNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute(SRC_ATTRIBUTE) && contains(record.addedNodes, node)) {
      return { renderer: node, wraps: true }
    }
  }
  return null
}

function track(records) {
  for (const record of records) {
    for (const node of record.removedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) removedFrom.set(node, record.target)
    }
  }
  for (const record of records) {
    if (record.addedNodes.length === 0) continue
    const found = rendererOf(record)
    if (!found) continue
    const { renderer, wraps } = found
    // Renderer is already removed from the page, but it could be rendered itself
    // (then it's in `origins`), or its old parent knows where it came from
    const oldParent = renderer === record.target
      ? parentOf(renderer) || removedFrom.get(renderer)
      : record.target
    const parent = origins.get(renderer) || originOf(oldParent)
    const origin = originFor(renderer, parent, wraps ? { wraps: true } : {})
    for (const node of record.addedNodes) {
      // Unwrapped children of e-html, e-json... are moved to the parent: keep what they had
      if (node !== renderer) setOrigin(node, origin)
    }
  }
}

function observe(root) {
  observer.observe(root, { childList: true, subtree: true })
}

function patchShadowRoots() {
  const attachShadow = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (init) {
    const root = attachShadow.call(this, init)
    if (init && init.mode === 'open') observe(root)
    return root
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* SCRIPTS AND COMPONENTS                                           */
/* ──────────────────────────────────────────────────────────────── */

function patchCreation() {
  const createElement = Document.prototype.createElement
  Document.prototype.createElement = function (...args) {
    const element = createElement.apply(this, args)
    creations.set(element, new Error())
    return element
  }
  const createElementNS = Document.prototype.createElementNS
  Document.prototype.createElementNS = function (...args) {
    const element = createElementNS.apply(this, args)
    creations.set(element, new Error())
    return element
  }
  for (const Proto of [Element.prototype, ShadowRoot.prototype]) {
    const innerHTML = Object.getOwnPropertyDescriptor(Proto, 'innerHTML')
    if (!innerHTML) continue
    Object.defineProperty(Proto, 'innerHTML', {
      ...innerHTML,
      set(value) {
        innerHTML.set.call(this, value)
        const error = new Error()
        for (const child of this.children) {
          if (!creations.has(child)) creations.set(child, error)
        }
      }
    })
  }
  const define = CustomElementRegistry.prototype.define
  CustomElementRegistry.prototype.define = function (name, ...rest) {
    if (!definitions.has(name)) definitions.set(name, new Error())
    return define.call(this, name, ...rest)
  }
}

// "at fn (https://127.0.0.1:4200/js/e-ui/e-date.js?v=1:462:21)" → { url, line, column, fn }
function framesOf(error) {
  const frames = []
  for (const line of String(error.stack || '').split('\n')) {
    const match = /(?:at\s+(.*?)\s+\(|at\s+|@)?(https?:\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/.exec(line.trim())
    if (!match) continue
    const url = new URL(match[2])
    if (url.origin !== window.location.origin) continue
    frames.push({ fn: match[1] || null, url: url.pathname, line: Number(match[3]), column: Number(match[4]) })
  }
  return frames
}

// Frames of e-dev itself and of EHTML (it renders what's written in html) are skipped
const SKIPPED_SCRIPTS = /^\/js\/(e-dev|ehtml)\//

function firstFrame(error) {
  if (!error) return null
  return framesOf(error).find(frame => !SKIPPED_SCRIPTS.test(frame.url)) || null
}

/** Line of JS that created the element (createElement / innerHTML), if it's not EHTML */
export function creatorOf(element) {
  return firstFrame(creations.get(element))
}

/** Where the custom element (tag or is="") is defined */
export function definitionOf(name) {
  return firstFrame(definitions.get(name))
}

/* ──────────────────────────────────────────────────────────────── */
/* REQUESTS                                                         */
/* ──────────────────────────────────────────────────────────────── */

const MAX_RESPONSE = 20000

function patchRequests() {
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const absolute = new URL(url, window.location.href)
    this.eDevRequest = { method: String(method).toUpperCase(), url: absolute.pathname + absolute.search, initiator: initiatorNow() }
    return open.call(this, method, url, ...rest)
  }
  // EHTML sets onreadystatechange (ajax.js): nodes inserted while the response is handled,
  // and by actions it runs then (data-actions-on-response...), are linked to the request
  const handler = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'onreadystatechange')
  Object.defineProperty(XMLHttpRequest.prototype, 'onreadystatechange', {
    ...handler,
    set(fn) {
      if (typeof fn !== 'function') {
        handler.set.call(this, fn)
        return
      }
      const xhr = this
      handler.set.call(this, function (...args) {
        if (xhr.readyState !== XMLHttpRequest.DONE || !xhr.eDevRequest) return fn.apply(this, args)
        const request = { ...xhr.eDevRequest, status: xhr.status, response: responseText(xhr) }
        requests.push(request)
        if (requests.length > 100) requests.shift()
        currentRequest = request
        try {
          return fn.apply(this, args)
        } finally {
          // Actions of the response run in microtasks queued by the handler, before this one
          queueMicrotask(() => {
            track(observer.takeRecords())
            currentRequest = null
          })
        }
      })
    }
  })
}

function responseText(xhr) {
  try {
    if (xhr.responseType && xhr.responseType !== 'text' && xhr.responseType !== 'json') return undefined
    const text = typeof xhr.response === 'string' ? xhr.response : JSON.stringify(xhr.response)
    return text && text.length > MAX_RESPONSE ? text.slice(0, MAX_RESPONSE) + '…' : text
  } catch {
    return undefined
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* ACTIONS AND TRIGGERS                                             */
/* ──────────────────────────────────────────────────────────────── */

/** Who is doing something right now */
function initiatorNow() {
  if (currentAction && currentAction.node instanceof Element) {
    return { node: currentAction.node, how: 'action', code: currentAction.code }
  }
  if (currentActivating instanceof Element) return { node: currentActivating, how: 'activation' }
  const event = window.event
  if (event && event.target instanceof Element && !event.type.startsWith('ehtml:')) {
    return { node: event.target, how: event.type }
  }
  return null
}

const ACTION_BODY = /with\s*\(state\)\s*\{([\s\S]*)\}\s*$/

// EHTML runs actions (data-actions-on-response...) as new Function('state', 'with (state) { ... }'),
// applied to the element: wrapping them tells whose action is running
function patchActions() {
  const NativeFunction = window.Function
  const wrap = (fn, args) => {
    const match = ACTION_BODY.exec(String(args[args.length - 1] || ''))
    if (!match) return fn
    const code = match[1].trim()
    return function (...callArgs) {
      const previous = currentAction
      currentAction = { node: this, code }
      try {
        return fn.apply(this, callArgs)
      } finally {
        currentAction = previous
      }
    }
  }
  window.Function = new Proxy(NativeFunction, {
    construct(target, args) {
      return wrap(Reflect.construct(target, args), args)
    },
    apply(target, thisArg, args) {
      return wrap(Reflect.apply(target, thisArg, args), args)
    }
  })

  // Activation of EHTML elements (e-json, e-html... make their requests then)
  const dispatchEvent = EventTarget.prototype.dispatchEvent
  EventTarget.prototype.dispatchEvent = function (event) {
    if (!event || event.type !== 'ehtml:activated') return dispatchEvent.call(this, event)
    const previous = currentActivating
    currentActivating = this
    try {
      return dispatchEvent.call(this, event)
    } finally {
      currentActivating = previous
    }
  }

  // mapToTemplate() and releaseTemplate() are globals, defined by EHTML after e-dev starts
  for (const name of ['mapToTemplate', 'releaseTemplate']) {
    let value = window[name]
    const wrapTrigger = (fn) => {
      if (typeof fn !== 'function' || fn.eDevWrapped) return fn
      const wrapped = function (target, ...rest) {
        const previous = currentTrigger
        currentTrigger = { action: name, target, via: initiatorNow(), request: currentRequest }
        try {
          return fn.call(this, target, ...rest)
        } finally {
          currentTrigger = previous
        }
      }
      wrapped.eDevWrapped = true
      return wrapped
    }
    value = wrapTrigger(value)
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (fn) => { value = wrapTrigger(fn) }
    })
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* MARKDOWN                                                         */
/* ──────────────────────────────────────────────────────────────── */

export const MARKDOWN_MARKER = /^ e-src:(\S+):(\d+) $/

// Puts <!-- e-src:<url>:<line> --> before each top-level block of the markdown,
// so rendered elements know their line in the .md file
function markMarkdown(markdown, url) {
  const lines = String(markdown).split('\n')
  const out = []
  let fence = null
  let previousBlank = true
  let inList = false
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null
      out.push(line)
      previousBlank = false
      return
    }
    const isBlank = trimmed === ''
    const isIndented = /^( {4}|\t)/.test(line)
    const isListItem = /^([*+-]|\d+[.)])\s/.test(trimmed)
    if (!isBlank && previousBlank && !isIndented && !(isListItem && inList)) {
      out.push(`<!-- e-src:${url}:${index + 1} -->`, '')
      inList = isListItem
    }
    const fenceMatch = /^(```|~~~)/.exec(trimmed)
    if (fenceMatch && !isIndented) fence = fenceMatch[1]
    out.push(line)
    previousBlank = isBlank
  })
  return out.join('\n')
}

function patchMarkdown() {
  if (!window.customElements) return
  customElements.whenDefined('e-markdown').then(() => {
    const EMarkdown = customElements.get('e-markdown')
    const renderMarkdown = EMarkdown.prototype.renderMarkdown
    if (typeof renderMarkdown !== 'function') return
    EMarkdown.prototype.renderMarkdown = function (markdown, ...rest) {
      // Markdown from the network: the request is known. From data-internal-state: no file
      const url = currentRequest ? currentRequest.url.split('?')[0] : null
      return renderMarkdown.call(this, url ? markMarkdown(markdown, url) : markdown, ...rest)
    }
  })
}

/* ──────────────────────────────────────────────────────────────── */
/* START                                                            */
/* ──────────────────────────────────────────────────────────────── */

let started = false

export function startTracker() {
  if (started) return
  started = true
  observer = new MutationObserver(track)
  observe(document.documentElement)
  patchTemplates()
  patchShadowRoots()
  patchCreation()
  patchRequests()
  patchActions()
  patchMarkdown()
  window.__eDevOriginOf = originOf
}
