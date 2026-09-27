// Mount point of the editor UI: a shadow root on an element attached to <html>
// (outside of <body>), so the page CSS doesn't affect it, EHTML's observer (which
// watches <body>) doesn't touch it, and it doesn't appear in the page model.

import { h } from '#e-pages/dom.js'
import { editorStyleSheets } from '#e-pages/styles.js'
import { setFormsHost, api } from '#e-pages/requests.js'

export const ui = {
  host: null,
  root: null, // shadow root
  layer: null // container for bar, dialogs, overlays
}

export async function mountUI() {
  const host = document.createElement('e-pages-editor')
  host.setAttribute('data-no-ehtml', 'true')
  document.documentElement.append(host)
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = await editorStyleSheets()
  const layer = h('div', { 'data-ep': 'layer' })
  const formsHost = h('div', { 'data-ep': 'forms-host' })
  root.append(layer, formsHost)
  setFormsHost(formsHost)
  Object.assign(ui, { host, root, layer })
  return ui
}

/** Is the event target part of the editor UI */
export function isEditorEvent(event) {
  return event.composedPath().includes(ui.host)
}

/* ──────────────────────────────────────────────────────────────── */
/* ICONS                                                            */
/* ──────────────────────────────────────────────────────────────── */

/** Material icon from /images/icons (or any image by url) */
export function icon(name, { size = '3xs' } = {}) {
  const src = name.includes('/') ? name : `/images/icons/${name}.svg`
  return h('img', { src, alt: '', 'aria-hidden': 'true', 'data-size': size })
}

/** Wraps an element into e-tooltip with a description of what it does */
export function tooltip(tip, element, direction) {
  return h('e-tooltip', { 'data-tip': tip, 'data-direction': direction || null }, element)
}

/**
 * Icon button in e-ui style: <e-tooltip><button is="e-with-icon"><img></button></e-tooltip>
 * @param {string} iconName
 * @param {string} tip tooltip and aria-label
 * @param {(event) => void} onclick
 * @param {{ direction?: string, disabled?: boolean, ep?: string }} [options]
 */
export function iconButton(iconName, tip, onclick, { direction, disabled = false, ep } = {}) {
  const button = h('button', {
    type: 'button',
    is: 'e-with-icon',
    'aria-label': tip,
    disabled,
    'data-ep': ep || null,
    onclick: (event) => {
      event.preventDefault()
      event.stopPropagation()
      onclick(event)
    }
  }, icon(iconName))
  return tooltip(tip, button, direction)
}

/**
 * Tooltips are drawn by one popover (top layer), so they are shown above modal dialogs,
 * unlike e-ui's CSS tooltips, which are clipped by the dialog. It reads data-tip of <e-tooltip>.
 */
export function startTooltips() {
  const tip = h('div', { popover: 'manual', role: 'tooltip', 'data-ep': 'tooltip' })
  ui.layer.append(tip)
  let current = null
  const hide = () => {
    current = null
    if (tip.matches(':popover-open')) tip.hidePopover()
  }
  const show = (target) => {
    current = target
    tip.textContent = target.getAttribute('data-tip')
    // Shown again each time, so it's above the dialog that was opened last
    if (tip.matches(':popover-open')) tip.hidePopover()
    tip.showPopover()
    const rect = target.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    const gap = 8
    let top = rect.top - box.height - gap
    if (top < gap) top = rect.bottom + gap
    const left = Math.min(Math.max(gap, rect.left + rect.width / 2 - box.width / 2), window.innerWidth - box.width - gap)
    tip.style.top = `${top}px`
    tip.style.left = `${left}px`
  }
  const tooltipOf = (event) => event.composedPath().find(el => el.tagName === 'E-TOOLTIP' && el.hasAttribute('data-tip'))
  ui.root.addEventListener('mouseover', (event) => {
    const target = tooltipOf(event)
    if (!target) return hide()
    if (target !== current) show(target)
  })
  ui.root.addEventListener('focusin', (event) => {
    const target = tooltipOf(event)
    if (target) show(target)
    else hide()
  })
  ui.root.addEventListener('mouseleave', hide, true)
  document.addEventListener('scroll', hide, true)
  ui.root.addEventListener('click', hide)
}

/* ──────────────────────────────────────────────────────────────── */
/* TOAST                                                            */
/* ──────────────────────────────────────────────────────────────── */

let toastTimer = null
export function toast(message, { error = false } = {}) {
  ui.root.querySelectorAll('e-toast').forEach(t => t.remove())
  const element = h('e-toast', {
    'data-state': 'opening',
    'data-type': error ? 'error' : 'info',
    'data-position': 'bottom-right',
    'data-color': 'light'
  }, h('div', {}, message))
  ui.layer.append(element)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => element.remove(), error ? 7000 : 3000)
}

