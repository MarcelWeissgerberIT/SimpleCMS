import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/shared/fonts'
import '@/shared/tokens.css'
import './ui/ui.css'
import { App } from './shell/App'
import { ErrorBoundary } from './shell/ErrorBoundary'
import { listenForReset, runPendingReset, withBootLock } from './shell/lib/reset'
import { consumeShareTarget } from './shell/capture/inbox'
import { bootRedirect } from './shell/lib/global'
import { useWorkspace, emptyWorkspace } from './store/store'
import { currentWriter, withWriter, type Writer } from './store/writer'
import { useUI } from './store/ui'
import { flushSave, loadWorkspace, startPersistence } from './store/persistence'
import { seedWorkspace } from './store/seed'
import { refreshDemoIcons } from './store/demoIcons'
import { offerTour } from './shell/tour/state'
import { applyTheme } from './lib/theme'
import { applyTextStep } from './lib/textScale'
import { startSwitchLed } from './lib/switchLed'
import { applyCachedLook } from './lib/look'
import { ALL_MESSAGES, t } from './i18n'
import { startHistory, startRecorder, startAutomations, startRecurringTemplates, startInbox, startSync, startMcp, startCustomFunctions, startMail, startAgents, startCoding, startKit, startOutbox, startItems, seedDemoHistory, demoFunctions } from './features'
import { consumeMcpOAuthReturn, oneScriptGrammar } from './features'
import { registerCodeLanguage, startSyncedBlocks } from './editor'
import { detectLang, makeTranslator } from '@/shared/i18n'
import { STORAGE_KEYS, safeLocalGet } from '@/shared/brand'
import { registerServiceWorker, watchForUpdates } from '@/shared/sw'
import * as cloud from './cloud'
import { getFile, saveFile } from './lib/files'
import { installForeignLinks } from './lib/foreignLinks'

// Apply the remembered theme before first paint to avoid a flash.
const storedTheme = safeLocalGet(STORAGE_KEYS.theme)
applyTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'system')
// …and this device's text size (Settings → Appearance), so nothing re-flows after the first paint.
applyTextStep()
// …and this device's switch LED colour (Settings → Appearance; the signal colour unless it picked another).
startSwitchLed()
// …and the workspace look this device last saw for the workspace it is about to open (lib/look)
{
  const ref = cloud.expectedWorkspace()
  applyCachedLook(ref.kind === 'cloud' ? ref.id : 'local')
}

// Code blocks on pages know One Script too (editor/lib/codeLanguages.ts: the language menu is a registry).
registerCodeLanguage({ id: 'onescript', label: 'One Script', aliases: ['one'], grammar: oneScriptGrammar })

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
  // an MCP server's sign-in window (OAuth): the tab that started the sign-in takes the code, this window closes
  if (await consumeMcpOAuthReturn(bootT('features.ai.mcp.oauth.closing')).catch(() => false)) return
  bootStatus(bootT('shell.boot.loading'))

  // Team cloud first: which workspace does this tab show? 'cloud' → the store is already filled
  // from the cloud workspace's local copy (it syncs in the background; no seed, no local
  // persistence, no cross-tab merge — Yjs does that). 'signed-out' → an empty, unsaved workspace
  // behind the sign-in screen. 'local' → exactly as before. A cloud failure never blocks local mode.
  let mode: Awaited<ReturnType<typeof cloud.bootCloud>> = 'local'
  try {
    mode = await cloud.bootCloud()
  } catch (e) {
    console.error('[one] cloud boot failed — opening the local workspace', e)
    cloud.useCloud.setState({ status: 'local', active: { kind: 'local', id: 'local' }, role: null, readOnly: false })
  }
  if (mode === 'local') await bootLocal()

  if (mode !== 'signed-out') {
    startService('history', startHistory)
    // flight recorder (features/recorder): right after history — its listener takes history's page diff as a memo hit,
    // the reset above is done (its database never blocks one), and the seed of a fresh workspace is not journaled
    startService('recorder', startRecorder)
    startService('automations', startAutomations)
    startService('recurring templates', startRecurringTemplates)
    // tasks: the editor's lookup + the creation gate (the index itself is built when something first asks)
    startService('tasks', startItems)
    startService('inbox', startInbox)
    startService('synced blocks', startSyncedBlocks)
    startService('sync', startSync)
    // local MCP bridge (Settings → Agents · MCP): idle until switched on for this device
    startService('mcp', startMcp)
    // custom functions (built by clicking) → the spreadsheet engine + database formulas
    startService('custom functions', startCustomFunctions)
    // Gmail → Mails database (Settings → Mail): schedule + "Load images"; idle until set up on this device
    startService('mail', startMail)
    // custom agents (#/agents): the browser runner — schedules and row triggers in the leader tab
    startService('agents', startAgents)
    // coding pipeline (Settings → Coding worker): idle until switched on for this device
    startService('coding', startCoding)
    startService('building blocks', startKit)
    // the Outbox: this device's slips (IndexedDB one-outbox) and the rows they watch
    startService('outbox', startOutbox)
  }

  // PWA share target (/app/?title=…&text=…&url=…) → the #/clip route, before the first render
  startService('foreign links', installForeignLinks)
  if (mode !== 'signed-out') startService('share target', consumeShareTarget)
  // "#/" → the start page before the first render (the home screen is not built for nothing)
  if (mode !== 'signed-out') startService('start page', bootRedirect)

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
    ;(window as unknown as { __one?: unknown }).__one = {
      workspace: testStore(),
      ui: useUI,
      flushSave,
      cloud: testApi(cloud),
      files: { saveFile, getFile },
    }
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

