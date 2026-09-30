// Styles of the e-dev UI (inside its shadow root).
// e-ui.css is loaded into the shadow root with :root → :host, so its tokens don't depend
// on the page. Rules use data-ed attributes instead of classes.

export async function styleSheets() {
  const sheets = []
  try {
    const response = await fetch('/css/e-ui.css')
    const eui = new CSSStyleSheet()
    eui.replaceSync((await response.text()).replaceAll(':root', ':host'))
    sheets.push(eui)
  } catch (error) {
    console.warn('[e-dev] Could not load /css/e-ui.css, e-dev UI will be unstyled', error)
  }
  const own = new CSSStyleSheet()
  own.replaceSync(css)
  sheets.push(own)
  return sheets
}

const css = /* css */`
:host {
  all: initial;
  font-family: var(--e-font-interface, system-ui, sans-serif);
  font-size: 12px;
  line-height: 1.4;
  color: var(--e-fg, #111);
}

/* Overlays are popovers (top layer, above modal dialogs of the page): no UA popover box */
[popover] { margin: 0; inset: auto; padding: 0; border: none; overflow: visible; }

/* ── Hovered element (while Alt is held) */
[data-ed="outline"] {
  position: fixed; pointer-events: none; box-sizing: border-box;
  border: 2px solid var(--e-primary, #2563eb); border-radius: 2px;
  background: color-mix(in srgb, var(--e-primary, #2563eb) 12%, transparent);
}

/* ── Chain of the hovered element, next to it */
[data-ed="chip"] {
  position: fixed; pointer-events: none;
  max-width: min(720px, calc(100vw - 16px));
  padding: 4px 8px; border-radius: 6px;
  background: #111827; color: #f9fafb;
  font-family: var(--e-font-mono, ui-monospace, monospace); font-size: 11px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
}
[data-ed="chip"] [data-ed="step"] { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-ed="chip"] [data-ed="step"][data-self] { color: #93c5fd; }
[data-ed="chip"] [data-ed="step"][data-action] { color: #fcd34d; }
[data-ed="chip"] [data-ed="sep"] { opacity: 0.5; margin-right: 4px; }
[data-ed="chip"] [data-ed="hint"] { display: block; opacity: 0.6; margin-top: 2px; font-family: var(--e-font-interface, system-ui, sans-serif); }

/* ── Pinned panel (Alt+Shift+click): a popover, or a modal dialog when the page has one open */
dialog[data-ed="panel"] {
  position: fixed; inset: auto 12px 12px auto; margin: 0; box-sizing: border-box;
  width: min(560px, calc(100vw - 24px)); max-width: none; max-height: min(75vh, 720px); overflow: auto;
  padding: 12px; border-radius: 10px;
  background: var(--e-surface-bg, #fff); color: var(--e-fg, #111);
  border: 1px solid var(--e-divider, #e5e7eb);
  box-shadow: 0 8px 32px rgb(0 0 0 / 20%);
}
dialog[data-ed="panel"]::backdrop { background: transparent; }
[data-ed="panel-head"] { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
[data-ed="panel-head"] strong { font-size: 13px; font-family: var(--e-font-mono, ui-monospace, monospace); }
[data-ed="panel-head"] [data-ed="where"] { margin-right: auto; opacity: 0.6; font-family: var(--e-font-mono, ui-monospace, monospace); font-size: 11px; }
[data-ed="panel"] h6 { margin: 12px 0 4px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; }
[data-ed="panel"] ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
[data-ed="row"] {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  padding: 4px 6px; border: 1px solid transparent; border-radius: 6px;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
[data-ed="row"]:hover { border-color: var(--e-primary, #2563eb); background: color-mix(in srgb, var(--e-primary, #2563eb) 8%, transparent); }
[data-ed="row"][data-self] { font-weight: 600; }
[data-ed="row"][data-action] code { font-style: italic; }
[data-ed="row"] code { font-family: var(--e-font-mono, ui-monospace, monospace); font-size: 11px; }
[data-ed="row"] [data-ed="where"] { margin-left: auto; opacity: 0.6; white-space: nowrap; font-family: var(--e-font-mono, ui-monospace, monospace); font-size: 11px; }
[data-ed="link"] { padding-left: 22px; }
/* Tree of elements inside: chevron of <details> on the left, rows open the editor, ⌖ pins */
[data-ed="tree"] ol, [data-ed="tree"] details ol { list-style: none; padding-left: 14px; margin: 0; }
/* e-ui styles every <details> as a card with a chevron on the right */
[data-ed="tree"] details, [data-ed="tree"] details[open] { border: none; border-radius: 0; background: none; cursor: default; }
[data-ed="tree"] details > summary::after { content: none; }
[data-ed="tree"] details > summary { list-style: none; position: relative; padding: 0 0 0 14px; font-weight: normal; cursor: pointer; }
[data-ed="tree"] details > summary::-webkit-details-marker { display: none; }
[data-ed="tree"] details > summary::before { content: '▸'; position: absolute; left: 0; top: 5px; font-size: 10px; opacity: 0.6; }
[data-ed="tree"] details[open] > summary::before { content: '▾'; }
[data-ed="leaf"] { padding-left: 14px; }
[data-ed="tree-row"] { display: flex; align-items: center; gap: 4px; }
[data-ed="tree-row"] [data-ed="row"] { flex: 1; min-width: 0; }
[data-ed="tree-row"] [data-ed="row"] code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-ed="pin"] {
  flex: 0 0 auto; border: 1px solid transparent; border-radius: 6px; background: none; color: inherit;
  cursor: pointer; font-size: 13px; line-height: 1; padding: 3px 6px; opacity: 0.6;
}
[data-ed="pin"]:hover { opacity: 1; border-color: var(--e-primary, #2563eb); }
[data-ed="close"] { border: none; background: none; cursor: pointer; font-size: 16px; line-height: 1; color: inherit; opacity: 0.6; }
[data-ed="close"]:hover { opacity: 1; }

[data-ed="toast"] {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483100;
  padding: 8px 12px; border-radius: 8px; background: #111827; color: #f9fafb; font-size: 12px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
}
[data-ed="toast"][data-error] { background: #b91c1c; }
`
