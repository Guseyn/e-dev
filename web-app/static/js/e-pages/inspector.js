// Inspector: a dialog that walks the page model (not the rendered DOM), so templates,
// e-json and other elements that disappear from the page are reachable too.
// Children open recursively; ← / → (buttons or arrow keys) walk the navigation history.

import { h, clear, truncate } from '#e-pages/dom.js'
import {
  store, findNode, elementChildren, attr, labelOf, textOf, catalogEntryOf, getJSON,
  rootId, rootNode, breadcrumbsOf
} from '#e-pages/store.js'
import { openDialog, editorLink, toast, showError, sectionTitle, iconButton, icon, confirmDialog, tooltip, openInEditor, previewFrame } from '#e-pages/ui.js'
import { api } from '#e-pages/requests.js'
import { rankElements } from '#e-pages/search.js'
import { treeNodes } from '#e-pages/tree.js'
import { openElementForm, attributesOf, notifyImports, field, attributeRow } from '#e-pages/elementForm.js'

const STATE_KEY = () => `e-pages:inspector:${store.page}`

// Attributes that describe behavior and state (shown in their own section)
const BEHAVIOR_ATTRIBUTE = /^(on[a-z]+|data-actions-.+|data-condition-to-display|data-list-to-iterate|data-item-name|data-index-name|data-object-name|data-response-name|data-internal-state|data-bound-to|data-text|data-value|data-inner-html|data-release-on-load|data-reusable|data-socket-name)$/

let dialog = null
let content = null
let history = []
let position = -1
// Tab of the element dialog: info | attributes | css | children
let currentTab = 'info'
const TABS = [['info', 'Info'], ['attributes', 'Attributes'], ['css', 'CSS'], ['children', 'Children']]

/**
 * Opens the inspector for an element id (history continues if already open).
 * With `towards` (id of a clicked element inside it), the forward history is filled
 * with the path to it, so → walks from the top-level element down to what was clicked.
 */
export function openInspector(id, { resetHistory = false, towards = null, focusAdd = false } = {}) {
  if (resetHistory || !dialog) {
    history = []
    position = -1
  }
  navigate(id || rootId())
  if (focusAdd) {
    const found = findNode(id)
    if (found) openAddDialog(found.node)
  }
  if (towards && towards !== id) {
    const chain = breadcrumbsOf(towards).map(n => n.id)
    const start = chain.indexOf(id)
    if (start !== -1) {
      history.push(...chain.slice(start + 1))
      render()
    }
  }
}

/** Reopens the inspector after a page reload, if it was open */
export function restoreInspector() {
  let saved = null
  try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY()) || 'null') } catch { saved = null }
  sessionStorage.removeItem(STATE_KEY())
  if (!saved || !saved.history || saved.history.length === 0) return
  history = saved.history.filter(id => id === 'root' || findNode(id))
  position = Math.min(saved.position, history.length - 1)
  currentTab = saved.tab || 'info'
  if (position >= 0) render()
}

/** Can the element have children added in the inspector */
export function canAddInside(node) {
  // Void elements have no children, raw text elements (script, style...) only have text
  return !(node.type === 'element' && /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr|script|style|title|textarea)$/.test(node.tag))
}

function navigate(id) {
  history = history.slice(0, position + 1)
  if (history[history.length - 1] !== id) history.push(id)
  position = history.length - 1
  render()
}

function go(delta) {
  const next = position + delta
  if (next < 0 || next >= history.length) return
  position = next
  render()
}

/** Keeps the inspector open across the reload that shows a change */
function reloadKeepingInspector(openId) {
  if (openId !== undefined) {
    history = history.slice(0, position + 1)
    if (history[history.length - 1] !== openId) history.push(openId)
    position = history.length - 1
  }
  sessionStorage.setItem(STATE_KEY(), JSON.stringify({ history, position, tab: currentTab }))
  window.location.reload()
}

function ensureDialog() {
  if (dialog) return
  content = h('div', { is: 'e-stack', 'data-gap': 'lg', 'data-ep': 'inspector' })
  dialog = openDialog({
    head: h('div', { 'data-ep': 'inspector-head' }),
    body: content,
    onClose: () => { dialog = null; history = []; position = -1; currentTab = 'info' }
  })
}

