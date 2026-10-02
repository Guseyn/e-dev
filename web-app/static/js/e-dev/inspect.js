// Element → code editor.
//   Alt + hover          outline of the element under the pointer and the chain of what rendered it
//   Alt + ↑ / ↓          parent / back to the child (↓ goes to the first child when there is no way back)
//   Alt + ← / →          previous / next sibling
//   Alt + click          opens the element in the code editor (Sublime by default)
//   Alt + Enter          the same for the selected element (for disabled controls, that get no clicks)
//   Alt + Shift + click  pins the element in a panel (Alt + Shift + Enter for the selected one):
//                        what rendered it, the script that created it, its state, the request it
//                        came from, styles that apply to it, its component, ancestors in the file
//                        and everything inside of it
//   Esc                  closes the panel
//
// Overlays are popovers, so they are drawn in the top layer, above modal dialogs of the page.

import { ui, mountUI, isUIEvent, h, openInEditor } from '#e-dev/ui.js'
import { originOf, ownOriginOf, creatorOf, definitionOf, MARKDOWN_MARKER } from '#e-dev/tracker.js'
import { interceptLinks } from '#e-dev/links.js'
import { stylesOf } from '#e-dev/styles-of.js'

const SRC_ATTRIBUTE = 'data-e-src'
// The html folder of the static folder, whichever folder the app serves ("web-app/static/html/" by default)
const HTML_PREFIX = /^(?:.*\/)?static\/html\//
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

const chains = new Map() // src → Promise of the source chain from the server

let outline = null
let chip = null
let panel = null
let selected = null // outlined element (under the pointer, or reached with arrows)
let pointed = null // deepest element under the pointer
let way = [] // elements selected before going up with Alt + ↑, to go back down with Alt + ↓
let iframesStyle = null

