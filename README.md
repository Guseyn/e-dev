# e-dev

Toolkit for building web applications with [EHTML](https://e-html.org) + [e-ui](https://github.com/Guseyn/e-ui) + [nodes](https://github.com/Guseyn/nodes.js).

It's a blueprint for new apps, and a source of parts to bring into existing ones:

- **Server**: nodes (HTTP/2, cluster of workers, zero-downtime restarts), one handler per file in `web-app/api`.
- **Frontend**: EHTML + e-ui, served as plain files, no build step.
- **e-dev**: open any page locally with `?dev=true`, then Alt + click any element to open its line in your editor (Sublime by default). This works through `e-wrapper`, `e-html`, `e-for-each`, `e-if` and other templates.
- **Deploy**: `bootstrap.sh` sets up any Linux VPS (Docker, firewall, GitHub deploy key, Let's Encrypt), `deploy.sh` deploys changes.

## Quick start

```bash
npm install
npm start            # https://127.0.0.1:4200 (self-signed certificate)
```

Open https://127.0.0.1:4200/?dev=true and Alt + click any element to open it in Sublime.

## Structure

```
nodes/                       nodes framework (shadow copy, see "Updating libraries")
web-app/
  main.js                    starts primary process + workers
  primary.js                 runs once: cache versions, migrations, background jobs
  worker.js                  runs in each worker: server with routes
  routes.js                  all endpoints and static files (e-dev reads it too)
  restart.js                 zero-downtime restart of workers (npm run restart)
  pull.js                    after git pull on a server: updates ?v= cache versions
  cache.js                   updates ?v= cache versions in static files
  logo.txt
  api/                       endpoint handlers, one per file
    e-dev/                 e-dev API (local environment only)
  env/                       config per environment: local.json (tracked), prod.example.json
  db/                        client.js, migrations/NNN_name.sql, schema/ (generated snapshot)
  runners/migrate.js         runs migrations (npm run migrate, and on start/restart)
  jobs/                      background jobs (registered in primary.js)
  utils/
  ssl/                       temporary certificate; Let's Encrypt writes live/<domain>/ here
  static/
    html/                    pages; html/templates/ for e-wrapper templates
    js/ehtml/ js/e-ui/       libraries (shadow copies)
    js/e-dev/              e-dev (loader.js, tracker.js, inspect.js, styles-of.js)
    images/icons/            Google Material Symbols (Apache 2.0)
    css/ font/ images/ md/ xml/
scripts/                     vendor.sh (library updates), lib/
bootstrap.sh deploy.sh       VPS setup and deploy
Dockerfile docker-compose.yml
```

## Scripts

| Script | What it does |
|---|---|
| `npm start`, `npm run start:prod` | Start the app (`ENV=local` by default) |
| `npm run restart`, `restart:prod` | Restart workers one by one (zero downtime), runs migrations first |
| `npm run pull:prod` | Update `?v=` cache versions after `git pull` |
| `npm run migrate` | Run migrations (skipped if config has no `db`) |
| `npm run lint` | ESLint |
| `npm run nodes:update`, `ehtml:update`, `eui:update` | Update a library from GitHub (`-- <ref>` for a tag/commit, default branch otherwise) |
| `npm run nodes:local:update`, `ehtml:local:update`, `eui:local:update` | Update from a local checkout (`../nodes.js`, `../EHTML`, `../e-ui`, or `NODES_PATH`, `EHTML_PATH`, `EUI_PATH`) |
| `npm run *:local:reverse` | Copy this project's copy back into the local checkout |
| `npm run e-dev:update` | In other projects: bring e-dev from this repo |

Every update is recorded in `vendor.lock.json` (source, ref, commit).

> The `nodes/` copy has fixes that are not in nodes.js yet (see "nodes fixes" below).
> Don't run `nodes:update` until they are upstream, it would overwrite them.

## e-dev

e-dev takes you from any element on the page to the line where it's written, even when the element
was rendered by a template (`e-wrapper`, `e-html`, `e-for-each`, `e-if`, templates released by
`mapToTemplate()` into `data-insert-into` slots...), rendered from markdown (`e-markdown`),
or created by a script (the generated parts of e-ui components, like the drop zone of `e-file-upload`).

Include the loader on a page, or let dev mode add it for you (see below):

```html
<script type="module">
  import '#ehtml/main'
  import '#e-dev/loader.js'
</script>
```

The loader does nothing unless the url has `?dev=true`. It works only on `localhost` / `127.0.0.1`,
and on other hosts it just logs a warning. The e-dev API exists only when the app runs with `ENV=local`,
and it accepts requests only from this machine. Dev mode stays on when you navigate: links,
`redirect()` and `location.href = ...` get `?dev=true`.

In dev mode (Alt is ⌥ Option on a Mac):

| Keys | What happens |
|---|---|
| **Alt + hover** | Outlines the element under the pointer, at any depth (also in modal dialogs, iframes and elements created by scripts), and shows how it appeared in the page, outermost first, one step per line (see below) |
| **Alt + ↑ / ↓** | Selects the parent / goes back down (or to the first child) |
| **Alt + ← / →** | Selects the previous / next sibling |
| **Alt + click** | Opens the element at its line and column in the editor. Elements created by scripts open the element that generated them (`<template is="e-file-upload">`, `<input is="e-date">`...) or the one they stand for (a button of the `e-tabs` nav opens its `<e-tab>`), markdown opens its line in the `.md` file. |
| **Alt + Enter** | The same for the selected element (disabled controls get no clicks) |
| **Alt + Shift + click**, **Alt + Shift + Enter** | Pins the element in a panel |
| **Esc** | Closes the panel |

How an element appeared in the page, for example:

```
test.html:70 <e-json> (GET /health → 200)
↳ mapToTemplate('#health-template')
↳ test.html:76 <template#health-template>
↳ test.html:77 <b>
```

and for the own content of an `e-wrapper` (it's written in the page, the wrapper only places it into the template):

```
index.html:33 <template is="e-wrapper"> (placed inside #content of html/templates/account-new.html)
↳ index.html:38 <span is="e-badge">
```

- templates show what released them: the action of an element (`data-actions-on-response` of `e-json`...) or
  an event (`onclick="mapToTemplate(...)"`), the call, and the request of the response;
- `e-wrapper` shows whether the element came with the wrapped template (its request), or is the wrapper's own
  content, placed into a slot of that template;
- `e-for-each` shows the item.

The panel shows, and opens in the editor:

- **Rendered by**: the chain, with the item of `e-for-each`, the request of the response it was rendered from,
  and files that `data-src` / `data-request-url` point to (templates, markdown, endpoint handlers resolved from
  `web-app/routes.js`, or from `data-endpoint-handler` / `data-src-pattern` / `data-request-url-pattern` hints);
- **Created by script**: the line of JS that created the element (e-ui components, your scripts);
- **Related**: what generated parts stand for (the button of an `e-tabs` nav selects its `<e-tab>`, and back);
- **Component**: where the custom element is defined (`customElements.define`);
- **State**: EHTML state of the element, the state `mapToTemplate()` released it with, `internalState`;
- **Request**: the request it was rendered from, with its response;
- **Styles**: rules of the page stylesheets that apply to it (`[is="e-stack"]`, `[data-gap]`... in `e-ui.css`);
- **Ancestors in the file**, and a tree of everything **Inside** it (⌖ pins an element, ↑ pins the parent).

The outline, the chain and the panel are shown in the top layer, so they are above modal dialogs of the page.

The editor is `eDev.editor` in `web-app/env/local.json`: `subl` (default), `code` or `zed`.
It's started through a local endpoint, so you don't need a `subl://` protocol handler.
From the console: `eDev.chainOf(element)`, `eDev.sourceOf(element)`, `eDev.pin(element)`.

How it works:

- **Source locations.** In dev mode the server adds `data-e-src="<file>:<line>:<column>"` to every element:
  - in the page (`/?dev=true`, `/html/...html?dev=true`);
  - in html that the page fetches (`/html/...html` requested from a dev page, recognised by its referer).

  Nothing else in the html changes, so lines match the files on disk (lines of inline scripts too),
  and the files themselves are never changed.
- **Rendered elements keep them.** EHTML clones templates, sets `innerHTML` or unwraps children, and it
  keeps attributes that have no `${...}`. So every clone from `e-for-each` points to its line in the template.
- **The chain.** Elements that render (templates, `e-html`, `e-json`...) remove themselves from the page.
  `tracker.js` starts before EHTML and remembers where nodes came from:
  - clones of `template.content` are linked to their template when they are made, wherever they are placed;
  - other insertions (`e-html`, `e-markdown`, e-ui components that replace their template, unwrapping) are
    seen by a MutationObserver (in open shadow roots too);
  - nodes inserted while EHTML handles a response are linked to the request, requests to the element
    that made them;
  - `mapToTemplate()` / `releaseTemplate()` calls are linked to the action or event that made them (EHTML runs
    actions with `new Function`, applied to their element);
  - `createElement` / `innerHTML` / `customElements.define` remember the line of JS that called them;
  - `e-markdown` output gets `<!-- e-src:<md file>:<line> -->` comments before each block.

  The server adds the templates that the element is written inside of in its own file (`/e-dev/source-chain`).
- **Pages don't need to be changed.** In dev mode, the `#e-dev/` import map entry and the loader are added
  to the served html only.

## Adding e-dev to an existing app

For example, InstruxMusic (nodes + EHTML + e-ui, routes in `worker.js`):

1. Copy the client and its API (InstruxMusic has this as `npm run e-dev:update`):
   `web-app/static/js/e-dev/` → same path, `web-app/api/e-dev/` → e.g. `web-app/endpoint-handlers/e-dev/`.
2. Register the endpoints in local environment only, before other endpoints:
   ```js
   const eDevApi = process.env.ENV === 'local'
     ? (await import('#web-app/endpoint-handlers/e-dev/routes.js')).default(global.config)
     : []
   // api: [...eDevApi, endpoint(...), ...]
   ```
3. Describe the app in `package.json` (everything is optional, defaults fit this blueprint):
   ```json
   "e-dev": {
     "routesFile": "web-app/worker.js",
     "indexPage": "html/landing.html"
   }
   ```
   The code editor is `eDev.editor` in `web-app/env/local.json` (`subl` by default).
4. Open any page with `?dev=true`. Pages and templates must be under `web-app/static/html` and served from `/html/`.

Notes:
- The API accepts requests only from localhost. With older copies of nodes (without `remoteAddress`),
  that works over HTTP/2, which browsers use for this https server.

## Deploy

1. Create `web-app/env/prod.json` from `web-app/env/prod.example.json` (domain, certificate paths, db).
2. Point your domain's DNS to the server.
3. Run `./bootstrap.sh` and answer the questions (saved to `deploy/prod.conf`).
   It's safe to re-run, and every step can run alone: `./bootstrap.sh --env prod --only ssl`.
   Steps: preflight → system → docker → firewall → user → git → clone → start → ssl → check.
4. Deploy changes with `./deploy.sh`, or `./deploy.sh <pull|restart|rerun|env|logs|status|stop> prod`:
   - `pull`: static changes (no restart)
   - `restart`: code used by workers (zero downtime)
   - `rerun`: `main.js`, `primary.js`, jobs, dependencies, Dockerfile (rebuilds the image)
   - `env`: upload the env config and rerun

One app per server: Node serves HTTPS on 443 itself, and the nodes proxy on port 80 redirects to HTTPS and serves Let's Encrypt challenges.

## nodes fixes (to be upstreamed to nodes.js)

Changed files in `nodes/`:

- `defaultSrcMapper.js`, `pathByUrl.js`, `handleRequests.js`: static files can't be read outside `baseFolder` (encoded `..` in urls).
- `proxyServer.js`: ACME challenge paths are validated. The redirect has no `:443` and no duplicated port.
- `disconnectAndExitAllWorkersWithTimeoutRecursively.js`: `restartTime` is in milliseconds (was multiplied by 1000). Already-disconnected workers no longer stop the restart chain.
- `isEndpointMatchedWithRequestUrlAndMethod.js`: no longer appends `,OPTIONS` to `endpoint.method` on every request.
- `updateCacheVersionsInUrls.js`: versioned module imports get new hashes, and urls don't get `?v=` appended again.
- `server.js`: the HTTP proxy runs in every non-local environment. Removed the unused IPC listener.
- `cluster.js`: SIGINT/SIGTERM are passed to workers (`docker stop` and `kill` no longer hang).
- `emulateStreamForHttp1.js`, `handleRequests.js`, `types.js`: handlers get `remoteAddress`.
