import endpoint from '#nodes/endpoint.js'

import getPage from './getPage.js'
import getPages from './getPages.js'
import getRoutes from './getRoutes.js'
import resolveSrc from './resolveSrc.js'
import createPage from './createPage.js'
import createTemplate from './createTemplate.js'
import addElement from './addElement.js'
import updateElement from './updateElement.js'
import deleteElement from './deleteElement.js'
import moveElement from './moveElement.js'
import getElementHTML from './getElementHTML.js'
import setElementHTML from './setElementHTML.js'
import undo from './undo.js'
import redo from './redo.js'
import getCssVars from './getCssVars.js'
import saveCssVars from './saveCssVars.js'
import openInEditor from './openInEditor.js'
import serveDevPage from './serveDevPage.js'

// "/?dev=true" or "/html/<page>.html?...dev=true..."
const DEV_PAGE_URL = /^\/(html\/[^?#]+\.html)?\?(?:[^#]*&)?dev=true(?:[&#]|$)/

/**
 * e-pages API. Registered only in local environment (see web-app/routes.js),
 * and every handler also accepts requests only from localhost.
 *
 * @param {any} config
 * @returns {import('#nodes/types.js').NodesEndpoint[]}
 */
export default function ePagesApi(config) {
  return [
    endpoint(DEV_PAGE_URL, 'GET', serveDevPage),
    endpoint('/e-pages/page?path', 'GET', getPage),
    endpoint('/e-pages/pages', 'GET', getPages),
    endpoint('/e-pages/routes', 'GET', getRoutes),
    endpoint('/e-pages/resolve-src?url&method', 'GET', resolveSrc),
    endpoint('/e-pages/page/new', 'POST', createPage),
    endpoint('/e-pages/template/new', 'POST', createTemplate),
    endpoint('/e-pages/element/add', 'POST', addElement),
    endpoint('/e-pages/element/update', 'POST', updateElement),
    endpoint('/e-pages/element/delete', 'POST', deleteElement),
    endpoint('/e-pages/element/move', 'POST', moveElement),
    endpoint('/e-pages/element/html?path&id', 'GET', getElementHTML),
    endpoint('/e-pages/element/html', 'POST', setElementHTML),
    endpoint('/e-pages/undo', 'POST', undo),
    endpoint('/e-pages/redo', 'POST', redo),
    endpoint('/e-pages/css-vars', 'GET', getCssVars),
    endpoint('/e-pages/css-vars', 'POST', saveCssVars),
    endpoint('/e-pages/open-in-editor', 'POST', openInEditor)
  ]
}