// On document, not on the dialog: re-rendering removes the focused button,
// and focus falls back to <body>, outside of the dialog
document.addEventListener('keydown', (event) => {
  if (!dialog || !dialog.open) return
  // Only when the inspector is the top dialog (not while adding an element)
  const dialogs = [...dialog.parentNode.querySelectorAll('dialog[open]')]
  if (dialogs[dialogs.length - 1] !== dialog) return
  const typing = event.composedPath().some(el => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
  if (typing) return
  if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
  if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
})

const row = (props, ...children) => h('div', { is: 'e-row', 'data-gap': 'sm', 'data-keep-flex-direction-row-in-mobile': true, 'data-flex-wrap': 'wrap', ...props }, ...children)
const stack = (props, ...children) => h('div', { is: 'e-stack', 'data-gap': 'sm', ...props }, ...children)
const button = (label, props) => h('button', { type: 'button', 'data-primary': true, 'data-fill': 'outlined', ...props }, label)

/* ──────────────────────────────────────────────────────────────── */
/* RENDER                                                           */
/* ──────────────────────────────────────────────────────────────── */

function render() {
  ensureDialog()
  const id = history[position]
  const found = findNode(id === rootId() && rootNode().type !== 'element' ? 'root' : id)
  const head = dialog.querySelector('[data-ep="inspector-head"]')
  clear(head)
  clear(content)
  if (!found) {
    content.append(h('span', { is: 'e-error' }, `Element ${id} is not in the page anymore.`))
    return
  }
  const node = found.node
  const isRoot = node === rootNode()
  const entry = catalogEntryOf(node)

  head.append(row({ 'data-flex-wrap': null },
    iconButton('arrow_back', 'Back to the previous element (←)', () => go(-1), { disabled: position <= 0, direction: 'to-right' }),
    iconButton('arrow_forward', 'Forward to the next element (→)', () => go(1), { disabled: position >= history.length - 1, direction: 'to-right' }),
    breadcrumbs(id)
  ))

  const isElement = node.type === 'element'
  // Template root (fragment) has no attributes and styles
  const tabs = TABS.filter(([tab]) => isElement || tab === 'info' || tab === 'children')
  if (!tabs.some(([tab]) => tab === currentTab)) currentTab = 'info'
  const panels = {
    info: () => [
      linksSection(node, entry),
      isElement ? textSection(node, entry) : null,
      isElement ? behaviorSection(node) : null,
      isRoot ? null : actionsSection(node, found)
    ],
    attributes: () => [attributesSection(node, entry)],
    css: () => [cssSection(node)],
    children: () => [childrenSection(node)]
  }
  // (Element.append would turn null into "null" text)
  content.append(
    titleSection(node, entry, isRoot),
    row({ 'data-gap': 'xs', role: 'tablist', 'data-ep': 'tabs' },
      tabs.map(([tab, title]) => h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': tab === currentTab ? 'true' : 'false',
        'data-primary': true,
        'data-fill': tab === currentTab ? null : 'outlined',
        onclick: () => { currentTab = tab; render() }
      }, title))),
    stack({ 'data-gap': 'lg', role: 'tabpanel', 'data-ep': 'tab-panel' }, panels[currentTab]().filter(Boolean))
  )
}

function breadcrumbs(currentId) {
  const chain = breadcrumbsOf(currentId === 'root' ? rootId() : currentId)
  const container = row({ 'data-gap': '2xs', 'data-ep': 'crumbs' })
  chain.forEach((node, index) => {
    if (index > 0) container.append(h('span', { is: 'e-muted' }, '›'))
    const nodeId = node.type === 'element' ? node.id : 'root'
    const current = index === chain.length - 1
    container.append(h('a', {
      is: 'e-link',
      href: '#',
      'data-font-weight': current ? 'bold' : null,
      'data-color': current ? null : 'muted',
      onclick: (event) => { event.preventDefault(); navigate(nodeId) }
    }, h('code', {}, node.type === 'element' ? truncate(labelOf(node), 28) : 'template')))
  })
  return container
}

