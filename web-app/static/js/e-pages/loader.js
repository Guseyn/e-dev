// e-pages loader: safe to include on every page.
// It does nothing unless the url has ?dev=true, and it only loads
// the editor on localhost (e-pages API exists only in local environment).

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1']

const devModeIsRequested = new URLSearchParams(window.location.search).get('dev') === 'true'

if (devModeIsRequested) {
  if (LOCAL_HOSTS.includes(window.location.hostname)) {
    import('#e-pages/editor.js')
      .then(({ default: startEditor }) => startEditor())
      .catch((error) => console.error('[e-pages] Could not start editor:', error))
  } else {
    console.warn('[e-pages] ?dev=true works only locally (localhost / 127.0.0.1), so the page runs in normal mode.')
  }
}
