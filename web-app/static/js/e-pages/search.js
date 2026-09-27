// Search in the top bar (actions: modify page, tree, new page...) and ranking of
// catalog elements for the "add element" tabs in the inspector. Elements are ranked
// by the query and by the context: children suggested by the parent go first
// (e.g. <option> in <select>, templates in <e-json>, fields in <e-form>).

import { h, clear } from '#e-pages/dom.js'
import { store, findNode, catalogEntryOf, attr } from '#e-pages/store.js'

/* ──────────────────────────────────────────────────────────────── */
/* ACTIONS SEARCH (TOP BAR)                                         */
/* ──────────────────────────────────────────────────────────────── */

/**
 * @param {{ actions: { id, icon, name, description }[], onPick: (action) => void, placeholder?: string }} options
 */
export function createActionSearch({ actions, onPick, placeholder }) {
  let selected = 0
  let items = []
  const input = h('input', { type: 'search', placeholder: placeholder || 'Search…', autocomplete: 'off', spellcheck: 'false' })
  const results = h('ul', { is: 'e-list', 'data-ep': 'results', role: 'listbox', hidden: true })
  // label inside form[is="e-form"] gets e-ui field styles (the form is never submitted)
  const element = h('form', { is: 'e-form', 'data-no-style': true, 'data-width': 'full', 'data-ep': 'search', onsubmit: (event) => event.preventDefault() },
    h('label', {}, input), results)

  const render = () => {
    const q = input.value.trim().toLowerCase()
    items = actions.filter(a => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
    clear(results)
    if (items.length === 0) {
      results.append(h('li', { is: 'e-list-item' }, h('span', { is: 'e-muted' }, 'Nothing found')))
    }
    items.forEach((item, index) => results.append(actionRow(item, index === selected, () => pick(index))))
    results.hidden = false
  }
  const pick = (index) => {
    const item = items[index]
    if (!item) return
    results.hidden = true
    input.value = ''
    input.blur()
    onPick(item)
  }
  input.addEventListener('focus', () => { selected = 0; render() })
  input.addEventListener('input', () => { selected = 0; render() })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); selected = Math.min(items.length - 1, selected + 1); render() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(0, selected - 1); render() }
    else if (event.key === 'Enter') { event.preventDefault(); pick(selected) }
    else if (event.key === 'Escape') { results.hidden = true; input.blur() }
  })
  // Delay, so a click on a result is handled before results hide
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true }, 150))
  return { element, input }
}

function actionRow(item, isSelected, onClick) {
  return h('li', {
    is: 'e-list-item',
    'data-cursor': 'pointer',
    role: 'option',
    'aria-selected': isSelected ? 'true' : 'false',
    'data-action': item.id,
    onmousedown: (event) => { event.preventDefault(); onClick() }
  },
  h('div', { is: 'e-row', 'data-gap': 'md', 'data-keep-flex-direction-row-in-mobile': true },
    h('span', { 'data-ep': 'item-icon', 'data-special': true }, h('img', { src: `/images/icons/${item.icon}.svg`, alt: '', 'aria-hidden': 'true' })),
    h('div', { is: 'e-stack', style: { flex: '1', minWidth: '0' } },
      h('span', { is: 'e-bold' }, item.name),
      h('span', { is: 'e-muted', 'data-font-size': 'xs' }, item.description))
  ))
}

/* ──────────────────────────────────────────────────────────────── */
/* ELEMENTS RANKING (ADD ELEMENT TABS)                              */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Catalog elements of a library, ranked for adding inside the element with `contextId`.
 * @param {string} query
 * @param {string} contextId
 * @param {string} library 'ehtml' | 'e-ui' | 'html'
 */
export function rankElements(query, contextId, library) {
  const q = query.trim().toLowerCase()
  const context = contextOf(contextId)
  const ranked = []
  for (const item of store.catalog) {
    if (library && item.library !== library) continue
    const textScore = matchScore(item, q)
    if (textScore === null) continue
    const { score: contextScore, suggested } = contextScoreOf(item, context)
    ranked.push({ ...item, suggested, score: textScore + contextScore })
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return ranked
}

function matchScore(item, q) {
  if (!q) return 0
  const name = item.name.toLowerCase()
  const id = item.id.toLowerCase()
  const tag = `${item.tag}${item.is ? ` ${item.is}` : ''}`.toLowerCase()
  const desc = (item.description || '').toLowerCase()
  if (name === q || id === q || item.is === q || item.tag === q) return 120
  if (name.startsWith(q) || id.startsWith(q)) return 100
  if (tag.includes(q)) return 80
  if (name.includes(q) || id.includes(q)) return 60
  if (desc.includes(q)) return 25
  if (isSubsequence(q, name) || isSubsequence(q, id)) return 10
  return null
}

function isSubsequence(q, text) {
  let i = 0
  for (const char of text) {
    if (char === q[i]) i++
    if (i === q.length) return true
  }
  return false
}

// What we know about where the new element goes
function contextOf(contextId) {
  const found = findNode(contextId)
  const node = found ? found.node : null
  const chain = found ? [...found.path, node].filter(Boolean) : []
  const entry = node ? catalogEntryOf(node) : null
  const keys = new Set()
  if (node && node.type === 'element') {
    keys.add(node.tag)
    if (attr(node, 'is')) keys.add(attr(node, 'is'))
  }
  if (!node || node.type !== 'element') keys.add('body')
  if (entry) keys.add(entry.id)
  const insideForm = chain.some(n => n.type === 'element' && attr(n, 'is') === 'e-form')
  const insideTemplate = chain.some(n => n.type === 'element' && (n.tag === 'template' || n.tag === 'e-json'))
  return { node, entry, keys, insideForm, insideTemplate, isHead: node && node.tag === 'head' }
}

function contextScoreOf(item, context) {
  let score = 0
  let suggested = false
  const { entry, keys } = context
  if (entry && (entry.suggestedChildren || []).includes(item.id)) {
    score += 50
    suggested = true
  }
  if (item.parents) {
    if (item.parents.includes('*')) {
      score += 0
    } else if (item.parents.some(p => keys.has(p))) {
      score += 40
      suggested = true
    } else {
      score -= 80
    }
  }
  if (context.insideForm && item.category === 'form') score += 25
  if (context.insideTemplate && (item.category === 'template' || item.category === 'text')) score += 15
  if (keys.has('e-json') && item.category === 'template') score += 20
  if (context.isHead) {
    score += item.category === 'code' ? 60 : -60
  } else if (item.parents && item.parents.includes('head')) {
    score -= 40
  }
  if (keys.has('body') && item.category === 'layout') score += 10
  // Plain text goes almost anywhere, keep it near the top of the HTML tab
  if (item.id === 'text-node' && !context.isHead) score += 30
  return { score, suggested }
}