function titleSection(node, entry, isRoot) {
  const rendered = node.type === 'element' ? document.querySelectorAll(`[data-eid="${node.id}"]`).length : 0
  return row({},
    h('span', { 'data-ep': 'item-icon' }, icon(entry && entry.icon ? entry.icon : 'widgets')),
    h('h4', { is: 'e-h' }, h('code', {}, node.type === 'element' ? `<${labelOf(node)}>` : 'Template root')),
    entry ? h('span', { is: 'e-chip', title: entry.description }, `${entry.libraryTitle}: ${entry.name}`) : null,
    entry && entry.invisible ? h('span', { is: 'e-chip', 'data-color': 'danger' }, 'not visible in DOM') : null,
    node.type === 'element' && !isRoot && rendered === 0 && !(entry && entry.invisible)
      ? h('span', { is: 'e-chip', 'data-color': 'danger', title: 'Not rendered right now (inside a template that is not released, or hidden by e-if)' }, 'not rendered now')
      : null,
    rendered > 1 ? h('span', { is: 'e-chip' }, `rendered ${rendered} times`) : null
  )
}

function linksSection(node, entry) {
  const model = store.model
  const line = node.type === 'element' ? model.lines && model.lines[node.id] : 1
  const links = [
    editorLink(`${model.file}${line ? `:${line}` : ''}`, model.file, line)
  ]
  if (entry && entry.source) {
    links.push(editorLink(`component: ${entry.source.split('/').pop()}`, entry.source, null, entry.search))
  }
  for (const source of (node.type === 'element' && model.sources[node.id]) || []) {
    if (source.kind === 'endpoint') {
      links.push(editorLink(`${source.attribute} → ${source.method} ${source.urlPattern} → ${source.file}:${source.line}`, source.file, source.line))
    } else if (source.kind === 'page') {
      links.push(editorLink(`${source.attribute} → ${source.file}`, source.file, 1))
      links.push(h('a', { is: 'e-link', 'data-underlined': true, href: `${source.url.split('?')[0]}?dev=true` }, 'edit that page ↗'))
    } else {
      links.push(h('span', { is: 'e-chip', 'data-color': 'danger', title: 'No endpoint in web-app/routes.js matches this url' }, `${source.attribute}: no endpoint for ${truncate(source.url, 40)}`))
    }
  }
  return row({ 'data-gap': 'md', 'data-ep': 'links' }, links)
}

function attributesSection(node, entry) {
  const rows = stack({ 'data-gap': 'xs' })
  const suggestions = entry ? attributesOf(entry) : Object.values(store.groups).flat()
  const listId = `ep-inspector-attrs-${node.id}`
  const datalist = h('datalist', { id: listId }, [...new Set(suggestions.map(a => a.name))].map(n => h('option', { value: n })))
  const addRow = (name = '', value = null) => {
    const multiline = Boolean(value && (value.includes('\n') || value.length > 60))
    rows.append(attributeRow(name, value, { listId, multiline }))
  }
  // Inline style is edited in the CSS tab
  for (const [name, value] of node.attrs || []) {
    if (name !== 'style') addRow(name, value)
  }

  let tagSelect = null
  if (entry && entry.tagChoices) {
    tagSelect = h('select', {}, entry.tagChoices.map(t => h('option', { value: t, selected: t === node.tag }, t)))
  }

  const save = h('button', {
    type: 'button',
    'data-primary': true,
    onclick: async () => {
      const attributes = [...rows.children].map(r => r.read()).filter(a => a.name)
      const style = attr(node, 'style')
      if (style !== undefined && !attributes.some(a => a.name === 'style')) attributes.push({ name: 'style', value: style })
      save.disabled = true
      const response = await api.updateElement({ id: node.id, attributes, tag: tagSelect ? tagSelect.value : undefined })
      save.disabled = false
      if (response.statusCode === 200) reloadKeepingInspector()
      else showError(response)
    }
  }, 'Save attributes')

  return stack({},
    sectionTitle('Attributes'),
    tagSelect ? field('tag', tagSelect) : null,
    rows,
    datalist,
    row({},
      button('Add attribute', { onclick: () => addRow() }),
      save
    )
  )
}

function textSection(node, entry) {
  if (elementChildren(node).length > 0) return null
  if (entry && entry.content === 'none') return null
  if (['html', 'head', 'body'].includes(node.tag)) return null
  const isCode = node.tag === 'script' || node.tag === 'style'
  const area = h('textarea', { rows: isCode ? 8 : 2 })
  area.value = textOf(node).replace(/^\n/, '')
  const save = button('Save text', {
    onclick: async () => {
      save.disabled = true
      const response = await api.updateElement({ id: node.id, text: area.value })
      save.disabled = false
      if (response.statusCode === 200) reloadKeepingInspector()
      else showError(response)
    }
  })
  return stack({}, sectionTitle(isCode ? 'Code' : 'Text'), h('label', {}, area), h('div', {}, save))
}

