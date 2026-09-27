// e-pages editor (loaded by loader.js only on localhost with ?dev=true).

import { h } from '#e-pages/dom.js'
import { store, loadAll, rootId, catalogById, getJSON, elementChildren, labelOf, textOf } from '#e-pages/store.js'
import { mountUI, ui, openDialog, toast, showError, iconButton, openInEditor, startTooltips } from '#e-pages/ui.js'
import { field } from '#e-pages/elementForm.js'
import { api } from '#e-pages/requests.js'
import { createActionSearch } from '#e-pages/search.js'
import { openInspector, restoreInspector, confirmAndDelete, canAddInside } from '#e-pages/inspector.js'
import { treeNodes } from '#e-pages/tree.js'
import { interceptLinks, withDevParam } from '#e-pages/links.js'

export default async function startEditor() {
  interceptLinks()
  await mountUI()
  try {
    await loadAll()
  } catch (error) {
    toast(`e-pages: ${error.message}`, { error: true })
    console.error('[e-pages]', error)
    return
  }
  startTooltips()
  await applyCssVarsToEditor()
  renderBar()
  // Room for the fixed bar, so it doesn't cover the top of the page
  document.documentElement.style.paddingTop = '80px'
  restoreInspector()
  // The tree was open before the reload that showed a change (like a delete from the tree)
  if (sessionStorage.getItem(TREE_KEY())) {
    sessionStorage.removeItem(TREE_KEY())
    openTree()
  }
  window.ePages = { store, openInspector, catalogById }
}

const ACTIONS = [
  { id: 'modify', icon: 'edit', name: 'Modify This Page', description: 'Open <body> of this page: its elements, and adding new ones' },
  { id: 'tree', icon: 'account_tree', name: 'See Full Tree', description: 'All elements of this page (head and body), to open any of them' },
  { id: 'new-page', icon: 'note_add', name: 'Add New Page', description: 'Create an html page in web-app/static/html and open it' },
  { id: 'new-template', icon: 'dashboard_customize', name: 'Add New Template', description: 'Create a template (no html/head/body) for e-wrapper and open it' },
  { id: 'css-vars', icon: 'palette', name: 'Edit CSS Variables', description: 'Override e-ui variables (colors, fonts, spacing...) in :root of app.css' }
]

