import endpoint from '#nodes/endpoint.js'

import resolveSrc from './resolveSrc.js'
import sourceChain from './sourceChain.js'
import cssRules from './cssRules.js'
import openInEditor from './openInEditor.js'
import serveDevPage from './serveDevPage.js'
import serveDevFragment from './serveDevFragment.js'
import settings from './lib/settings.js'

// "/?dev=true" or "/html/<page>.html?...dev=true..."
const DEV_PAGE_URL = /^\/(html\/[^?#]+\.html)?\?(?:[^#]*&)?dev=true(?:[&#]|$)/
// Other html (templates fetched by e-wrapper, e-html...)
const HTML_URL = /^\/html\/[^?#]+\.html(?:[?#]|$)/

// "<prefix>?...dev=true..." or "<prefix>/<anything>?...dev=true..." for a prefix in pageUrls
function shellPageUrl(prefix) {
  const escaped = prefix.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}(?:/[^?#]*)?\\?(?:[^#]*&)?dev=true(?:[&#]|$)`)
}

/**
 * e-dev API. Registered only in local environment (see web-app/routes.js),
 * and every handler also accepts requests only from localhost.
 *
 * @param {any} config
 * @returns {import('#nodes/types.js').NodesEndpoint[]}
 */
export default function eDevApi(config) {
  const shellPages = Object.keys(settings().pageUrls || {})
    .map(prefix => endpoint(shellPageUrl(prefix), 'GET', serveDevPage))
  return [
    endpoint(DEV_PAGE_URL, 'GET', serveDevPage),
    ...shellPages,
    endpoint(HTML_URL, 'GET', serveDevFragment),
    endpoint('/e-dev/source-chain?src', 'GET', sourceChain),
    endpoint('/e-dev/css-rules?url', 'GET', cssRules),
    endpoint('/e-dev/resolve-src?url&method', 'GET', resolveSrc),
    endpoint('/e-dev/open-in-editor', 'POST', openInEditor)
  ]
}
