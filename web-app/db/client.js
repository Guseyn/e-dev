import fs from 'fs'

/**
 * Creates a PostgreSQL connection pool from `config.db`.
 * Returns `null` when the app has no database configured,
 * so the blueprint can run without any database at all.
 *
 * @param {any} config
 * @param {{ max?: number }} [options]
 */
export default async function createDbClient(config, { max = 20 } = {}) {
  if (!config.db) {
    return null
  }

  const { default: pg } = await import('pg')
  const { Pool, types } = pg

  // Keep dates and times as raw strings instead of JS Date objects
  types.setTypeParser(types.builtins.DATE, (value) => value)
  types.setTypeParser(types.builtins.TIME, (value) => value)
  types.setTypeParser(types.builtins.TIMESTAMP, (value) => value)
  types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => value)

  const dbClient = new Pool({
    ...connectionOptions(config),
    // Every process (primary + each worker) has its own pool,
    // so total connections = max * (number of workers + 1)
    max: config.db.maxConnectionsPerProcess || max,
    idleTimeoutMillis: 30000
  })

  dbClient.on('connect', (client) => {
    client.query('SET TIME ZONE \'UTC\'')
  })

  return dbClient
}

/**
 * @param {any} config
 * @param {string} [database]
 */
export function connectionOptions(config, database) {
  return {
    user: config.db.user,
    password: config.db.password,
    host: config.db.host,
    port: config.db.port,
    database: database || config.db.database,
    ssl: (
      config.db.sslmode === 'require'
        ? {
          rejectUnauthorized: true,
          ca: config.db.capath ? fs.readFileSync(config.db.capath).toString() : undefined
        }
        : false
    )
  }
}