export function showError(response) {
  const message = response && response.body && response.body.error
    ? response.body.error
    : 'Request failed'
  toast(message, { error: true })
}

/* ──────────────────────────────────────────────────────────────── */
/* DIALOGS                                                          */
/* ──────────────────────────────────────────────────────────────── */

/** Section title inside dialogs */
export function sectionTitle(text) {
  return h('h6', { is: 'e-h', 'data-color': 'muted', 'data-text-case': 'upper' }, text)
}

/**
 * e-ui dialog, styled like dialogs in apps: close icon in the corner (button[is="e-close-icon"]),
 * sticky <nav> head, padded body, optional sticky footer. Fields in `body` get e-ui styles,
 * because the body is a form[is="e-form"] (markup for styles only, it's never submitted).
 *
 * @param {{ title?: any, head?: any, body: any, footer?: any, small?: boolean, onClose?: () => void }} options
 */
export function openDialog({ title, head, body, footer, small = false, onClose }) {
  const dialog = h('dialog', { is: 'e-dialog', 'data-size': small ? 'small' : 'normal', 'data-ep': 'dialog' },
    h('div', {},
      h('button', { type: 'button', is: 'e-close-icon', 'aria-label': 'Close dialog', onclick: () => dialog.close() },
        h('img', { src: '/images/close.svg', alt: '', 'aria-hidden': 'true' })),
      h('nav', {},
        h('div', { 'data-padding': 'lg', 'data-ep': 'dialog-head' },
          head || h('h4', { is: 'e-h' }, title))
      ),
      h('form', { is: 'e-form', 'data-no-style': true, 'data-width': 'full', onsubmit: (event) => event.preventDefault() },
        h('div', { is: 'e-stack', 'data-gap': 'lg', 'data-padding': 'lg', 'data-ep': 'dialog-body' }, body)
      ),
      footer ? h('div', { is: 'e-row', 'data-gap': 'sm', 'data-padding': 'lg', 'data-justify-content': 'end', 'data-keep-flex-direction-row-in-mobile': true, 'data-ep': 'dialog-foot' }, footer) : null
    )
  )
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (onClose) onClose()
  })
  ui.layer.append(dialog)
  dialog.showModal()
  return dialog
}

/** Asks to confirm (like e-confirm), resolves with true / false */
export function confirmDialog({ title, message, confirmText = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let answered = false
    const answer = (value) => {
      answered = true
      resolve(value)
      dialog.close()
    }
    const confirmButton = h('button', { type: 'button', 'data-primary': true, 'data-fill': danger ? 'danger' : null, onclick: () => answer(true) }, confirmText)
    const dialog = openDialog({
      small: true,
      title,
      body: h('span', { is: 'e-text' }, message),
      footer: [
        h('button', { type: 'button', 'data-primary': true, 'data-fill': 'outlined', onclick: () => answer(false) }, 'Cancel'),
        confirmButton
      ],
      onClose: () => { if (!answered) resolve(false) }
    })
    confirmButton.focus()
  })
}

/* ──────────────────────────────────────────────────────────────── */
/* EDITOR LINKS                                                     */
/* ──────────────────────────────────────────────────────────────── */

/** Link that opens a file in the editor (Sublime by default) */
export function editorLink(label, file, line, search) {
  if (!file) return null
  return tooltip(`Open ${file}${line ? `:${line}` : ''} in the code editor`, h('a', {
    is: 'e-link',
    'data-underlined': true,
    href: '#',
    onclick: async (event) => {
      event.preventDefault()
      await openInEditor(file, line, search)
    }
  }, h('code', { is: 'e-code' }, label)), 'to-right')
}

export async function openInEditor(file, line, search) {
  const response = await api.openInEditor(file, line, search)
  if (response.statusCode !== 200) toast(response.body.error, { error: true })
}

/**
 * Iframe that renders html with the <head> of the page (styles, import map, EHTML...),
 * so e-ui styles apply and EHTML templates render. e-pages stays off inside (no ?dev=true).
 */
export function previewFrame(html, title = 'Preview') {
  const frame = h('iframe', { title, 'data-ep': 'preview' })
  frame.srcdoc = `<!DOCTYPE html><html><head><base href="${window.location.origin}/">${document.head.innerHTML}` +
    '<style>html { padding-top: 0 !important } body { margin: 0; padding: 16px }</style>' +
    `</head><body>${html}</body></html>`
  return frame
}