/** A spec's own writes through the test hook: the person's (`you~ui:e2e`, store/writer.ts) unless a frame is open. */
const TEST: Writer = { kind: 'you', via: 'ui', ref: 'e2e' }

/** `fn` as the test's writer — its synchronous part (an async function opens its own frames after each await). */
const asTest =
  <A extends unknown[], R>(fn: (...a: A) => R) =>
  (...a: A): R => {
    if (currentWriter()) return fn(...a)
    let out!: R
    withWriter(TEST, () => {
      out = fn(...a)
    })
    return out
  }

/**
 * The test hook's store (DEV / ?e2e): a spec's setup writes run as the person's unless a writer frame is open — so the
 * flight recorder's net (a write without a writer) reports only the app's own paths.
 */
function testStore() {
  const wrap = asTest
  const states = new WeakMap<object, object>()
  const getState = () => {
    const s = useWorkspace.getState()
    let out = states.get(s)
    if (!out) {
      const o = Object.create(s) as Record<string, unknown>
      // defined, not assigned: a state Immer froze has read-only properties an assignment through the prototype refuses
      for (const [k, v] of Object.entries(s)) if (typeof v === 'function') Object.defineProperty(o, k, { value: wrap(v as (...a: unknown[]) => unknown), enumerable: true, writable: true, configurable: true })
      states.set(s, (out = o))
    }
    return out as ReturnType<typeof useWorkspace.getState>
  }
  return { ...useWorkspace, getState, setState: wrap(useWorkspace.setState) }
}

/** The test hook's cloud API: its functions as the test's writes too (stores — they have getState — stay as they are). */
function testApi<T extends object>(mod: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(mod)) out[k] = typeof v === 'function' && !('getState' in v) ? asTest(v as (...a: unknown[]) => unknown) : v
  return out as T
}

/** The browser-only workspace: load (or seed) it from IndexedDB and start saving + cross-tab sync. */
async function bootLocal() {
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
      // MARGIN, built by clicking (the seeded budget sheet uses it)
      for (const fn of demoFunctions(ws.settings.language)) useWorkspace.getState().upsertFunction(fn)
      // persist the seed right away — a reload before the first edit must not seed new ids
      await flushSave()
      // give the start page a short back-dated version history, so the tape has something to scrub
      const start = useWorkspace.getState().settings.startPageId
      if (start) seedDemoHistory(start).catch((e) => console.warn('[one] demo history failed', e))
      // the guided tour is offered once on the fresh workspace's Welcome page (shell/tour)
      if (start) offerTour(start)
    }
  })

  startPersistence()
  // demo pages seeded before the icon change get the new icons (only untouched ones; saved like an edit)
  refreshDemoIcons()
}

registerServiceWorker()
// a newer build is live: offer to reload (saves first) — the home-screen app is often only resumed
let reloadOffered = false
const offerReload = () => {
  if (reloadOffered) return
  reloadOffered = true
  useUI.getState().toast({
    message: t('shell.update.ready'),
    timeout: 0,
    action: { label: t('shell.update.reload'), run: () => void flushSave().finally(() => window.location.reload()) },
  })
}
watchForUpdates(offerReload)
// a tab left open across deploys asks for a part of its own (older) build that is gone from the server:
// the part shows its fallback, and the reload brings the whole app up to date
window.addEventListener('vite:preloadError', (e) => {
  console.warn('[one] a part of the app could not load — offering a reload', (e as Event & { payload?: unknown }).payload)
  offerReload()
})

boot().catch((e) => {
  console.error('[one] boot failed', e)
  bootStatus(bootT('shell.boot.fault', { msg: e instanceof Error ? e.message : String(e) }), true)
})
