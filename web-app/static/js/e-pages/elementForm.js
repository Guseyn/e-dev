// Dialog to fill attributes of a new element (from the catalog) and place it inside
// the inspected element at a chosen position. Preset content of the element (like the
// title and text of a card) is added with it and can be previewed here.

import { h, truncate } from '#e-pages/dom.js'
import { store, findNode, elementChildren, labelOf, attr } from '#e-pages/store.js'
import { openDialog, editorLink, toast, sectionTitle, iconButton, icon, previewFrame as pagePreviewFrame } from '#e-pages/ui.js'

/**
 * Field like in apps: <label>Name <input></label> (e-ui styles it with a gap,
 * because dialogs wrap their body into form[is="e-form"]).
 */
export function field(name, control, { required = false, description, hint } = {}) {
  return h('label', {},
    h('span', {}, name, required ? h('span', { 'data-color': 'danger' }, ' *') : null),
    control,
    hint || null,
    description ? h('span', { is: 'e-helper' }, description) : null
  )
}

/** Row of name/value inputs for an attribute, with a remove button */
export function attributeRow(name = '', value = null, { listId, multiline = false } = {}) {
  const nameInput = h('input', { placeholder: 'attribute', value: name, list: listId })
  const valueInput = multiline
    ? h('textarea', { rows: Math.min(10, (value || '').split('\n').length + 1) })
    : h('input', { placeholder: 'value (empty = boolean)' })
  valueInput.value = value === null ? '' : value.replace(/^\n/, '')
  const row = h('div', { is: 'e-row', 'data-gap': 'sm', 'data-align-items': multiline ? 'start' : 'center', 'data-keep-flex-direction-row-in-mobile': true },
    h('label', { style: { flex: '1' } }, nameInput),
    h('label', { style: { flex: '2' } }, valueInput),
    iconButton('/images/bin.svg', 'Remove attribute', () => row.remove(), { direction: 'to-left' }))
  row.read = () => {
    const v = valueInput.value
    return { name: nameInput.value.trim(), value: valueInput.tagName === 'TEXTAREA' && v.includes('\n') ? `\n${v}\n` : v }
  }
  return row
}

/**
 * @param {any} item catalog entry
 * @param {{ parentId: string, onSubmit: (request) => Promise<boolean>|void }} options
 */
