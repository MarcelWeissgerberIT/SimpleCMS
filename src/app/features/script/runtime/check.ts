/**
 * One Script — the rule that makes a run ask first (pure, no store): a script that names an effect (`mail`, `claude`,
 * `http`) or the trash. The runner (run.ts) asks the person once per run when it holds; the Patchbay's script scan
 * (features/patchbay, through engine.ts) reads the same rule — a script that would ask is a gate, never a way out.
 */
import { walk, type Program } from '../lang/ast'

/** Names that make a run ask first: effects and the trash. */
export function needsCheck(program: Program): boolean {
  let hit = false
  walk(program, (n) => {
    if (hit) return
    if (n.type === 'Ident' && ['mail', 'claude', 'http', 'trash'].includes(n.name.toLowerCase())) hit = true
    else if (n.type === 'Member' && n.name.toLowerCase() === 'trash') hit = true
  })
  return hit
}