function behaviorSection(node) {
  const declared = (node.attrs || []).filter(([name]) => BEHAVIOR_ATTRIBUTE.test(name))
  const element = document.querySelector(`[data-eid="${node.id}"]`)
  const runtime = element ? runtimeStateOf(element) : null
  if (declared.length === 0 && !runtime) return null
  return stack({},
    sectionTitle('Events & state'),
    declared.map(([name, value]) => stack({ 'data-gap': '2xs' },
      h('code', { is: 'e-code' }, name),
      h('pre', { is: 'e-pre' }, value === null ? 'true' : value.replace(/^\n/, ''))
    )),
    runtime ? stack({ 'data-gap': '2xs' },
      h('span', { is: 'e-muted' }, 'State of the rendered element (EHTML scoped state):'),
      h('pre', { is: 'e-pre' }, runtime)
    ) : null,
    element ? h('span', { is: 'e-helper' }, 'Listeners added from JavaScript are not listed (browsers don\'t expose them), only declared ones above.') : null
  )
}

function runtimeStateOf(element) {
  const map = window.__EHTML_SCOPED_STATE__
  let state = null
  let current = element
  while (current && map) {
    const found = map.get(current)
    if (found) { state = found; break }
    current = current.parentNode
  }
  const internal = element.internalState
  if (!state && internal === undefined) return null
  const seen = new WeakSet()
  const json = JSON.stringify({ ...(state || {}), ...(internal !== undefined ? { internalState: internal } : {}) }, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[circular]'
      seen.add(value)
      if (value instanceof Node) return `[${value.nodeName}]`
    }
    if (typeof value === 'function') return '[function]'
    return value
  }, 2)
  return json.length > 3000 ? json.slice(0, 3000) + '\n…' : json
}

// Subtree of the element (collapsible), every element with its actions
function childrenSection(node) {
  const nodes = treeNodes(node, {
    openDepth: 2,
    onOpen: (child) => navigate(child.id),
    actions: (child, { parent, index, siblings }) => [
      iconButton('arrow_upward', 'Move up (before the previous element)', () => move(child, parent, index - 1), { disabled: index === 0 }),
      iconButton('arrow_downward', 'Move down (after the next element)', () => move(child, parent, index + 1), { disabled: index === siblings.length - 1 }),
      iconButton('code', `Open line ${store.model.lines[child.id] || 1} of ${store.model.file} in the code editor`, () => openInEditor(store.model.file, store.model.lines[child.id])),
      canAddInside(child) ? iconButton('add', 'Add elements inside', () => openAddDialog(child)) : null,
      iconButton('/images/bin.svg', 'Delete this element', () => deleteElement(child, parent.type === 'element' ? parent.id : 'root'))
    ]
  })
  const nodeId = node.type === 'element' ? node.id : 'root'
  const previewBox = h('div', { hidden: true })
  const togglePreview = async () => {
    if (!previewBox.hidden) {
      previewBox.hidden = true
      return
    }
    try {
      const { outerHTML } = await getJSON(`/e-pages/element/html?path=${encodeURIComponent(store.page)}&id=${encodeURIComponent(nodeId)}`)
      previewBox.replaceChildren(previewFrame(outerHTML, `Preview of <${labelOf(node)}>`))
      previewBox.hidden = false
    } catch (error) {
      toast(error.message, { error: true })
    }
  }
  const canHaveChildren = canAddInside(node)
  return stack({ 'data-gap': 'md' },
    row({ 'data-gap': 'sm' },
      iconButton('visibility', 'Preview this element with its subtree', togglePreview),
      canHaveChildren ? iconButton('edit_note', 'Edit the subtree (inner html) as HTML', () => editAsHTML(node)) : null,
      canHaveChildren ? h('button', { type: 'button', 'data-primary': true, 'data-ep': 'open-add', onclick: () => openAddDialog(node) }, 'Add element inside…') : null
    ),
    previewBox,
    h('details', { is: 'e-details', open: true, 'data-ep': 'subtree-section' },
      h('summary', {}, `Subtree (${elementChildren(node).length} inside)`),
      h('div', { is: 'e-stack', 'data-gap': '2xs', 'data-ep': 'tree' },
        nodes.length ? nodes : h('span', { is: 'e-muted' }, 'Nothing inside'))
    )
  )
}

