import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/shared/fonts'
import '@/shared/tokens.css'
import './ui/ui.css'
import { App } from './shell/App'
import { ErrorBoundary } from './shell/ErrorBoundary'
import { runPendingReset } from './shell/lib/reset'
import { useWorkspace, emptyWorkspace } from './store/store'
import { useUI } from './store/ui'
import { loadWorkspace, startPersistence } from './store/persistence'
import { seedWorkspace } from './store/seed'
import { applyTheme } from './lib/theme'
import { startHistory, startAutomations } from './features'
import { detectLang } from '@/shared/i18n'
import { STORAGE_KEYS, safeLocalGet } from '@/shared/brand'

// Apply the remembered theme before first paint to avoid a flash.
const storedTheme = safeLocalGet(STORAGE_KEYS.theme)
applyTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'system')

function bootStatus(text: string, fault = false) {
  const el = document.getElementById('boot')
  if (!el) return
  el.innerHTML = ''
  const box = document.createElement('div')
  const led = document.createElement('i')
  if (fault) led.style.cssText = 'animation:none;background:#b42318'
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
  if (await runPendingReset()) bootStatus('Workspace reset · seeding')

  const saved = await loadWorkspace()
  const store = useWorkspace.getState()
  if (saved) {
    store.hydrate(saved)
  } else {
    const ws = emptyWorkspace()
    ws.settings.language = detectLang()
    store.hydrate(ws)
    seedWorkspace(ws.settings.language)
  }
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

  // Deep link from the landing page: /app/?import → open the importer.
  const params = new URLSearchParams(window.location.search)
  if (params.has('import')) {
    useUI.getState().openModal({ type: 'import' })
    params.delete('import')
    const qs = params.toString()
    history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
  }
}

boot().catch((e) => {
  console.error('[one] boot failed', e)
  bootStatus(`Boot fault · ${e instanceof Error ? e.message : String(e)}`, true)
})
