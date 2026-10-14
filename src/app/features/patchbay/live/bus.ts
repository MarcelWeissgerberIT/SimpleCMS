/**
 * The run tally (§1.6, §6 A24 / A25): `onRunNote` → runs today per module, once per (writer kind, run id), in
 * IndexedDB `one-patchbay` (`<scope>|runs|<day>`, cache.ts). B13 fills it; startPatchbay (service.ts) starts it.
 * B1 (seams): the hook only — it listens to nothing yet.
 */
export function startRunBus(): () => void {
  return () => {}
}
