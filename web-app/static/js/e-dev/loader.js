// e-dev loader: safe to include on every page.
// It does nothing unless the url has ?dev=true, and it works only on localhost
// (e-dev API exists only in local environment).

import { startTracker } from '#e-dev/tracker.js'

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1']

const devModeIsRequested = new URLSearchParams(window.location.search).get('dev') === 'true'

if (devModeIsRequested) {
  if (LOCAL_HOSTS.includes(window.location.hostname)) {
    // Synchronously, so it sees everything EHTML renders
    startTracker()
    import('#e-dev/inspect.js')
      .then(({ default: startInspector }) => startInspector())
      .catch((error) => console.error('[e-dev] Could not start inspector:', error))
  } else {
    console.warn('[e-dev] ?dev=true works only locally (localhost / 127.0.0.1), so the page runs in normal mode.')
  }
}