function renderBar() {
  const search = createActionSearch({
    actions: ACTIONS,
    placeholder: 'Modify this page, see the tree, add pages…  ( / )',
    onPick: onAction
  })
  const isPage = store.model.kind === 'page'
  const bar = h('div', { is: 'e-card', 'data-ep': 'bar', 'data-padding': 'sm', 'data-box-shadow': 'lg' },
    h('div', { is: 'e-row', 'data-gap': 'sm', 'data-keep-flex-direction-row-in-mobile': true },
      search.element,
      iconButton('edit', isPage ? 'Modify this page (open <body>)' : 'Modify this template', () => openInspector(rootId(), { resetHistory: true }), { ep: 'inspect-root' }),
      iconButton('account_tree', 'See the full tree of elements', openTree),
      iconButton('undo', store.model.undoAvailable ? 'Undo the last change (⌘Z)' : 'Nothing to undo (⌘Z)', undo, { disabled: !store.model.undoAvailable }),
      iconButton('redo', store.model.redoAvailable ? 'Redo (⌘⇧Z)' : 'Nothing to redo (⌘⇧Z)', redo, { disabled: !store.model.redoAvailable }),
      iconButton('code', `Open ${store.model.file} in the code editor`, () => openInEditor(store.model.file, 1))
    )
  )
  ui.layer.append(bar)

  document.addEventListener('keydown', (event) => {
    const typing = event.composedPath().some(el => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    if (typing) return
    const dialogOpen = Boolean(ui.root.querySelector('dialog[open]'))
    if (event.key === '/' && !dialogOpen) {
      event.preventDefault()
      search.input.focus()
    }
    // ⌘Z / ⌘⇧Z (Ctrl on Linux and Windows)
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !dialogOpen) {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
  })
}

function onAction(action) {
  if (action.id === 'modify') return openInspector(rootId(), { resetHistory: true })
  if (action.id === 'tree') return openTree()
  if (action.id === 'new-page') return newPageDialog('page')
  if (action.id === 'new-template') return newPageDialog('template')
  if (action.id === 'css-vars') return cssVarsDialog()
}

/* ──────────────────────────────────────────────────────────────── */
/* FULL TREE                                                        */
/* ──────────────────────────────────────────────────────────────── */

const TREE_KEY = () => `e-pages:tree:${store.page}`

// Every element of the page model (head too), collapsible: open, add inside, delete, or go to its code
function openTree() {
  const input = h('input', { type: 'search', placeholder: 'Filter by tag, id, text…', autocomplete: 'off' })
  const list = h('div', { is: 'e-stack', 'data-gap': '2xs', 'data-ep': 'tree' })
  const open = (id, options = {}) => {
    dialog.close()
    openInspector(id, { resetHistory: true, ...options })
  }
  const options = {
    openDepth: 2,
    onOpen: (node) => open(node.id),
    actions: (node) => {
      const line = store.model.lines[node.id]
      return [
        iconButton('code', `Open line ${line || 1} of ${store.model.file} in the code editor`, () => openInEditor(store.model.file, line)),
        iconButton('edit', 'Edit this element', () => open(node.id)),
        canAddInside(node) ? iconButton('add', 'Add elements inside', () => open(node.id, { focusAdd: true })) : null,
        ['html', 'head', 'body'].includes(node.tag)
          ? null
          : iconButton('/images/bin.svg', 'Delete this element', async () => {
            if (await confirmAndDelete(node)) {
              sessionStorage.setItem(TREE_KEY(), '1')
              window.location.reload()
            }
          })
      ]
    }
  }
  const render = () => {
    const q = input.value.trim().toLowerCase()
    if (!q) {
      list.replaceChildren(...treeNodes(store.model.root, options))
      return
    }
    // Filtered: matching elements as a flat list
    const matches = []
    const walk = (node) => {
      for (const child of elementChildren(node)) {
        if (labelOf(child).toLowerCase().includes(q) || textOf(child).toLowerCase().includes(q)) {
          matches.push({ ...child, children: (child.children || []).filter(c => c.type !== 'element') })
        }
        walk(child)
      }
    }
    walk(store.model.root)
    list.replaceChildren(...(matches.length ? treeNodes({ children: matches }, options) : [h('span', { is: 'e-muted' }, 'Nothing found')]))
  }
  input.addEventListener('input', render)
  render()
  const dialog = openDialog({
    title: 'Page tree',
    body: [h('label', {}, input), list]
  })
  input.focus()
}

async function undo() {
  const response = await api.undo()
  if (response.statusCode === 200) window.location.reload()
  else showError(response)
}

async function redo() {
  const response = await api.redo()
  if (response.statusCode === 200) window.location.reload()
  else showError(response)
}

function newPageDialog(kind) {
  const isTemplate = kind === 'template'
  const pathInput = h('input', { placeholder: isTemplate ? 'account.html' : 'blog/post.html', required: true })
  const titleInput = isTemplate ? null : h('input', { placeholder: 'Title' })
  const errorBox = h('span', { is: 'e-error', hidden: true })
  const create = h('button', { type: 'button', 'data-primary': true }, 'Create and open')
  const dialog = openDialog({
    small: true,
    title: isTemplate ? 'Add New Template' : 'Add New Page',
    body: [
      h('span', { is: 'e-muted' }, isTemplate
        ? 'A template has no <html>, <head> and <body>: use it in pages with <template is="e-wrapper" data-src="…">. Its content goes into the element with id="content".'
        : 'Creates the html file (and its model) and opens it in e-pages.'),
      field(`file in ${isTemplate ? 'web-app/static/html/templates/' : 'web-app/static/html/'}`, pathInput),
      titleInput ? field('title', titleInput) : null,
      errorBox
    ],
    footer: [
      h('button', { type: 'button', 'data-primary': true, 'data-fill': 'outlined', onclick: () => dialog.close() }, 'Cancel'),
      create
    ]
  })
  pathInput.focus()
  const submit = async () => {
    const path = pathInput.value.trim()
    if (!path) return
    create.disabled = true
    const response = isTemplate
      ? await api.newTemplate({ path: `templates/${path.replace(/^templates\//, '')}` })
      : await api.newPage({ path, title: titleInput.value.trim() || undefined })
    create.disabled = false
    if (response.statusCode === 200) {
      window.location.assign(withDevParam(response.body.url))
    } else {
      errorBox.hidden = false
      errorBox.textContent = response.body.error
    }
  }
  create.addEventListener('click', submit)
  pathInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit() })
}

