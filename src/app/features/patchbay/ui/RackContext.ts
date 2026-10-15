/**
 * What every part of the rack reads (one React context, set by Rack.tsx): the model and its input, the words, the open
 * fuses' marks, what is lit now, and this device's runs today per module (the live tally — B13 / B14 own the rest of
 * the live signal).
 */
import { createContext, useContext } from 'react'
import type { Model, ModelInput, ModuleCost, ModuleKey } from '../types'
import type { Lit } from './lit'
import type { FuseMarks, Words } from './words'

export interface RackCtx {
  model: Model
  input: ModelInput
  words: Words
  marks: FuseMarks
  lit: Lit | null
  /** runs today per module (this device) */
  runs: Record<ModuleKey, number>
  /** today's money per module (this device) */
  costs: Record<ModuleKey, ModuleCost>
  /** the module the keyboard lands on when Tab enters the rack (roving tabindex) */
  entry: ModuleKey | null
  /**
   * B12 — a profile's setup on the rack: the lamps that make or touch each module (its "04" step chips), the lamp
   * worked on now (its chip in ink), a ghost database's field count (its window: "24 fields")
   */
  setup?: { chips: Record<ModuleKey, number[]>; next: number | null; fields: Record<ModuleKey, number> } | null
}

export const RackContext = createContext<RackCtx | null>(null)

export function useRack(): RackCtx {
  const c = useContext(RackContext)
  if (!c) throw new Error('useRack outside the rack')
  return c
}
