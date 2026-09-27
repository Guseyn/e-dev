// Tree of model elements, used by the page tree dialog and by the subtree in the inspector.
// Elements with children are collapsible <details is="e-details">, leaves are plain rows.
// Every row: icon, label (opens the element) and action buttons from `actions`.

import { h } from '#e-pages/dom.js'
import { elementChildren, labelOf, textOf, catalogEntryOf } from '#e-pages/store.js'
import { icon } from '#e-pages/ui.js'

/**
 * @param {any} parent node whose children are shown
 * @param {{
 *   onOpen: (node) => void,
 *   actions: (node, context: { parent: any, index: number, siblings: any[] }) => any[],
 *   openDepth?: number, // levels expanded from the start
 *   depth?: number
 * }} options
 * @returns {HTMLElement[]}
 */
export function treeNodes(parent, options) {
  const { openDepth = 1, depth = 0 } = options
  const siblings = elementChildren(parent)
  const result = []
  for (const node of parent.children || []) {
    // Text nodes have no ids in the model: shown, and changed with "Edit as HTML"
    if (node.type === 'text' && node.value.trim()) {
      result.push(h('div', { 'data-ep': 'tree-leaf' }, textRow(node)))
      continue
    }
    if (node.type !== 'element') continue
    result.push(elementNode(node, siblings.indexOf(node), siblings, parent, options, { openDepth, depth }))
  }
  return result
}

function elementNode(node, index, siblings, parent, options, { openDepth, depth }) {
  const row = treeRow(node, options, { parent, index, siblings })
  // Elements with only text inside stay leaves (their text is shown in the row)
  if (elementChildren(node).length === 0) {
    return h('div', { 'data-ep': 'tree-leaf' }, row)
  }
  const details = h('details', { is: 'e-details', 'data-ep': 'tree-node', open: depth < openDepth },
    h('summary', {}, row),
    h('div', { is: 'e-stack', 'data-gap': '2xs', 'data-ep': 'tree-children' })
  )
  // Children are rendered when the node is opened for the first time (big pages stay fast)
  const fill = () => {
    const container = details.querySelector('[data-ep="tree-children"]')
    if (container.childElementCount === 0) {
      container.append(...treeNodes(node, { ...options, depth: depth + 1 }))
    }
  }
  if (details.open) fill()
  details.addEventListener('toggle', () => { if (details.open) fill() })
  return details
}

function textRow(node) {
  return h('div', { is: 'e-row', 'data-gap': 'sm', 'data-keep-flex-direction-row-in-mobile': true, 'data-ep': 'tree-row' },
    h('span', { 'data-ep': 'item-icon' }, icon('text_fields')),
    h('span', { is: 'e-muted', 'data-font-size': 'xs', style: { flex: '1', minWidth: '0', wordBreak: 'break-word' } },
      `"${node.value.trim().replace(/\s+/g, ' ').slice(0, 80)}"`))
}

function treeRow(node, { onOpen, actions }, context) {
  const entry = catalogEntryOf(node)
  const text = textOf(node)
  const inside = elementChildren(node).length
  // Clicks on the label open the element; on buttons do their action; elsewhere toggle the node
  const stop = (event) => { event.preventDefault(); event.stopPropagation() }
  return h('div', { is: 'e-row', 'data-gap': 'sm', 'data-flex-wrap': 'wrap', 'data-keep-flex-direction-row-in-mobile': true, 'data-ep': 'tree-row' },
    h('span', { 'data-ep': 'item-icon' }, icon(entry && entry.icon ? entry.icon : 'widgets')),
    h('span', {
      'data-ep': 'tree-label',
      style: { flex: '1 1 10rem', minWidth: '0', wordBreak: 'break-word' },
      onclick: (event) => { stop(event); onOpen(node) }
    },
    h('code', {}, `<${labelOf(node)}>`),
    text ? h('span', { is: 'e-muted', 'data-font-size': 'xs' }, `  ${text.slice(0, 60)}`) : null,
    inside ? h('span', { is: 'e-muted', 'data-font-size': 'xs' }, `  ${inside} inside`) : null),
    h('div', { is: 'e-row', 'data-gap': 'xs', 'data-keep-flex-direction-row-in-mobile': true, 'data-ep': 'tree-actions', onclick: stop },
      ...actions(node, context).filter(Boolean))
  )
}
