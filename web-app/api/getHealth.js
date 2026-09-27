import fs from 'fs'

const { version } = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))

/**
 * GET /health
 * Used by bootstrap.sh / deploy.sh to check that the app is up.
 *
 * @param {import('#nodes/types.js').EndpointHandlerContext} context
 */
export default function getHealth({ stream, config }) {
  stream.respond({
    'content-type': 'application/json',
    ':status': 200
  })
  stream.end(JSON.stringify({
    status: 'ok',
    version,
    environment: config.env
  }))
}
