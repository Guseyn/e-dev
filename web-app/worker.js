import runtime from '#nodes/runtime.js'
import server from '#nodes/server.js'
import app from '#nodes/app.js'

import routes from '#web-app/routes.js'
import createDbClient from '#web-app/db/client.js'

/* ──────────────────────────────────────────────────────────────── */
/* SHARED DEPENDENCIES FOR HANDLERS                                 */
/* ──────────────────────────────────────────────────────────────── */
// `null` if there is no "db" in config
const dbClient = await createDbClient(runtime.config)

/* ──────────────────────────────────────────────────────────────── */
/* SERVER ENTRY POINT                                               */
/* ──────────────────────────────────────────────────────────────── */
const { indexFile, api, static: staticFiles } = await routes(runtime.config)

server(
  app({
    indexFile,
    api,
    static: staticFiles,
    deps: {
      dbClient
    }
  })
)()
