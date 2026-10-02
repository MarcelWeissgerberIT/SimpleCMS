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
