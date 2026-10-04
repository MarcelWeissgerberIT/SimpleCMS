/**
 * Registers the offline service worker (production only) and hands it the list of
 * resources this page already loaded, so the first visit is cached as well.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  const url = `${import.meta.env.BASE_URL}sw.js`
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(url, { scope: import.meta.env.BASE_URL })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        const urls = [
          window.location.href.split('#')[0],
          ...performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .filter((u) => u.startsWith(window.location.origin)),
        ]
        reg.active?.postMessage({ type: 'cache-urls', urls })
      })
      .catch((err) => console.warn('[one] service worker registration failed', err))
  })
}

/**
 * Calls `onUpdate` once a newer build has taken over this page's service worker (the worker
 * activates right away, see public/sw.js). Looks for one when the page becomes visible again and
 * every 30 minutes — an app started from the home screen is often only resumed, never reloaded,
 * so without this it would keep running the old code.
 */
export function watchForUpdates(onUpdate: () => void): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  // the very first install also takes control: that is not an update
  let controlled = !!sw.controller
  let told = false
  sw.addEventListener('controllerchange', () => {
    if (controlled && !told) {
      told = true
      onUpdate()
    }
    controlled = true
  })
  const check = () => void sw.getRegistration().then((reg) => reg?.update()).catch(() => {})
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.setInterval(check, 30 * 60_000)
}

