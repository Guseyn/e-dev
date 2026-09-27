// Styles of the editor UI (inside its shadow root).
// The UI is built from e-ui (is="e-stack", is="e-row", data-gap, button[data-primary]...):
// e-ui.css is loaded into the shadow root with :root → :host, so its tokens don't depend
// on the page. Rules below cover only what e-ui has no notion of (the fixed bar, dropdown,
// overlays on the page, sizes inside dialogs), and use data-ep attributes instead of classes.

export async function editorStyleSheets() {
  const sheets = []
  try {
    const response = await fetch('/css/e-ui.css')
    const eui = new CSSStyleSheet()
    eui.replaceSync((await response.text()).replaceAll(':root', ':host'))
    sheets.push(eui)
  } catch (error) {
    console.warn('[e-pages] Could not load /css/e-ui.css, editor UI will be unstyled', error)
  }
  const own = new CSSStyleSheet()
  own.replaceSync(css)
  sheets.push(own)
  return sheets
}

const css = /* css */`
:host {
  all: initial;
  font-family: var(--e-font-interface);
  font-size: var(--e-font-size-sm);
  line-height: 1.4;
  color: var(--e-fg);
}

/* ── Fixed bar with the search field (element + attribute selectors win over e-ui's div[is="e-card"]) */
div[is][data-ep="bar"] {
  position: fixed;
  top: var(--e-spacing-md);
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 2 * var(--e-spacing-md)));
  max-width: none;
  z-index: 2147483000;
}
[data-ep="search"], form[is][data-ep="search"] { position: relative; flex: 1; width: auto; min-width: 0; }
[data-ep="bar"] [data-ep="results"] {
  position: absolute; left: 0; right: 0; top: calc(100% + var(--e-spacing-md));
  max-height: min(60vh, 540px);
  padding: var(--e-spacing-xs);
  background: var(--e-surface-bg);
  border: 1px solid var(--e-divider);
  border-radius: var(--e-radius-lg);
  box-shadow: var(--e-shadow-lg);
}
[data-ep="results"] { overflow: auto; max-height: 320px; margin: var(--e-spacing-xs) 0 0; }

/* Rows of results and children: transparent accent + border on hover, like other e-ui states */
[data-ep="results"] li {
  border: 1px solid transparent;
  border-radius: var(--e-radius-md);
  padding: var(--e-spacing-xs) var(--e-spacing-sm);
}
/* Children of the inspected element: bordered rows with room on the right for the buttons */
[data-ep="children"] { display: flex; flex-direction: column; gap: var(--e-spacing-xs); padding: 0; margin: 0; }
[data-ep="children"] li[is="e-list-item"] {
  border: 1px solid var(--e-divider);
  border-radius: var(--e-radius-md);
  padding: var(--e-spacing-xs) var(--e-spacing-md) var(--e-spacing-xs) var(--e-spacing-sm);
}
/* Smaller icon buttons inside rows of lists */
[data-ep="children"] button[is="e-with-icon"],
[data-ep="tree"] button[is="e-with-icon"] { width: 1.75rem; height: 1.75rem; }
[data-ep="children"] button[is="e-with-icon"] img,
[data-ep="tree"] button[is="e-with-icon"] img { width: 0.95rem; height: 0.95rem; }
[data-ep="results"] li[is="e-list-item"]:hover,
[data-ep="results"] li[is="e-list-item"][aria-selected="true"],
[data-ep="children"] li[is="e-list-item"][data-ep="child"]:hover {
  background-color: color-mix(in srgb, var(--e-primary) 10%, transparent);
  border-color: var(--e-primary);
}
[data-ep="item-icon"] {
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  width: 2rem; height: 2rem;
  border: 1px solid var(--e-divider); border-radius: var(--e-radius-md);
  background: var(--e-muted-bg);
}
[data-ep="item-icon"] img { width: 1.1rem; height: 1.1rem; opacity: 0.8; }
[data-ep="item-icon"][data-special] { background: var(--e-primary-transparent-accent-bg); border-color: var(--e-primary); }

/* Icon buttons: compact, same size everywhere */
/* Same height as e-ui inputs (2.25rem), centered next to them */
button[is="e-with-icon"] { width: 2.25rem; height: 2.25rem; padding: 0; box-shadow: none; align-self: center; }
button[is="e-with-icon"] img { width: 1.1rem; height: 1.1rem; }
button[is="e-with-icon"]:disabled { opacity: 0.35; cursor: default; }
e-tooltip { display: inline-flex; }
/* e-ui's CSS tooltips are clipped by dialogs, a popover is used instead (see startTooltips) */
e-tooltip:hover::after, e-tooltip:hover::before { display: none !important; }
[data-ep="tooltip"] {
  position: fixed; inset: auto; margin: 0; border: none;
  max-width: 320px; padding: var(--e-spacing-xs) var(--e-spacing-sm);
  background: var(--e-tooltip-bg); color: var(--e-tooltip-fg);
  border-radius: var(--e-tooltip-radius);
  font-family: var(--e-font-interface); font-size: var(--e-font-size-xs); line-height: 1.3;
  pointer-events: none;
}

/* ── Dialogs: smaller, calmer text; e-ui gives fields a fixed height, code needs more room */
dialog[is="e-dialog"] { max-width: min(760px, calc(100vw - 2 * var(--e-spacing-md))); }
dialog[is="e-dialog"] > div { font-size: var(--e-font-size-xs); }
dialog[is="e-dialog"] nav { border-bottom: 1px solid var(--e-divider); }
[data-ep="dialog-head"] { padding-right: calc(var(--e-img-xs) + 2 * var(--e-spacing-md)) !important; }
dialog[is="e-dialog"] h4[is="e-h"] { font-size: var(--e-font-size-lg); margin: 0; }
dialog[is="e-dialog"] h6[is="e-h"] { font-size: var(--e-font-size-2xs); letter-spacing: 0.06em; margin: 0; }
dialog[is="e-dialog"] form[is="e-form"] label input,
dialog[is="e-dialog"] form[is="e-form"] label select,
dialog[is="e-dialog"] form[is="e-form"] label textarea,
[data-ep="bar"] input {
  font-size: var(--e-font-size-sm);
}
button[data-primary] { font-size: var(--e-font-size-sm); padding: var(--e-spacing-md); }
textarea { height: auto !important; min-height: 4rem; font-family: var(--e-font-mono); font-size: var(--e-font-size-xs) !important; }
[data-ep="dialog-foot"] {
  position: sticky; bottom: 0; background: var(--e-surface-bg);
  border-top: 1px solid var(--e-divider);
}
pre[is="e-pre"] { max-height: 180px; overflow: auto; white-space: pre-wrap; margin: 0; font-size: var(--e-font-size-xs); }
dialog[is="e-dialog"] span[is="e-muted"],
dialog[is="e-dialog"] span[is="e-text"] { font-size: var(--e-font-size-sm); }
dialog[is="e-dialog"] form[is="e-form"] label input[type="color"] {
  width: 2.25rem; min-width: 2.25rem; height: 2.25rem; padding: 2px; border-radius: var(--e-radius-md);
}

/* ── Overlays on the page: hover outline, inspect chip, drop targets */
[data-ep="outline"] {
  position: fixed; pointer-events: none; z-index: 2147482000; display: none;
  border: 2px solid var(--e-primary); border-radius: var(--e-radius-sm);
  background: var(--e-primary-transparent-accent-bg);
}
[data-ep="inspect-chip"] { position: fixed; z-index: 2147482500; display: none; gap: var(--e-spacing-2xs); }
[data-ep="inspect-chip"] img { width: 0.9rem; height: 0.9rem; filter: invert(1); }
[data-ep="drop-line"] {
  position: fixed; pointer-events: none; z-index: 2147482600; display: none;
  height: 4px; border-radius: 2px; background: var(--e-success);
}
[data-ep="drop-box"] {
  position: fixed; pointer-events: none; z-index: 2147482600; display: none;
  border: 2px dashed var(--e-success); border-radius: var(--e-radius-md);
}
[data-ep="drop-label"] { position: fixed; pointer-events: none; z-index: 2147482700; display: none; }
[data-ep="banner"] {
  position: fixed; bottom: var(--e-spacing-lg); left: 50%; transform: translateX(-50%); z-index: 2147483000;
}
e-toast { z-index: 2147483100; }
[data-ep="forms-host"] { display: none; }

/* Tiles of elements to add (inspector tabs) and rows of the page tree */
[data-ep="element-tile"], [data-ep="tree-row"] {
  display: flex; align-items: center; gap: var(--e-spacing-sm);
  width: 100%; text-align: left; cursor: pointer; font: inherit; color: inherit;
  background: var(--e-surface-bg);
  border: 1px solid var(--e-divider); border-radius: var(--e-radius-md);
  padding: var(--e-spacing-sm);
}
[data-ep="tree-row"] { border-color: transparent; padding-right: var(--e-spacing-md); cursor: pointer; }
[data-ep="tree-label"] { cursor: pointer; }
/* Collapsible nodes of trees: chevron on the left (buttons are on the right), no heavy borders */
[data-ep="tree"] details[is="e-details"] { border: none; background: none; }
[data-ep="tree"] details[is="e-details"] > summary { padding: 0 0 0 1.5rem; font-weight: normal; }
[data-ep="tree"] details[is="e-details"] > summary::after { left: 0.35rem; right: auto; }
[data-ep="tree"] details[is="e-details"] > div { padding: 0 0 0 var(--e-spacing-lg); overflow: visible; }
[data-ep="tree-leaf"] { padding-left: 1.5rem; }
[data-ep="element-tile"]:hover, [data-ep="tree-row"]:hover {
  background-color: color-mix(in srgb, var(--e-primary) 10%, transparent);
  border-color: var(--e-primary);
}
[data-ep="elements"] {
  display: grid; gap: var(--e-spacing-sm);
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
}
[data-ep="elements"] e-tooltip { display: flex; min-width: 0; }
[data-ep="tabs"] button[aria-selected="true"] { pointer-events: none; }
textarea[data-ep="html-editor"] { min-height: 22rem; white-space: pre; tab-size: 2; }
iframe[data-ep="preview"] {
  width: 100%; height: 260px; border: 1px solid var(--e-divider); border-radius: var(--e-radius-md); background: var(--e-bg);
}
`
