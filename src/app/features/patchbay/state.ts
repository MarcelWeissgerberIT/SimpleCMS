/**
 * The Patchbay's state — the model slice (plan §2.1, B2): the model input and the model built from it, rebuilt only
 * when the input object changed (inputs.ts memo: the wiring signature). Later batches add their slices beside it (fuses
 * + sigs B4/B8, counts B8, UI prefs B6). Nothing here runs at boot: the page (B6) and the idle fuse computation (B8)
 * call refreshModel().
 *
 * Seam (DEV / `?e2e`): `window.__onePatchbay` = { builds(), inputBuilds(), pageChecks(), model(), input(), refresh(),
 * open() } — the perf spec counts rebuilds with it (B17); `open()` reads the lazy inputs as the page does. It goes live
 * once something of the app loads this module (the page, B6; the idle fuse computation, B8).
 */
import { create } from 'zustand'
import { buildModel } from './model'
import { inputStats, onInputs, openInputs, readInput } from './inputs'
import type { Model, ModelInput } from './types'

interface ModelSlice {
  input: ModelInput | null
  model: Model | null
  /** how often the model was built (a rebuild happens only for a new input) */
  builds: number
  /** when the model was built last (ms) */
  at: number
}

export const usePatchbay = create<ModelSlice>(() => ({ input: null, model: null, builds: 0, at: 0 }))

/** Read the input (memo) and build the model when the input changed — returns the model now. */
export function refreshModel(): Model {
  const input = readInput()
  const cur = usePatchbay.getState()
  if (cur.model && cur.input === input) return cur.model
  const model = buildModel(input)
  usePatchbay.setState({ input, model, builds: cur.builds + 1, at: Date.now() })
  return model
}

/** The page opened: read the expensive inputs (idle) and rebuild as each arrives. Returns the stop. */
export function openModel(): () => void {
  openInputs()
  refreshModel()
  return onInputs(() => {
    refreshModel()
  })
}

/** React: the model (null until the first refreshModel). */
export const useModel = (): Model | null => usePatchbay((s) => s.model)

const seamOn = (() => {
  try {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
})()

if (seamOn && typeof window !== 'undefined') {
  ;(window as unknown as { __onePatchbay?: unknown }).__onePatchbay = {
    builds: () => usePatchbay.getState().builds,
    inputBuilds: () => inputStats().builds,
    pageChecks: () => inputStats().pageChecks,
    model: () => usePatchbay.getState().model,
    input: () => usePatchbay.getState().input,
    refresh: () => refreshModel(),
    open: () => {
      openModel()
    },
  }
}
