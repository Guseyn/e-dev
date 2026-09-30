import endpoint from '#nodes/endpoint.js'

import resolveSrc from './resolveSrc.js'
import sourceChain from './sourceChain.js'
import cssRules from './cssRules.js'
import openInEditor from './openInEditor.js'
import serveDevPage from './serveDevPage.js'
import serveDevFragment from './serveDevFragment.js'

// "/?dev=true" or "/html/<page>.html?...dev=true..."
const DEV_PAGE_URL = /^\/(html\/[^?#]+\.html)?\?(?:[^#]*&)?dev=true(?:[&#]|$)/
// Other html (templates fetched by e-wrapper, e-html...)
const HTML_URL = /^\/html\/[^?#]+\.html(?:[?#]|$)/

/**
 * e-dev API. Registered only in local environment (see web-app/routes.js),
 * and every handler also accepts requests only from localhost.
 *
 * @param {any} config
 * @returns {import('#nodes/types.js').NodesEndpoint[]}
 */
export default function eDevApi(config) {
  return [
    endpoint(DEV_PAGE_URL, 'GET', serveDevPage),
    endpoint(HTML_URL, 'GET', serveDevFragment),
    endpoint('/e-dev/source-chain?src', 'GET', sourceChain),
    endpoint('/e-dev/css-rules?url', 'GET', cssRules),
    endpoint('/e-dev/resolve-src?url&method', 'GET', resolveSrc),
    endpoint('/e-dev/open-in-editor', 'POST', openInEditor)
  ]
}