// Inner html of the element in a textarea; saved html is parsed into the page model by the backend
async function editAsHTML(node) {
  const nodeId = node.type === 'element' ? node.id : 'root'
  let data
  try {
    data = await getJSON(`/e-pages/element/html?path=${encodeURIComponent(store.page)}&id=${encodeURIComponent(nodeId)}`)
  } catch (error) {
    toast(error.message, { error: true })
    return
  }
  const area = h('textarea', { rows: 20, spellcheck: 'false', 'data-ep': 'html-editor' })
  area.value = data.innerHTML
  const errorBox = h('span', { is: 'e-error', hidden: true })
  const save = h('button', { type: 'button', 'data-primary': true }, 'Save HTML')
  const htmlDialog = openDialog({
    title: `Edit inside <${node.type === 'element' ? labelOf(node) : 'template'}> as HTML`,
    body: [
      h('span', { is: 'e-muted' }, 'The html inside the element. After saving it becomes part of the page model, and the html file is generated from it.'),
      h('label', {}, area),
      errorBox
    ],
    footer: [
      h('button', { type: 'button', 'data-primary': true, 'data-fill': 'outlined', onclick: () => htmlDialog.close() }, 'Cancel'),
      save
    ]
  })
  save.addEventListener('click', async () => {
    save.disabled = true
    const response = await api.setElementHTML({ id: nodeId, html: area.value })
    save.disabled = false
    if (response.statusCode === 200) {
      htmlDialog.close()
      reloadKeepingInspector()
    } else {
      errorBox.hidden = false
      errorBox.textContent = response.body.error
    }
  })
}

// Inline CSS of the element (its style attribute), one declaration per line
function cssSection(node) {
  const area = h('textarea', { rows: 8, placeholder: 'color: var(--e-primary);\npadding: var(--e-spacing-md);' })
  area.value = (attr(node, 'style') || '').split(';').map(d => d.trim()).filter(Boolean).map(d => `${d};`).join('\n')
  const save = h('button', {
    type: 'button',
    'data-primary': true,
    onclick: async () => {
      const style = area.value.split(/;|\n/).map(d => d.trim()).filter(Boolean).join('; ')
      const attributes = (node.attrs || []).filter(([name]) => name !== 'style').map(([name, value]) => ({ name, value }))
      if (style) attributes.push({ name: 'style', value: `${style};` })
      save.disabled = true
      const response = await api.updateElement({ id: node.id, attributes })
      save.disabled = false
      if (response.statusCode === 200) reloadKeepingInspector()
      else showError(response)
    }
  }, 'Save CSS')
  return stack({ 'data-gap': 'md' },
    sectionTitle('Inline CSS (style attribute)'),
    h('span', { is: 'e-muted' }, 'e-ui variables work here, like var(--e-primary). For spacing, colors and fonts, e-ui attributes (Attributes tab) are often simpler.'),
    h('label', {}, area),
    h('div', {}, save)
  )
}

async function move(child, parent, index) {
  const response = await api.moveElement({ id: child.id, parentId: parent.type === 'element' ? parent.id : 'root', index })
  if (response.statusCode === 200) reloadKeepingInspector()
  else showError(response)
}

// Last opened tab of the "add element" section
let currentLibrary = 'e-ui'
const LIBRARIES = [['ehtml', 'EHTML'], ['e-ui', 'e-ui'], ['html', 'HTML']]

