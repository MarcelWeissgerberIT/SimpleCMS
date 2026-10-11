/** startPreflight(): main.tsx, once, after the Outbox — the built-in lamps, the engine, the seam. */
import { startEngine } from './engine'
import { registerBuiltIns, startSourceServices } from './sources'
import { installSeam } from './seam'
import { registerPreflightTry } from './try'

export function startPreflight(): () => void {
  installSeam()
  registerPreflightTry()
  return startEngine(registerBuiltIns, startSourceServices)
}