export function openElementForm(item, { parentId, onSubmit }) {
  const fields = []
  const allAttributes = attributesOf(item)
  // "primary" attributes are shown with required ones, but can stay empty
  const required = allAttributes.filter(a => a.required || a.primary)
  const optional = allAttributes.filter(a => !a.required && !a.primary)

  // Tag (h1–h6...)
  let tagSelect = null
  if (item.tagChoices) {
    tagSelect = h('select', {}, item.tagChoices.map(t => h('option', { value: t, selected: t === item.tag }, t)))
  }

  const requiredFields = required.map(a => attributeField(a, fields))
  const optionalFields = optional.map(a => attributeField(a, fields))

  // Extra attributes (presets of the element + your own)
  const customRows = h('div', { is: 'e-stack', 'data-gap': 'xs' })
  const addCustomRow = (name = '', value = '') => customRows.append(attributeRow(name, value, { listId: 'ep-attribute-names' }))
  for (const [name, value] of item.presetAttributes || []) addCustomRow(name, value)

  // Content
  let textArea = null
  if (item.content === 'text' || item.content === 'raw') {
    textArea = h('textarea', { rows: item.content === 'raw' ? 6 : 2, placeholder: 'Text content' })
    textArea.value = (item.defaultText || '').replace(/^\n/, '')
  }
  // Preview of the element with its preset content, rendered with the page styles
  const previewBox = h('div', { hidden: true })
  const togglePreview = () => {
    if (!previewBox.hidden) {
      previewBox.hidden = true
      return
    }
    previewBox.replaceChildren(previewFrame(item, tagSelect ? tagSelect.value : item.tag))
    previewBox.hidden = false
  }

  // Position among children of the parent
  const parent = findNode(parentId)
  const siblings = parent ? elementChildren(parent.node) : []
  const positionSelect = h('select', {},
    h('option', { value: '' }, 'At the end'),
    siblings.length ? h('option', { value: '0' }, 'At the start') : null,
    siblings.map((child, index) => h('option', { value: String(index + 1) }, `After ${truncate(labelOf(child), 50)}`))
  )

  const errorBox = h('span', { is: 'e-error', hidden: true })
  const nameList = h('datalist', { id: 'ep-attribute-names' },
    [...new Set(Object.values(store.groups).flat().map(a => a.name))].map(n => h('option', { value: n })))

  const submitButton = h('button', { type: 'button', 'data-primary': true }, 'Place inside')
  const dialog = openDialog({
    head: h('div', { is: 'e-row', 'data-gap': 'sm', 'data-keep-flex-direction-row-in-mobile': true, 'data-flex-wrap': 'wrap' },
      h('span', { 'data-ep': 'item-icon' }, icon(item.icon || 'widgets')),
      h('h4', { is: 'e-h' }, item.name),
      h('span', { is: 'e-chip' }, item.libraryTitle),
      item.invisible ? h('span', { is: 'e-chip', 'data-color': 'danger', title: 'Templates and data elements are not visible in the page after they are processed' }, 'not visible in DOM') : null
    ),
    body: [
      h('span', { is: 'e-muted' }, item.description),
      h('div', { is: 'e-row', 'data-gap': 'md', 'data-flex-wrap': 'wrap', 'data-keep-flex-direction-row-in-mobile': true },
        h('code', { is: 'e-code' }, item.tag === '#text' ? 'text node' : item.is ? `<${item.tag} is="${item.is}">` : `<${item.tag}>`),
        editorLink('component source', item.source, null, item.search),
        item.docs ? h('a', { is: 'e-link', 'data-underlined': true, href: item.docs, target: '_blank', rel: 'noopener' }, 'docs') : null,
        item.requires ? h('span', { is: 'e-muted', 'data-font-size': 'xs' }, `imports ${item.requires.join(', ')}`) : null,
        item.innerHTML || item.defaultText ? iconButton('visibility', 'Preview the element with its content', togglePreview, { direction: 'to-right' }) : null
      ),
      previewBox,
      tagSelect ? field('tag', tagSelect) : null,
      requiredFields.length ? h('div', { is: 'e-stack', 'data-gap': 'sm' }, sectionTitle('Main attributes'), h('div', { is: 'e-stack', 'data-gap': 'md' }, requiredFields)) : null,
      textArea ? field(item.content === 'raw' ? 'code' : 'text', textArea) : null,
      optionalFields.length ? h('details', { is: 'e-details' }, h('summary', {}, `Optional attributes (${optionalFields.length})`), h('div', { is: 'e-stack', 'data-gap': 'md', 'data-padding-top': 'md' }, optionalFields)) : null,
      item.noAttributes ? null : h('div', { is: 'e-stack', 'data-gap': 'sm' },
        sectionTitle('Other attributes'),
        customRows,
        h('div', {}, h('button', { type: 'button', 'data-primary': true, 'data-fill': 'outlined', onclick: () => addCustomRow() }, 'Add attribute')),
        nameList
      ),
      field(`position inside <${parent && parent.node.type === 'element' ? labelOf(parent.node) : 'template'}>`, positionSelect),
      errorBox
    ],
    footer: [
      h('button', { type: 'button', 'data-primary': true, 'data-fill': 'outlined', onclick: () => dialog.close() }, 'Cancel'),
      submitButton
    ]
  })

  submitButton.addEventListener('click', async () => {
    const attributes = []
    const missing = []
    for (const f of fields) {
      const value = f.read()
      if (value === undefined) {
        if (f.attribute.required) missing.push(f.attribute.name)
        continue
      }
      attributes.push({ name: f.attribute.name, value })
    }
    for (const row of customRows.children) {
      const { name, value } = row.read()
      if (name) attributes.push({ name, value })
    }
    if (missing.length) {
      errorBox.hidden = false
      errorBox.textContent = `Fill in: ${missing.join(', ')}`
      return
    }
    const request = {
      tag: tagSelect ? tagSelect.value : item.tag,
      attributes: item.is ? [{ name: 'is', value: item.is }, ...attributes] : attributes,
      text: textArea ? textArea.value : undefined,
      innerHTML: item.innerHTML || undefined,
      requires: item.requires || undefined,
      index: positionSelect.value
    }
    submitButton.disabled = true
    const done = await onSubmit(wrapInFormIfNeeded(item, request, parentId), dialog)
    submitButton.disabled = false
    if (done !== false) dialog.close()
  })

  const firstInput = dialog.querySelector('[data-ep="dialog-body"] input, [data-ep="dialog-body"] textarea, [data-ep="dialog-body"] select')
  if (firstInput) firstInput.focus()
  return dialog
}