// "Add element inside" dialog: tabs of libraries, search, tiles. After adding, the dialogs close
// and the inspector stays where it was, showing the updated subtree.
function openAddDialog(node) {
  if (!canAddInside(node)) return
  const parentId = node.type === 'element' ? node.id : 'root'
  let addDialog = null
  const input = h('input', { type: 'search', placeholder: 'Search elements…', autocomplete: 'off', spellcheck: 'false' })
  const grid = h('div', { 'data-ep': 'elements' })
  const tabs = row({ 'data-gap': 'xs', role: 'tablist', 'data-ep': 'tabs' })

  const pick = (item) => {
    openElementForm(item, {
      parentId,
      onSubmit: async (request) => {
        const response = await api.addElement({ ...request, parentId })
        if (response.statusCode === 200) {
          notifyImports(response.body)
          addDialog.close()
          currentTab = 'children'
          reloadKeepingInspector()
          return true
        }
        showError(response)
        return false
      }
    })
  }
  const tile = (item) => tooltip(item.description, h('button', {
    type: 'button',
    'data-ep': 'element-tile',
    'data-catalog-id': item.id,
    // What this tile does, like any e-form element (see requests.js)
    'data-request-url': '/e-pages/element/add',
    'data-request-method': 'POST',
    onclick: () => pick(item)
  },
  h('span', { 'data-ep': 'item-icon' }, icon(item.icon || 'widgets')),
  h('div', { is: 'e-stack', 'data-gap': '3xs', style: { minWidth: '0' } },
    h('span', { is: 'e-bold', 'data-font-size': 'xs' }, item.name),
    item.suggested ? h('span', { is: 'e-muted', 'data-font-size': '2xs', 'data-color': 'success' }, 'suggested') : null)
  ))
  const render = () => {
    tabs.replaceChildren(...LIBRARIES.map(([library, title]) => h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': library === currentLibrary ? 'true' : 'false',
      'data-primary': true,
      'data-fill': library === currentLibrary ? null : 'outlined',
      onclick: () => { currentLibrary = library; render() }
    }, title)))
    const items = rankElements(input.value, parentId, currentLibrary)
    grid.replaceChildren(...(items.length ? items.map(tile) : [h('span', { is: 'e-muted' }, 'Nothing found')]))
  }
  input.addEventListener('input', render)
  render()
  addDialog = openDialog({
    title: `Add element inside <${node.type === 'element' ? labelOf(node) : 'template'}>`,
    body: h('div', { is: 'e-stack', 'data-gap': 'md', 'data-ep': 'add-section' }, tabs, h('label', {}, input), grid)
  })
  input.focus()
}

/** Asks to confirm deleting the element, true if it was deleted */
export async function confirmAndDelete(node) {
  const confirmed = await confirmDialog({
    title: 'Delete element',
    message: `Delete <${labelOf(node)}>${elementChildren(node).length ? ' and everything inside it' : ''}? You can bring it back with Undo (⌘Z).`
  })
  if (!confirmed) return false
  const response = await api.deleteElement(node.id)
  if (response.statusCode !== 200) {
    showError(response)
    return false
  }
  return true
}

async function deleteElement(node, parentId) {
  const confirmed = await confirmDialog({
    title: 'Delete element',
    message: `Delete <${labelOf(node)}>${elementChildren(node).length ? ' and everything inside it' : ''}? You can bring it back with Undo (⌘Z).`
  })
  if (!confirmed) return
  const response = await api.deleteElement(node.id)
  if (response.statusCode === 200) {
    toast('Deleted. Undo with ⌘Z')
    // Stay at (or go back to) the parent after reload
    history = history.slice(0, position + 1).filter(id => id !== node.id)
    position = history.length - 1
    reloadKeepingInspector(parentId === 'root' ? rootId() : parentId)
  } else {
    showError(response)
  }
}

function actionsSection(node, found) {
  const siblings = elementChildren(found.parent)
  const index = siblings.indexOf(node)
  const parentId = found.parent.type === 'element' ? found.parent.id : 'root'
  return stack({ 'data-gap': 'md' },
    h('hr', { is: 'e-divider' }),
    row({ 'data-flex-wrap': null },
      iconButton('arrow_upward', 'Move up (before the previous element)', () => move(node, found.parent, index - 1), { disabled: index <= 0, direction: 'to-right' }),
      iconButton('arrow_downward', 'Move down (after the next element)', () => move(node, found.parent, index + 1), { disabled: index >= siblings.length - 1, direction: 'to-right' }),
      h('div', { style: { flex: '1' } }),
      h('button', {
        type: 'button',
        'data-primary': true,
        'data-fill': 'danger',
        'data-ep': 'delete',
        onclick: () => deleteElement(node, parentId)
      }, 'Delete element')
    )
  )
}
