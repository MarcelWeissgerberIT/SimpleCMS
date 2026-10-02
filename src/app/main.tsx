import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/shared/fonts'
import '@/shared/tokens.css'
import './ui/ui.css'
import { App } from './shell/App'
import { useWorkspace, emptyWorkspace } from './store/store'
import { loadWorkspace, startPersistence } from './store/persistence'
import { seedWorkspace } from './store/seed'
import { applyTheme } from './lib/theme'
import { startHistory, startAutomations } from './features'
import { detectLang } from '@/shared/i18n'
import { STORAGE_KEYS, safeLocalGet } from '@/shared/brand'

// Apply the remembered theme before first paint to avoid a flash.
const storedTheme = safeLocalGet(STORAGE_KEYS.theme)
applyTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'system')

async function boot() {
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
  startHistory()
  startAutomations()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  document.getElementById('boot')?.remove()
}

void boot()