/** Catalog attributes of the element + its attribute groups + global ones */
export function attributesOf(item) {
  // Text nodes have no attributes
  if (item.noAttributes) return []
  const list = [...(item.attributes || [])]
  const groups = [...(item.groups || [])]
  if (item.library !== 'ehtml' || ['button-submit'].includes(item.id)) {
    groups.push('ehtml-binding')
  }
  groups.push('global')
  for (const group of groups) {
    for (const attribute of store.groups[group] || []) {
      if (!list.some(a => a.name === attribute.name)) list.push(attribute)
    }
  }
  const presetNames = new Set((item.presetAttributes || []).map(([name]) => name))
  return list.filter(a => !presetNames.has(a.name) && a.name !== 'is')
}

/* ──────────────────────────────────────────────────────────────── */
/* FIELDS WITH AUTOFILL                                             */
/* ──────────────────────────────────────────────────────────────── */

let listCounter = 0

function attributeField(attribute, fields) {
  const { name, type } = attribute
  const options = { required: attribute.required, description: attribute.description }
  let control

  if (type === 'boolean') {
    control = h('input', { type: 'checkbox', checked: attribute.default === true })
    fields.push({ attribute, read: () => control.checked ? null : undefined })
    return h('label', { 'data-flex-direction': 'row' },
      h('div', { is: 'e-row', 'data-gap': 'sm', 'data-keep-flex-direction-row-in-mobile': true },
        control,
        h('div', { is: 'e-stack' },
          h('span', { is: 'e-bold', 'data-font-size': 'sm' }, h('code', {}, name)),
          attribute.description ? h('span', { is: 'e-helper' }, attribute.description) : null)))
  }

  if (type === 'enum') {
    control = h('select', {},
      h('option', { value: '' }, attribute.required ? 'choose…' : '—'),
      (attribute.values || []).map(v => h('option', { value: v, selected: v === attribute.default }, v)))
  } else if (type === 'actions' || type === 'css' || (type === 'expression' && (attribute.default || '').includes('\n'))) {
    control = h('textarea', { rows: type === 'actions' ? 4 : 2, placeholder: attribute.placeholder || '' })
    control.value = (attribute.default || '').replace(/^\n/, '').replace(/\n$/, '')
  } else {
    const suggestions = suggestionsFor(attribute)
    const listId = suggestions.length ? `ep-list-${++listCounter}` : null
    control = h('input', { value: attribute.default || '', placeholder: attribute.placeholder || placeholderFor(type), list: listId })
    if (listId) {
      const hint = h('span', { is: 'e-helper', 'data-color': 'success' })
      const datalist = h('datalist', { id: listId }, suggestions.map(o => h('option', { value: o.value, label: o.label })))
      control.addEventListener('input', () => { hint.textContent = hintFor(attribute, control.value) })
      hint.textContent = hintFor(attribute, control.value)
      fields.push({ attribute, read: () => readValue(control) })
      return field(name, h('div', {}, control, datalist), { ...options, hint })
    }
  }
  fields.push({ attribute, read: () => readValue(control) })
  return field(name, control, options)
}

function readValue(control) {
  const value = control.value
  return value.trim() === '' ? undefined : (control.tagName === 'TEXTAREA' && value.includes('\n') ? `\n${value}\n` : value)
}

function placeholderFor(type) {
  return {
    'endpoint-get': '/endpoint (GET)',
    'endpoint-any': '/endpoint',
    'html-page': '/html/...',
    'template-page': '/html/templates/...',
    selector: '#id or .class',
    expression: '${...}',
    name: 'name',
    url: '/...'
  }[type] || ''
}

