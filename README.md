# e-pages

Toolkit for building web applications with [EHTML](https://e-html.org) + [e-ui](https://github.com/Guseyn/e-ui) + [nodes](https://github.com/Guseyn/nodes.js).

It's a blueprint for new apps, and a source of parts to bring into existing ones:

- **Server**: nodes (HTTP/2, cluster of workers, zero-downtime restarts), one handler per file in `web-app/api`.
- **Frontend**: EHTML + e-ui, served as plain files, no build step.
- **e-pages editor**: open any page locally with `?dev=true` to add, edit, move and delete elements visually, and jump from any element to its code in your editor.
- **Deploy**: `bootstrap.sh` sets up any Linux VPS (Docker, firewall, GitHub deploy key, Let's Encrypt), `deploy.sh` deploys changes.

## Quick start

```bash
npm install
npm start            # https://127.0.0.1:4200 (self-signed certificate)
```

Open https://127.0.0.1:4200/?dev=true to edit the page with e-pages.

## Structure

```
nodes/                       nodes framework (shadow copy, see "Updating libraries")
web-app/
  main.js                    starts primary process + workers
  primary.js                 runs once: cache versions, migrations, background jobs
  worker.js                  runs in each worker: server with routes
  routes.js                  all endpoints and static files (e-pages reads it too)
  restart.js                 zero-downtime restart of workers (npm run restart)
  pull.js                    after git pull on a server: updates ?v= cache versions
  cache.js                   updates ?v= cache versions in static files
  logo.txt
  api/                       endpoint handlers, one per file
    e-pages/                 e-pages editor API (local environment only)
  env/                       config per environment: local.json (tracked), prod.example.json
  db/                        client.js, migrations/NNN_name.sql, schema/ (generated snapshot)
  runners/migrate.js         runs migrations (npm run migrate, and on start/restart)
  jobs/                      background jobs (registered in primary.js)
  utils/
  ssl/                       temporary certificate; Let's Encrypt writes live/<domain>/ here
  static/
    html/                    pages; html/templates/ for e-wrapper templates
    json/e-pages/            e-pages models of pages (not served)
    js/ehtml/ js/e-ui/       libraries (shadow copies)
    js/e-pages/              e-pages editor (loader.js, editor, catalog/)
    images/icons/            Google Material Symbols (Apache 2.0) used by the editor and element presets
    css/ font/ images/ md/ xml/
scripts/                     vendor.sh (library updates), catalog-check.js, lib/
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
| `npm run e-pages:update` | In other projects: bring the e-pages editor from this repo |
| `npm run catalog:check` | Warn about EHTML / e-ui elements missing from the e-pages catalog |

Every update is recorded in `vendor.lock.json` (source, ref, commit).

> The `nodes/` copy has fixes that are not in nodes.js yet (see "nodes fixes" below).
> Don't run `nodes:update` until they are upstream, it would overwrite them.

## e-pages editor

Include the loader on a page (new pages created by e-pages have it):

```html
<script type="module">
  import '#ehtml/main'
  import '#e-pages/loader.js'
</script>
```

The loader does nothing unless the url has `?dev=true`, and it starts the editor only on `localhost` / `127.0.0.1`.
On other hosts it just logs a warning. The e-pages API exists only when the app runs with `ENV=local`,
and it accepts requests only from this machine. To leave dev mode, remove `?dev=true` from the url.

In dev mode:

- **Top bar** (press `/`): **Modify This Page**, **See Full Tree**, **Add New Page**, **Add New Template**,
  **Edit CSS Variables**. Icon buttons next to it do the same, plus undo, redo and opening the file in the code editor.
- **Modify This Page** opens `<body>` in the inspector. It walks the page model, not the rendered DOM, so templates
  and `e-json` (which disappear after rendering) are reachable. Click children to go deeper, use ← / → for history.
  - **Info**: code links, text, declared events and state (and the EHTML scoped state of the rendered element), move, delete
  - **Attributes**: edit attributes (with suggestions from the catalog)
  - **CSS**: inline style of the element, one declaration per line
  - **Children**: the collapsible **subtree** (move, delete, open in code editor, add inside for every element; text nodes too),
    a **preview** of the element with its subtree (rendered with the page's styles and EHTML), **Edit as HTML**
    (the inner html is parsed back into the page model on save), and **Add element inside…**: a dialog with EHTML,
    e-ui and HTML tabs (HTML has plain **Text** too). Search, pick a tile (suggested ones first for the context, like
    `<option>` in `<select>` or fields in `e-form`), fill in attributes, preview it, and **Place inside**:
    the dialogs close and the subtree shows the new element.
- **See Full Tree**: every element of the page (head and body), collapsible, with a filter: open, add inside, delete, or go to the code of any element.
- **Code links**: every element links to its line in the html file, its component source, and,
  for `data-src` / `data-request-url`, the handler file of the endpoint (resolved from `web-app/routes.js`).
  Links open in the editor from `ePages.editor` in `web-app/env/local.json` (`subl` by default, also `code`, `zed`),
  through a local endpoint, so no `subl://` protocol handler is needed.
- **Undo / Redo**: ⌘Z / ⌘⇧Z (Ctrl on Linux and Windows) or the buttons in the bar (last 50 changes are kept).
- **Edit CSS Variables**: override e-ui variables (colors, fonts, spacing...) with a live preview (the editor UI follows them too).
  They are saved in a marked `:root` block at the end of `web-app/static/css/app.css`.
- New elements come with placeholder content (a card with a title and text, a sidebar with links and a ⇧S toggle,
  a dialog with a close icon and buttons...) and icons where components need them.
- Scripts of e-ui components (like `#e-ui/e-sidebar.js`) are imported automatically, from the elements themselves
  (also when written with "Edit as HTML"):
  - in the page where they are added;
  - for templates (no `<head>`): in every page that shows the template with `e-wrapper` / `e-html`, and in the
    template preview in dev mode;
  - a page opened in dev mode gets imports it misses (for example, of components in its templates).
- Links keep `?dev=true` when you navigate.

How it works:

- Each page has a JSON model in `web-app/static/json/e-pages/`. Every change updates the model, then
  the html file is generated from it (readable, formatted html, multi-line attributes kept).
- If you edit the html file by hand (or the page has no model yet), e-pages re-imports it into the
  model the next time you open it. Your edits are never overwritten. The file is reformatted only when
  you change it through e-pages.
- The dev server serves pages with `data-eid` attributes, so the editor knows which model element is
  under the pointer. Files on disk don't have them.
- All changes are sent with EHTML's `e-form`.
- Elements from e-ui that need a script (like `e-toast`) get their `import` added to the page automatically.
- The catalog of elements is in `web-app/static/js/e-pages/catalog/*.json`.
- The editor UI is built from e-ui (`is="e-stack"`, `button[data-primary]`, `dialog[is="e-dialog"]`...):
  `e-ui.css` is loaded into its shadow root. Its own CSS (`styles.js`) covers only the bar and page overlays,
  with `data-ep` attributes, no classes. Pages follow the same rule: e-ui attributes instead of classes.

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
