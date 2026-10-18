/**
 * Work orders in a team (Orders B12, spec §3.10): a request asked for from a device without the worker link and what the
 * worker device says about it, the plate's display-only chain part on such a device (RemotePart.tsx), a work order moved
 * out of Private, a data rule's refusal worded for a member. EN + DE; keys `features.coding.order.*` (merged by
 * features/messages.ts as codingTeam). Names: DE "Prüfauftrag", "Kette", "Planer" — EN "Work order", "Chain", "Planner";
 * Preflight is "Preflight" in both languages. Never "Prüfung", "Plan bereit", "danach", "Freigeben" for a sign-off.
 */
import type { Messages } from '@/shared/i18n'

const O = 'features.coding.order'

export const messages: Messages = {
  en: {
    [`${O}.why.shared`]: 'Only your private work orders are planned — this database lies in the workspace',
    [`${O}.why.ruleMember`]: 'A workspace rule — an admin can change it',
    [`${O}.toast.asked`]: '{id}: asked for — the device with the worker shows “Plan here”',
    [`${O}.cmd.res.asked`]: '{id}: asked for on the device with the worker',
    [`${O}.notify.asked`]: '{id} was asked for on another device',
    [`${O}.chip.asked`]: 'asked for',
    [`${O}.asked.line`]: 'Asked for on another device — ↵ Plan plans it here',
    [`${O}.remote.title`]: 'As the tasks show it',
    [`${O}.remote.asked`]: 'Asked for — the device with the worker shows “Plan here”',
    [`${O}.remote.ready`]: 'Chain ready on the device with the worker — read it and start it there',
    [`${O}.remote.running`]: 'The chain runs on the device with the worker — H halts it after the running step; stop now and resume there',
    [`${O}.remote.halted`]: 'Halted — resume it on the device with the worker',
    [`${O}.remote.done`]: 'Done — each step’s result is on its task',
    [`${O}.remote.adopt`]: 'This chain was started on another device — “Confirm chain” in Preflight first, then it goes on here',
    [`${O}.lane.remote`]: 'under way',
  },
  de: {
    [`${O}.why.shared`]: 'Nur deine privaten Prüfaufträge werden geplant — diese Datenbank liegt im Arbeitsbereich',
    [`${O}.why.ruleMember`]: 'Regel des Arbeitsbereichs — eine Admin kann sie ändern',
    [`${O}.toast.asked`]: '{id}: angefordert — das Gerät mit dem Worker zeigt „Hier planen“',
    [`${O}.cmd.res.asked`]: '{id}: auf dem Gerät mit dem Worker angefordert',
    [`${O}.notify.asked`]: '{id} wurde auf einem anderen Gerät angefordert',
    [`${O}.chip.asked`]: 'angefordert',
    [`${O}.asked.line`]: 'Auf einem anderen Gerät angefordert — ↵ Planen plant es hier',
    [`${O}.remote.title`]: 'So zeigen es die Aufgaben',
    [`${O}.remote.asked`]: 'Angefordert — das Gerät mit dem Worker zeigt „Hier planen“',
    [`${O}.remote.ready`]: 'Kette bereit auf dem Gerät mit dem Worker — dort prüfen und starten',
    [`${O}.remote.running`]: 'Die Kette läuft auf dem Gerät mit dem Worker — H hält sie nach dem laufenden Schritt an; Sofort stoppen und Fortsetzen dort',
    [`${O}.remote.halted`]: 'Angehalten — Fortsetzen auf dem Gerät mit dem Worker',
    [`${O}.remote.done`]: 'Fertig — das Ergebnis jedes Schritts steht in seiner Aufgabe',
    [`${O}.remote.adopt`]: 'Diese Kette wurde auf einem anderen Gerät gestartet — erst im Preflight „Kette bestätigen“, dann geht sie hier weiter',
    [`${O}.lane.remote`]: 'unterwegs',
  },
}