// Autofill options by attribute type
function suggestionsFor(attribute) {
  switch (attribute.type) {
    case 'endpoint-get':
      return store.routes.filter(r => r.method === 'GET' && !r.isRegExp).map(r => ({ value: r.urlPattern.split('?')[0], label: `GET → ${r.file || r.handler}` }))
    case 'endpoint-any':
      return store.routes.filter(r => !r.isRegExp).map(r => ({ value: r.urlPattern.split('?')[0], label: `${r.method} → ${r.file || r.handler}` }))
    case 'html-page':
      return store.pages.map(p => ({ value: p.url, label: `${p.kind}${p.title ? `: ${p.title}` : ''}` }))
    case 'template-page':
      return store.pages.filter(p => p.kind === 'template').map(p => ({ value: p.url, label: 'template' }))
    case 'selector':
      return selectorsInModel()
    default:
      return []
  }
}

function hintFor(attribute, value) {
  if (!value) return ''
  if (attribute.type === 'endpoint-get' || attribute.type === 'endpoint-any') {
    const path = value.split('?')[0]
    const route = store.routes.find(r => r.urlPattern.split('?')[0] === path)
    return route ? `→ ${route.method} ${route.file}:${route.handlerLine}` : 'no such endpoint in web-app/routes.js'
  }
  if (attribute.type === 'html-page' || attribute.type === 'template-page') {
    return store.pages.some(p => p.url === value.split('?')[0]) ? '' : 'no such page (yet)'
  }
  return ''
}

function selectorsInModel() {
  const result = []
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type !== 'element') continue
      const id = attr(child, 'id')
      if (id) result.push({ value: `#${id}`, label: child.tag })
      const objectName = attr(child, 'data-object-name')
      if (objectName) result.push({ value: `template[data-object-name='${objectName}']`, label: 'template' })
      walk(child)
    }
  }
  walk(store.model.root)
  return result
}

export function notifyImports(body) {
  const imports = body && body.imports
  if (!imports) return
  const messages = []
  if (imports.added && imports.added.length) messages.push(`Added import: ${imports.added.join(', ')}`)
  for (const { page, added } of imports.pages || []) messages.push(`Added to ${page} (uses this template): ${added.join(', ')}`)
  if (imports.missing && imports.missing.length) messages.push(`Pages using this template must import ${imports.missing.join(', ')}`)
  if (messages.length) toast(messages.join('. '))
}

/** Iframe with the element (preset attributes + content), rendered like on the page */
function previewFrame(item, tag) {
  const attrs = [
    item.is ? ['is', item.is] : null,
    ...(item.presetAttributes || [])
  ].filter(Boolean).map(([n, v]) => v === null ? n : `${n}="${String(v).replace(/"/g, '&quot;')}"`).join(' ')
  const content = item.innerHTML || item.defaultText || ''
  // Templates are not rendered by browsers, show their content instead
  const markup = tag === 'template' || tag === '#text' ? content : `<${tag}${attrs ? ' ' + attrs : ''}>${content}</${tag}>`
  return pagePreviewFrame(markup, `Preview of ${item.name}`)
}

/**
 * Some e-ui fields (file upload) are styled and work only inside form[is="e-form"]:
 * outside of one, the element is placed inside a new e-form.
 */
function wrapInFormIfNeeded(item, request, parentId) {
  if (!item.wrapInForm) return request
  const found = findNode(parentId)
  const chain = found ? [...found.path, found.node] : []
  const insideForm = chain.some(n => n.type === 'element' && n.tag === 'form' && (n.attrs || []).some(([name, value]) => name === 'is' && value === 'e-form'))
  if (insideForm) return request
  const attrs = (request.attributes || [])
    .map(({ name, value }) => value === null || value === undefined || value === '' ? name : `${name}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ')
  return {
    ...request,
    tag: 'form',
    attributes: [{ name: 'is', value: 'e-form' }, { name: 'data-no-style', value: null }, { name: 'data-width', value: 'full' }],
    text: undefined,
    innerHTML: `<${request.tag} ${attrs}>${request.innerHTML || ''}</${request.tag}>`
  }
}
