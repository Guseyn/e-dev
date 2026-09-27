import body from '#nodes/body.js'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Wraps an e-pages handler:
 *  - allows requests only from this machine (the API is registered only locally too)
 *  - parses JSON body for POST requests
 *  - responds with JSON, errors become { error } with their status code
 *
 * @param {function(any): Promise<any>|any} fn receives context + `body`, returns response object
 */
export default function handler(fn) {
  return async function ePagesHandler(context) {
    const { stream, remoteAddress } = context
    try {
      if (!LOOPBACK_ADDRESSES.has(remoteAddress)) {
        return respondJSON(stream, 403, { error: 'e-pages API is available only from localhost' })
      }
      let requestBody = {}
      if (context.headers[':method'] === 'POST') {
        const raw = (await body(stream, { maxSize: 10 })).toString('utf-8')
        requestBody = raw ? JSON.parse(raw) : {}
      }
      const result = await fn({ ...context, body: requestBody })
      if (result !== undefined) {
        respondJSON(stream, 200, result)
      }
    } catch (error) {
      const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500)
      if (status === 500) {
        console.error('[e-pages]', error)
      }
      respondJSON(stream, status, { error: error.message, ...(error.details || {}) })
    }
  }
}

export function respondJSON(stream, status, object) {
  stream.respond({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ':status': status
  })
  stream.end(JSON.stringify(object))
}

export function respondHTML(stream, status, html) {
  stream.respond({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ':status': status
  })
  stream.end(html)
}