/* ──────────────────────────────────────────────────────────────── */
/* CSS VARIABLES                                                    */
/* ──────────────────────────────────────────────────────────────── */

// Changes are previewed on the page right away (inline :root style) and saved to app.css
async function cssVarsDialog() {
  let data
  try {
    data = await getJSON('/e-pages/css-vars')
  } catch (error) {
    toast(error.message, { error: true })
    return
  }
  const root = document.documentElement
  const inputs = new Map()
  const groups = new Map()
  for (const variable of data.vars) {
    if (!groups.has(variable.group)) groups.set(variable.group, [])
    groups.get(variable.group).push(variable)
  }
  // Preview on the page and in the editor UI (its e-ui variables are set on the shadow host)
  const preview = (name, value) => {
    for (const target of [root, ui.host]) {
      if (value) target.style.setProperty(name, value)
      else target.style.removeProperty(name)
    }
  }
  const rowOf = (variable) => {
    const text = h('input', { value: variable.value || '', placeholder: variable.default || '' })
    const isColor = variable.group === 'Colors' && /^#[0-9a-f]{3,8}$/i.test(variable.value || variable.default || '')
    const color = isColor ? h('input', { type: 'color', 'aria-label': `Pick ${variable.name}`, value: (variable.value || variable.default).slice(0, 7) }) : null
    text.addEventListener('input', () => {
      preview(variable.name, text.value.trim())
      if (color && /^#[0-9a-f]{6}$/i.test(text.value.trim())) color.value = text.value.trim()
    })
    if (color) {
      color.addEventListener('input', () => { text.value = color.value; preview(variable.name, color.value) })
    }
    inputs.set(variable.name, text)
    return h('div', { is: 'e-row', 'data-gap': 'sm', 'data-align-items': 'center', 'data-keep-flex-direction-row-in-mobile': true },
      h('code', { is: 'e-code', style: { minWidth: '40%' } }, variable.name),
      color ? h('label', { style: { width: 'auto', flex: '0 0 auto' } }, color) : null,
      h('label', { style: { flex: '1' } }, text),
      iconButton('restart_alt', `Reset to e-ui default: ${variable.default || 'none'}`, () => {
        text.value = ''
        if (color) color.value = (variable.default || '#000000').slice(0, 7)
        preview(variable.name, '')
      }, { direction: 'to-left' })
    )
  }
  const order = ['Colors', 'Fonts', 'Font sizes', 'Spacing', 'Radius', 'Shadows', 'Sizes', 'Other']
  const sections = order.filter(g => groups.has(g)).map((group, index) =>
    h('details', { is: 'e-details', open: index === 0 },
      h('summary', {}, `${group} (${groups.get(group).length})`),
      h('div', { is: 'e-stack', 'data-gap': 'sm', 'data-padding-top': 'md' }, groups.get(group).map(rowOf))
    )
  )
  const save = h('button', { type: 'button', 'data-primary': true }, 'Save to app.css')
  let saved = false
  const dialog = openDialog({
    title: 'CSS Variables',
    body: [
      h('span', { is: 'e-muted' }, `Overrides of e-ui variables, saved in :root of ${data.file}. Changes are previewed on the page right away. Empty value means the e-ui default.`),
      sections
    ],
    footer: [
      h('button', { type: 'button', 'data-primary': true, 'data-fill': 'outlined', onclick: () => dialog.close() }, 'Cancel'),
      save
    ],
    // Without saving, the preview is dropped
    onClose: () => {
      if (saved) return
      for (const name of inputs.keys()) root.style.removeProperty(name)
      applyCssVarsToEditor()
    }
  })
  save.addEventListener('click', async () => {
    save.disabled = true
    const vars = [...inputs].map(([name, input]) => ({ name, value: input.value.trim() }))
    const response = await api.saveCssVars(vars)
    save.disabled = false
    if (response.statusCode === 200) {
      saved = true
      window.location.reload()
    } else {
      showError(response)
    }
  })
}

// Overrides from app.css apply to the page by themselves; the editor UI has its own copy
// of e-ui variables (on the shadow host), so the same overrides are applied there too
async function applyCssVarsToEditor() {
  try {
    const { vars } = await getJSON('/e-pages/css-vars')
    for (const variable of vars) {
      if (variable.value) ui.host.style.setProperty(variable.name, variable.value)
      else ui.host.style.removeProperty(variable.name)
    }
  } catch (error) {
    console.warn('[e-pages] Could not read CSS variables', error)
  }
}
