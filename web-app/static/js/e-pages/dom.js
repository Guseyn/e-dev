// Tiny DOM helper for the editor UI (lives in a shadow root, so no framework needed).
//
//   h('button', { 'data-primary': true, onclick: () => {} }, 'Save')
//   h('input', { value: 'x', dataset: { name: 'id' } })

export function h(tag, props = {}, ...children) {
  // `is` is set as a plain attribute (for e-ui styles), so elements are not upgraded
  // to EHTML / e-ui components (requests.js creates the one real e-form itself)
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'is') {
      element.setAttribute('is', value)
    } else if (key === 'dataset') {
      Object.assign(element.dataset, value)
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value)
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'textContent') {
      element[key] = value
    } else if (value === true) {
      element.setAttribute(key, '')
    } else {
      element.setAttribute(key, String(value))
    }
  }
  append(element, children)
  return element
}

function append(element, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue
    element.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}

export function clear(element) {
  while (element.firstChild) element.firstChild.remove()
  return element
}

export function truncate(text, length = 60) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > length ? value.slice(0, length - 1) + '…' : value
}