export default async function startInspector() {
  interceptLinks()
  await mountUI()
  outline = h('div', { 'data-ed': 'outline', popover: 'manual' })
  chip = h('div', { 'data-ed': 'chip', popover: 'manual' })
  ui.layer.append(outline, chip)

  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  // Alt + click on links would download them, Alt + mousedown would start a selection
  document.addEventListener('mousedown', swallowAltEvents, true)
  document.addEventListener('auxclick', swallowAltEvents, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', (event) => { if (event.key === 'Alt') release() }, true)
  window.addEventListener('blur', release)
  document.addEventListener('scroll', () => { if (selected) place(selected) }, true)
  window.addEventListener('resize', () => { if (selected) place(selected) })

  window.eDev = { sourceOf, chainOf, open: openInEditor, pin: pinElement }
  console.info('[e-dev] Alt + click an element to open it in the code editor, Alt + Shift + click to pin it. Alt + arrows move to the parent, children and siblings.')
}

/* ──────────────────────────────────────────────────────────────── */
/* ELEMENTS                                                         */
/* ──────────────────────────────────────────────────────────────── */

function parentOf(element) {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root && root.host ? root.host : null
}

function isOwn(element) {
  return !element || element === ui.host || element.tagName === 'E-DEV-UI'
}

/** Deepest element of the event (inside of open shadow roots too), not part of e-dev UI */
function targetOf(event) {
  if (isUIEvent(event)) return null
  const target = event.composedPath().find(node => node.nodeType === Node.ELEMENT_NODE)
  if (!target || isOwn(target) || target === document.documentElement) return null
  return target
}

function childrenOf(element) {
  const children = [...element.children]
  if (element.shadowRoot) children.push(...element.shadowRoot.children)
  return children.filter(child => !isOwn(child))
}

function describe(element) {
  return {
    tag: element.tagName.toLowerCase(),
    is: element.getAttribute('is'),
    id: element.id || null,
    title: element.getAttribute('data-title')
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* E-UI: GENERATED PARTS THAT STAND FOR ELEMENTS WRITTEN IN HTML    */
/* ──────────────────────────────────────────────────────────────── */

// Tabs of <e-tabs>, found like e-tab.js does: <e-tab> descendants (also rendered by e-if, e-for-each...)
// whose closest <e-tabs> is this one
function tabsOf(tabs) {
  return [...tabs.querySelectorAll('e-tab')].filter(tab => tab.closest('e-tabs') === tabs)
}

// The <nav> that e-tabs generates: prepended to <e-tabs>, one button per tab
function tabsNavOf(tabs) {
  const nav = tabs.firstElementChild
  return nav && nav.tagName === 'NAV' && !nav.hasAttribute(SRC_ATTRIBUTE) ? nav : null
}

/** <e-tab> that a button of the generated nav of <e-tabs> selects */
function tabOfButton(element) {
  const button = element.closest && element.closest('button')
  const nav = button && button.parentElement
  const tabs = nav && nav.parentElement
  if (!tabs || tabs.tagName !== 'E-TABS' || tabsNavOf(tabs) !== nav) return null
  return tabsOf(tabs)[[...nav.querySelectorAll(':scope > button')].indexOf(button)] || null
}

/** Button of the generated nav of <e-tabs> that selects the <e-tab> */
function buttonOfTab(tab) {
  const tabs = tab.closest('e-tabs')
  const nav = tabs && tabsNavOf(tabs)
  if (!nav) return null
  return nav.querySelectorAll(':scope > button')[tabsOf(tabs).indexOf(tab)] || null
}

/** Element written in html that a generated element stands for (it opens it in the editor) */
function standInOf(element) {
  return tabOfButton(element)
}

/** <!-- e-src:<url>:<line> --> before the node (or its ancestor) in markdown output */
function markdownMarkerBefore(node) {
  for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
    if (sibling.nodeType === Node.COMMENT_NODE) {
      const match = MARKDOWN_MARKER.exec(sibling.data)
      if (match) return { url: match[1], line: Number(match[2]) }
    } else if (sibling.nodeType === Node.ELEMENT_NODE && sibling.hasAttribute(SRC_ATTRIBUTE)) {
      return null
    }
  }
  return null
}

/**
 * The closest element (itself or an ancestor) that knows where it came from:
 *  - 'src': it's written in html (data-e-src)
 *  - 'markdown': it's rendered from a block of a .md file
 *  - 'origin': it's generated by an element that is written in html (e-ui templates, e-html...)
 * Generated parts of e-ui components that stand for an element (a tab button → its <e-tab>) are owned by it.
 */
function ownerOf(element) {
  const standIn = standInOf(element)
  if (standIn && standIn.hasAttribute(SRC_ATTRIBUTE)) return { kind: 'src', node: standIn, standIn: true }
  for (let node = element; node && node !== document.documentElement; node = parentOf(node)) {
    if (node.hasAttribute(SRC_ATTRIBUTE)) return { kind: 'src', node }
    const marker = markdownMarkerBefore(node)
    if (marker) return { kind: 'markdown', node, ...marker }
    const origin = ownOriginOf(node)
    if (origin && origin.src) return { kind: 'origin', node, origin }
  }
  return null
}

function sourceOf(element) {
  const owner = ownerOf(element)
  if (!owner) return null
  if (owner.kind === 'src') return owner.node.getAttribute(SRC_ATTRIBUTE)
  if (owner.kind === 'markdown') return `${owner.url}:${owner.line}:1`
  return owner.origin.src
}

/* ──────────────────────────────────────────────────────────────── */
/* CHAIN                                                            */
/* ──────────────────────────────────────────────────────────────── */

function fetchSourceChain(src) {
  if (!chains.has(src)) {
    const promise = fetch(`/e-dev/source-chain?src=${encodeURIComponent(src)}`)
      .then(response => response.ok ? response.json() : { chain: null })
      .catch(() => ({ chain: null }))
    chains.set(src, promise)
  }
  return chains.get(src)
}

function isRendererStep(step) {
  return step.tag === 'template' || step.tag.includes('-')
}

function originSteps(origin) {
  const steps = []
  for (let current = origin; current; current = current.parent) {
    if (!current.src) continue
    steps.unshift({
      src: current.src,
      tag: current.tag,
      is: current.is,
      id: current.id,
      index: current.index,
      state: current.state,
      // The request is shown on the element that made it, not on what it rendered then
      request: current.parent && current.parent.request === current.request ? undefined : current.request,
      wraps: current.wraps,
      trigger: current.trigger,
      placed: current.placed,
      links: []
    })
  }
  return steps
}

/** Line of JS that created the element, or its closest generated ancestor (up to the owner) */
function creatorBelow(element, owner) {
  for (let node = element; node; node = parentOf(node)) {
    // What is written in html is not created by script
    if (node === owner.node && owner.kind === 'src') break
    if (owner.standIn && node.hasAttribute(SRC_ATTRIBUTE)) break
    const frame = creatorOf(node)
    if (frame) return { ...frame, src: `${frame.url}:${frame.line}:${frame.column}` }
    if (node === owner.node) break
  }
  return null
}

/**
 * What rendered the element, outermost first:
 *  - elements that rendered its part of the page at runtime (templates, e-html, e-ui components...),
 *    with the e-for-each index, the state of mapToTemplate() and the request of the response,
 *  - templates it's written in within its own file (static),
 *  - the element itself. Elements created by scripts (no data-e-src) come after the closest
 *    element that knows where it came from, and open it in the editor.
 * `ancestors` has all ancestors in its file, `creator` is the line of JS that created it.
 *
 * @param {Element} element
 */
async function chainOf(element) {
  const owner = ownerOf(element)
  if (!owner) return null
  let steps
  let ancestors = []
  let outdated = false
  let src
  if (owner.kind === 'src') {
    src = owner.node.getAttribute(SRC_ATTRIBUTE)
    const runtime = originSteps(originOf(owner.node))
    const { chain } = await fetchSourceChain(src)
    outdated = !chain
    const inFile = chain || [{ src, ...describe(owner.node), links: [] }]
    // Attributes as they are now (data-title="${...}" is evaluated by EHTML)
    const own = { ...inFile[inFile.length - 1], title: owner.node.getAttribute('data-title') }
    ancestors = inFile.slice(0, -1)
    const staticSteps = ancestors.filter(isRendererStep)
    const known = new Map([...staticSteps, own].map(step => [step.src, step]))
    // Runtime details (index, state, request) go to the static step of the same element
    for (const step of runtime) {
      if (known.has(step.src)) Object.assign(known.get(step.src), pick(step))
    }
    // Elements it's written inside of in its file only moved it (e-dialog), they are in `ancestors`
    const inAncestors = new Set(ancestors.map(step => step.src))
    steps = [...runtime.filter(step => !known.has(step.src) && !inAncestors.has(step.src)), ...staticSteps, own]
  } else if (owner.kind === 'markdown') {
    src = `${owner.url}:${owner.line}:1`
    steps = [...originSteps(originOf(owner.node)), { src, ...describe(owner.node), markdown: true, links: [] }]
  } else {
    src = owner.origin.src
    steps = originSteps(owner.origin)
  }
  // Generated elements (owner 'origin') are not written anywhere: the step of the renderer opens them
  if (owner.node === element && owner.kind !== 'origin') {
    steps[steps.length - 1] = { ...steps[steps.length - 1], self: true }
  } else {
    steps.push({ ...describe(element), src, links: [], self: true, generated: true })
  }
  return {
    element,
    src,
    steps: withTriggers(steps),
    ancestors,
    outdated,
    creator: creatorBelow(element, owner),
    related: relatedOf(element)
  }
}

function pick(step) {
  const details = {}
  for (const key of ['index', 'state', 'request', 'wraps', 'trigger', 'placed']) {
    if (step[key] !== undefined) details[key] = step[key]
  }
  return details
}

/** Elements that generated parts of e-ui components stand for */
function relatedOf(element) {
  const related = []
  const tab = tabOfButton(element)
  if (tab) related.push({ label: 'Selects', element: tab })
  if (element.tagName === 'E-TAB') {
    const button = buttonOfTab(element)
    if (button) related.push({ label: 'Selected by', element: button })
  }
  return related
}

/** Source location of an element that did something (it may be removed from the page by now) */
function srcOfNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null
  return node.hasAttribute(SRC_ATTRIBUTE) ? node.getAttribute(SRC_ATTRIBUTE) : sourceOf(node)
}

function actionLabel(trigger) {
  const target = typeof trigger.target === 'string'
    ? `'${trigger.target}'`
    : trigger.target && trigger.target.nodeType === Node.ELEMENT_NODE ? tagLabel(describe(trigger.target)) : ''
  return `${trigger.action}(${target})`
}

/**
 * Before each template released by mapToTemplate() / releaseTemplate(): who called it
 * (the element whose action it was, with its request, or the element of the event) and the call.
 */
function withTriggers(steps) {
  const result = []
  for (const step of steps) {
    const trigger = step.trigger
    if (trigger) {
      const via = trigger.via
      const viaSrc = via && srcOfNode(via.node)
      if (viaSrc && !result.some(other => other.src === viaSrc && !other.action)) {
        const request = trigger.request && trigger.request.initiator && trigger.request.initiator.node === via.node
          ? trigger.request
          : null
        result.push({
          src: viaSrc,
          ...describe(via.node),
          request,
          event: via.how !== 'action' && via.how !== 'activation' ? via.how : null,
          links: [],
          via: true
        })
      }
      result.push({
        action: actionLabel(trigger),
        code: via && via.code,
        src: viaSrc || step.src,
        tag: trigger.action,
        links: []
      })
      // The request is shown on who made the call
      if (step.request && step.request === trigger.request) {
        result.push({ ...step, request: undefined })
        continue
      }
    }
    result.push(step)
  }
  return result
}

/* ──────────────────────────────────────────────────────────────── */
/* LABELS                                                           */
/* ──────────────────────────────────────────────────────────────── */

function shortFile(src) {
  const [, file, line] = /^(.+):(\d+):(\d+)$/.exec(src) || [null, src, '']
  let name = file
  if (HTML_PREFIX.test(file)) name = file.replace(HTML_PREFIX, '')
  else if (file.startsWith('/')) name = file === '/' ? 'page' : file.slice(1)
  return line ? `${name}:${line}` : name
}

function tagLabel(step) {
  let label = step.tag
  if (step.id) label += `#${step.id}`
  if (step.is) label += ` is="${step.is}"`
  if (step.title) label += ` data-title="${step.title}"`
  return `<${label}>`
}

function stepNote(step) {
  const notes = []
  if (step.index !== undefined) notes.push(`item ${step.index}`)
  if (step.wraps) notes.push('wrapped')
  if (step.event) notes.push(`on ${step.event}`)
  if (step.placed) {
    const where = step.placed.where ? `${step.placed.how === 'inside' ? 'inside' : step.placed.how} ${step.placed.where}` : 'into'
    notes.push(`placed ${where}${step.placed.into ? ` of ${shortFile(step.placed.into)}` : ''}`)
  } else if (step.request) {
    notes.push(`${step.request.method} ${step.request.url}${step.request.status !== undefined ? ` → ${step.request.status}` : ''}`)
  }
  return notes.length ? ` (${notes.join(', ')})` : ''
}

function stepText(step) {
  if (step.action) return step.action
  if (step.generated) return `${tagLabel(step)} created by script`
  return tagLabel(step) + stepNote(step)
}

function stepLabel(step) {
  if (step.action || step.generated) return stepText(step)
  return `${shortFile(step.src)} ${stepText(step)}`
}

/* ──────────────────────────────────────────────────────────────── */
/* OVERLAYS                                                         */
/* ──────────────────────────────────────────────────────────────── */

// Shown again, so it's above the dialog (or popover) that was opened last
function raise(popover) {
  if (popover.matches(':popover-open')) popover.hidePopover()
  popover.showPopover()
}

function place(element) {
  const rect = element.getBoundingClientRect()
  Object.assign(outline.style, {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  })
  if (!chip.matches(':popover-open')) return
  const box = chip.getBoundingClientRect()
  const gap = 6
  let top = rect.top - box.height - gap
  if (top < gap) top = Math.min(rect.bottom + gap, window.innerHeight - box.height - gap)
  const left = Math.min(Math.max(gap, rect.left), window.innerWidth - box.width - gap)
  chip.style.top = `${Math.max(gap, top)}px`
  chip.style.left = `${left}px`
}

/** Outlines the element (without the chip), for rows of the panel */
function outlineOnly(element) {
  if (chip.matches(':popover-open')) chip.hidePopover()
  raise(outline)
  place(element)
}

async function show(element) {
  selected = element
  raise(outline)
  place(element)
  const chain = await chainOf(element)
  if (selected !== element) return
  if (!chain) {
    chip.replaceChildren(h('span', { 'data-ed': 'step', 'data-self': true }, `${tagLabel(describe(element))} has no source location`))
  } else {
    // How the element appeared in the page: one step per line, outermost first
    chip.replaceChildren(
      ...chain.steps.map((step, index) => h('span', {
        'data-ed': 'step',
        'data-self': Boolean(step.self),
        'data-action': Boolean(step.action)
      }, index > 0 ? h('span', { 'data-ed': 'sep' }, '↳') : null, stepLabel(step))),
      ...(chain.creator ? [h('span', { 'data-ed': 'hint' }, `created by ${shortFile(chain.creator.src)}`)] : []),
      h('span', { 'data-ed': 'hint' }, chain.outdated
        ? 'The file has changed since the page was loaded: reload the page'
        : 'click: open in editor · shift + click: pin · arrows: parent, children, siblings')
    )
  }
  raise(chip)
  place(element)
}

function hide() {
  selected = null
  way = []
  if (outline && outline.matches(':popover-open')) outline.hidePopover()
  if (chip && chip.matches(':popover-open')) chip.hidePopover()
}

// Iframes get the pointer while Alt is held, so they can be outlined like other elements
function passThroughIframes(on) {
  if (on && !iframesStyle) {
    iframesStyle = document.createElement('style')
    iframesStyle.textContent = 'iframe { pointer-events: none !important; }'
    document.head.append(iframesStyle)
  } else if (!on && iframesStyle) {
    iframesStyle.remove()
    iframesStyle = null
  }
}

function release() {
  passThroughIframes(false)
  hide()
}

/* ──────────────────────────────────────────────────────────────── */
/* POINTER AND KEYS                                                 */
/* ──────────────────────────────────────────────────────────────── */

function onMouseMove(event) {
  if (isUIEvent(event)) return
  const target = targetOf(event)
  const moved = target !== pointed
  pointed = target
  if (!event.altKey) {
    if (selected) release()
    return
  }
  passThroughIframes(true)
  if (!target) return hide()
  // Keeps what was reached with arrows until the pointer moves to another element
  if (moved || !selected) {
    way = []
    show(target)
  }
}

function onKeyDown(event) {
  if (event.key === 'Escape' && panel) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closePanel()
    return
  }
  if (event.key === 'Alt') {
    passThroughIframes(true)
    if (pointed && !selected) show(pointed)
    return
  }
  if (!event.altKey || !selected) return
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.shiftKey) pinElement(selected)
    else openSource(selected)
    return
  }
  if (!ARROWS.includes(event.key)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  let next = null
  if (event.key === 'ArrowUp') {
    next = parentOf(selected)
    if (next === document.documentElement) next = null
    if (next) way.push(selected)
  } else if (event.key === 'ArrowDown') {
    next = way.pop() || childrenOf(selected)[0] || null
  } else {
    const siblings = parentOf(selected) ? childrenOf(parentOf(selected)) : []
    const index = siblings.indexOf(selected)
    next = siblings[index + (event.key === 'ArrowLeft' ? -1 : 1)] || null
    if (next) way = []
  }
  if (next) {
    show(next)
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

function swallowAltEvents(event) {
  if (!event.altKey || !targetOf(event)) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

function openSource(element) {
  const src = sourceOf(element)
  if (src) openInEditor(src)
}

async function onClick(event) {
  if (!event.altKey) return
  const target = targetOf(event)
  if (!target) return
  event.preventDefault()
  event.stopImmediatePropagation()
  // What was reached with arrows, or what is under the pointer
  const element = selected || target
  if (event.shiftKey) pinElement(element)
  else openSource(element)
}

/* ──────────────────────────────────────────────────────────────── */
/* PANEL                                                            */
/* ──────────────────────────────────────────────────────────────── */

function rowButton({ label, where, title, self = false, action = false, onclick, element }) {
  return h('button', {
    type: 'button',
    'data-ed': 'row',
    'data-self': self,
    'data-action': action,
    title,
    onclick,
    onmouseenter: element ? () => { if (element.isConnected) outlineOnly(element) } : null,
    onmouseleave: element ? () => hide() : null
  },
  h('code', {}, label),
  where ? h('span', { 'data-ed': 'where' }, where) : null)
}

function linkRows(links) {
  return (links || []).map(link => rowButton({
    label: `↳ ${link.attribute}="${link.url}"`,
    where: shortFile(link.src),
    title: `Open ${link.src}`,
    onclick: () => openInEditor(link.src)
  }))
}

function stepRow(step, element) {
  return h('li', {},
    rowButton({
      label: stepText(step),
      where: shortFile(step.src),
      title: step.code ? `${step.code}\n\nOpen ${step.src}` : `Open ${step.src}`,
      self: Boolean(step.self),
      action: Boolean(step.action),
      element: step.self ? element : null,
      onclick: () => openInEditor(step.src)
    }),
    linkRows(step.links)
  )
}

/** Row of the tree of elements inside: opens in the editor, pins, outlines on hover */
function treeRow(element) {
  const own = element.getAttribute(SRC_ATTRIBUTE)
  const src = own || sourceOf(element)
  return h('div', { 'data-ed': 'tree-row' },
    rowButton({
      label: tagLabel(describe(element)) + textPreview(element),
      where: own ? shortFile(own) : 'generated',
      title: src ? `Open ${src}` : 'No source location',
      element,
      onclick: (event) => {
        event.preventDefault()
        if (src) openInEditor(src)
      }
    }),
    pinButton(element, 'Pin this element', '⌖')
  )
}

function pinButton(element, title, text) {
  return h('button', {
    type: 'button',
    'data-ed': 'pin',
    title,
    onclick: (event) => {
      event.preventDefault()
      pinElement(element)
    }
  }, text)
}

function textPreview(element) {
  if (element.children.length) return ''
  const text = (element.textContent || '').trim().replace(/\s+/g, ' ')
  return text ? ` ${text.length > 30 ? text.slice(0, 30) + '…' : text}` : ''
}

/** Collapsible tree of the element's children; deeper levels are built when they are opened */
function tree(element, { open = false } = {}) {
  const children = childrenOf(element)
  if (!children.length) return h('li', { 'data-ed': 'leaf' }, treeRow(element))
  const details = h('details', { open }, h('summary', {}, treeRow(element)))
  let built = false
  const build = () => {
    if (built) return
    built = true
    details.append(h('ol', {}, children.map(child => tree(child))))
  }
  details.addEventListener('toggle', () => { if (details.open) build() })
  if (open) build()
  return h('li', {}, details)
}

/** JSON of a value for the panel: limited depth and length, DOM nodes as tags */
function preview(value, maxLength = 4000) {
  const seen = new WeakSet()
  const walk = (current, depth) => {
    if (current === null || typeof current !== 'object') {
      if (typeof current === 'string' && current.length > 300) return current.slice(0, 300) + '…'
      if (typeof current === 'function') return `ƒ ${current.name || 'anonymous'}()`
      return current
    }
    if (current instanceof Node) return current.nodeType === Node.ELEMENT_NODE ? tagLabel(describe(current)) : `#${current.nodeName}`
    if (seen.has(current)) return '[circular]'
    seen.add(current)
    if (depth > 4) return Array.isArray(current) ? `[… ${current.length}]` : '{…}'
    if (Array.isArray(current)) {
      const items = current.slice(0, 20).map(item => walk(item, depth + 1))
      if (current.length > 20) items.push(`… ${current.length - 20} more`)
      return items
    }
    const result = {}
    for (const key of Object.keys(current).slice(0, 50)) result[key] = walk(current[key], depth + 1)
    return result
  }
  let text
  try {
    text = JSON.stringify(walk(value, 0), null, 2)
  } catch {
    text = String(value)
  }
  if (text === undefined) text = String(value)
  return text.length > maxLength ? text.slice(0, maxLength) + '\n…' : text
}

/** EHTML scoped state of the element: the closest one of it and its ancestors */
function scopedStateOf(element) {
  const states = window.__EHTML_SCOPED_STATE__
  if (!states) return null
  for (let node = element; node; node = parentOf(node)) {
    if (states.has(node)) return states.get(node)
  }
  return null
}

function stateSection(element, chain) {
  const blocks = []
  const scoped = scopedStateOf(element)
  if (scoped && Object.keys(scoped).length) blocks.push(['EHTML state', scoped])
  const triggered = chain && [...chain.steps].reverse().find(step => step.state !== undefined)
  if (triggered) blocks.push([`State of ${tagLabel(triggered)} when it was released`, triggered.state])
  if (element.internalState !== undefined) blocks.push(['internalState', element.internalState])
  if (!blocks.length) return null
  return [
    h('h6', {}, 'State'),
    blocks.map(([title, value]) => h('details', { 'data-ed': 'data' }, h('summary', {}, title), h('pre', {}, preview(value))))
  ]
}

function requestSection(chain) {
  const step = chain && [...chain.steps].reverse().find(current => current.request)
  if (!step) return null
  const { method, url, status, response } = step.request
  return [
    h('h6', {}, 'Request'),
    h('details', { 'data-ed': 'data' },
      h('summary', {}, `${method} ${url} → ${status}`),
      response !== undefined ? h('pre', {}, prettyResponse(response)) : null)
  ]
}

function prettyResponse(response) {
  try {
    return preview(JSON.parse(response), 8000)
  } catch {
    return response.length > 8000 ? response.slice(0, 8000) + '\n…' : response
  }
}

function componentSection(element) {
  const names = [element.getAttribute('is'), element.tagName.toLowerCase()].filter(name => name && name.includes('-'))
  const rows = []
  for (const name of names) {
    const frame = definitionOf(name)
    if (frame) {
      const src = `${frame.url}:${frame.line}:${frame.column}`
      rows.push(h('li', {}, rowButton({ label: `${name} is defined in`, where: shortFile(src), title: `Open ${src}`, onclick: () => openInEditor(src) })))
    }
  }
  return rows.length ? [h('h6', {}, 'Component'), h('ol', {}, rows)] : null
}

function stylesSection(element) {
  const list = h('ol', {}, h('li', { 'data-ed': 'muted' }, 'Loading…'))
  stylesOf(element).then((rules) => {
    if (!rules.length) {
      list.replaceChildren(h('li', { 'data-ed': 'muted' }, 'No rules from the page stylesheets'))
      return
    }
    list.replaceChildren(...rules.map(rule => h('li', {}, rowButton({
      label: rule.selector,
      where: shortFile(rule.src),
      title: `Open ${rule.src}`,
      onclick: () => openInEditor(rule.src)
    }))))
  })
  return [h('h6', {}, 'Styles'), list]
}

async function pinElement(element) {
  hide()
  const chain = await chainOf(element)
  openPanel(element, chain)
}

function openPanel(element, chain) {
  closePanel()
  const parent = parentOf(element)
  const children = childrenOf(element)
  panel = h('dialog', { 'data-ed': 'panel' },
    h('div', { 'data-ed': 'panel-head' },
      h('strong', {}, tagLabel(describe(element))),
      h('span', { 'data-ed': 'where' }, chain ? shortFile(chain.src) : 'no source location'),
      parent && parent !== document.documentElement ? pinButton(parent, 'Pin the parent', '↑') : null,
      h('button', { type: 'button', 'data-ed': 'close', 'aria-label': 'Close', onclick: closePanel }, '×')),
    chain && chain.outdated ? h('span', {}, 'The file has changed since the page was loaded: reload the page.') : null,
    chain ? [h('h6', {}, 'Rendered by'), h('ol', {}, chain.steps.map(step => stepRow(step, element)))] : null,
    chain && chain.creator
      ? [h('h6', {}, 'Created by script'), h('ol', {}, h('li', {}, rowButton({
        label: chain.creator.fn ? `${chain.creator.fn}()` : 'script',
        where: shortFile(chain.creator.src),
        title: `Open ${chain.creator.src}`,
        onclick: () => openInEditor(chain.creator.src)
      })))]
      : null,
    chain && chain.related.length
      ? [h('h6', {}, 'Related'), h('ol', {}, chain.related.map(({ label, element: other }) => h('li', {}, h('div', { 'data-ed': 'tree-row' },
        rowButton({
          label: `${label} ${tagLabel(describe(other))}${textPreview(other)}`,
          where: sourceOf(other) ? shortFile(sourceOf(other)) : '',
          element: other,
          onclick: () => { const src = sourceOf(other); if (src) openInEditor(src) }
        }),
        pinButton(other, 'Pin this element', '⌖')))))]
      : null,
    componentSection(element),
    stateSection(element, chain),
    requestSection(chain),
    stylesSection(element),
    chain && chain.ancestors.length
      ? [h('h6', {}, 'Ancestors in the file'), h('ol', {}, chain.ancestors.map(step => stepRow(step)))]
      : null,
    children.length
      ? [h('h6', {}, `Inside (${children.length})`), h('ol', { 'data-ed': 'tree' }, children.map(child => tree(child, { open: children.length === 1 })))]
      : null
  )
  panel.addEventListener('close', () => {
    if (panel && !panel.open) closePanel()
  })
  ui.layer.append(panel)
  // A modal dialog of the page makes everything else inert: the panel has to be modal too to be clickable.
  // Otherwise it's a popover, so the page stays usable.
  if (pageHasModalDialog()) {
    panel.showModal()
  } else {
    panel.setAttribute('popover', 'manual')
    panel.showPopover()
  }
}

function pageHasModalDialog() {
  try {
    return [...document.querySelectorAll('dialog')].some(dialog => dialog.matches(':modal'))
  } catch {
    return Boolean(document.querySelector('dialog[open]'))
  }
}

function closePanel() {
  const current = panel
  panel = null
  if (!current) return
  if (current.open && !current.hasAttribute('popover')) current.close()
  current.remove()
}
