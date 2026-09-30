// Keeps dev mode while navigating: same-origin links, EHTML's redirect() action and scripts
// (location.href = ..., with the Navigation API) get ?dev=true.
// Leaving dev mode is only possible by removing ?dev=true from the url.

export function withDevParam(href) {
  const url = new URL(href, window.location.href)
  if (url.origin !== window.location.origin) return null
  url.searchParams.set('dev', 'true')
  return url.pathname + url.search + url.hash
}

export function interceptLinks() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.composedPath().find(el => el.tagName === 'A' && el.hasAttribute && el.hasAttribute('href'))
    if (!link) return
    const href = link.getAttribute('href')
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return
    const devHref = withDevParam(link.href)
    if (!devHref) return
    event.preventDefault()
    window.location.assign(devHref)
  })

  // location.href = ..., location.assign()... (browsers with the Navigation API)
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', (event) => {
      if (!event.cancelable || event.hashChange || event.downloadRequest !== null || event.formData) return
      if (event.navigationType === 'reload' || event.navigationType === 'traverse') return
      const url = new URL(event.destination.url)
      if (url.origin !== window.location.origin || url.searchParams.get('dev') === 'true') return
      event.preventDefault()
      window.location[event.navigationType === 'replace' ? 'replace' : 'assign'](withDevParam(url.href))
    })
  }

  // EHTML action redirect(url) is global
  if (typeof window.redirect === 'function') {
    const originalRedirect = window.redirect
    window.redirect = function (url, ...args) {
      return originalRedirect.call(this, withDevParam(url) || url, ...args)
    }
  }
}
