import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/shared/fonts'
import '@/shared/tokens.css'
import './ui/ui.css'
import { App } from './shell/App'
import { ErrorBoundary } from './shell/ErrorBoundary'
import { listenForReset, runPendingReset, withBootLock } from './shell/lib/reset'
import { useWorkspace, emptyWorkspace } from './store/store'
import { useUI } from './store/ui'
import { flushSave, loadWorkspace, startPersistence } from './store/persistence'
import { seedWorkspace } from './store/seed'
import { applyTheme } from './lib/theme'
import { ALL_MESSAGES } from './i18n'
import { startHistory, startAutomations } from './features'
import { detectLang, makeTranslator } from '@/shared/i18n'
import { STORAGE_KEYS, safeLocalGet } from '@/shared/brand'
import { registerServiceWorker } from '@/shared/sw'

// Apply the remembered theme before first paint to avoid a flash.
const storedTheme = safeLocalGet(STORAGE_KEYS.theme)
applyTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'system')

// Another tab erasing the workspace makes this one reload (see shell/lib/reset.ts).
listenForReset()

/** Boot strings: the workspace (and its language setting) is not loaded yet. */
const bootT = makeTranslator(ALL_MESSAGES, detectLang())

function bootStatus(text: string, fault = false) {
  const el = document.getElementById('boot')
  if (!el) return
  el.innerHTML = ''
  const box = document.createElement('div')
  const led = document.createElement('i')
  if (fault) led.style.cssText = 'animation:none;background:var(--c-red-text)'
  box.append(led, document.createTextNode(text))
  el.append(box)
}

/** Start background services one by one so a failing service never blocks the app. */
function startService(name: string, start: () => unknown) {
  try {
    start()
  } catch (e) {
    console.error(`[one] failed to start ${name}`, e)
  }
}

async function boot() {
  bootStatus(bootT('shell.boot.loading'))

  // reset → load → seed → first save run under a cross-tab lock: a second tab waits and
  // then loads the very same workspace instead of seeding its own.
  await withBootLock(async () => {
    const reset = await runPendingReset(() => bootStatus(bootT('shell.boot.blocked')))
    if (reset) bootStatus(bootT('shell.boot.reset'))

    const saved = await loadWorkspace()
    const store = useWorkspace.getState()
    if (saved) {
      store.hydrate(saved)
    } else {
      const ws = emptyWorkspace()
      ws.settings.language = detectLang()
      store.hydrate(ws)
      seedWorkspace(ws.settings.language)
      // persist the seed right away — a reload before the first edit must not seed new ids
      await flushSave()
    }
  })

  startPersistence()
  startService('history', startHistory)
  startService('automations', startAutomations)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
  document.getElementById('boot')?.remove()

  // Automation hook for end-to-end tests and the screenshot script (dev, or ?e2e).
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')) {
    ;(window as unknown as { __one?: unknown }).__one = { workspace: useWorkspace, ui: useUI, flushSave }
  }

  // Deep link from the landing page: /app/?import → open the importer.
  const params = new URLSearchParams(window.location.search)
  if (params.has('import')) {
    useUI.getState().openModal({ type: 'import' })
    params.delete('import')
    const qs = params.toString()
    history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
  }
}

registerServiceWorker()

boot().catch((e) => {
  console.error('[one] boot failed', e)
  bootStatus(bootT('shell.boot.fault', { msg: e instanceof Error ? e.message : String(e) }), true)
})
