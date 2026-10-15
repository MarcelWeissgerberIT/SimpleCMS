/**
 * The Patchbay's state — the model slice (plan §2.1, B2): the model input and the model built from it, rebuilt only
 * when the input object changed (inputs.ts memo: the wiring signature). Later batches add their slices beside it (fuses
 * + sigs B4/B8, counts B8, UI prefs B6). Nothing here runs at boot: the page (B6) and the idle fuse computation (B8,
 * compute.ts) call refreshModel().
 *
 * THE one publisher of the counts (B8, §6 A16): every model built here writes the sidebar LED's / Preflight lamp's /
 * status cell's numbers (counts.ts) and the hints where the settings live (hint.ts) — the page and the background
 * build the same model, so LED = lamp = readout by construction.
 *
 * Seam (DEV / `?e2e`): `window.__onePatchbay` = { builds(), inputBuilds(), pageChecks(), model(), input(), refresh(),
 * open(), noBlink() } — the perf spec counts rebuilds with it (B17); `open()` reads the lazy inputs as the page does;
 * `noBlink()` stops the fuse blink for screenshots (blink.ts). It goes live once something of the app loads this module
 * (the page, B6; the idle fuse computation after first paint, B8).
 */
import { create } from 'zustand'
import { buildModel } from './model'
import { inputStats, onInputs, openInputs, readInput } from './inputs'
import { fuseCounts, fuseHints, type FusedModel } from './fuses'
import { setPatchbayCounts } from './counts'
import { setFuseHints } from './hint'
import { noBlink } from './blink'
import type { FuseState, Model, ModelInput } from './types'

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
  publish(model as unknown as FusedModel)
  return model
}

/** A fuse label's number ("F12" → 12). */
const labelNo = (label: string): number => Number(label.replace(/^\D+/, '')) || Number.MAX_SAFE_INTEGER

/** The counts and the hints of a model just built (LED = Preflight lamp = status cell = readout). */
function publish(model: FusedModel): void {
  const c = fuseCounts(model)
  const open = (model.fuses as FuseState[]).filter((f) => f.allowed?.state !== 'allowed').sort((a, b) => labelNo(a.label) - labelNo(b.label))
  setPatchbayCounts({ ...c, ready: true, ...(open[0] ? { first: open[0].key } : {}), keys: open.map((f) => f.key) })
  setFuseHints(fuseHints(model))
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
    noBlink: () => noBlink(),
  }
}
