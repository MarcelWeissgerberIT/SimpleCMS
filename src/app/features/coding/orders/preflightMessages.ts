/**
 * Work orders in Preflight — the words of the cards (B9): what each card is about in the queue's row, its keys, what its
 * body says before ↵, why a key cannot act, what Z says when it cannot take a key back. EN + DE; keys
 * `features.coding.order.preflight.*` (the spec's names) and `features.coding.order.pf.*`; merged in features/messages.ts.
 * Names: DE "Prüfauftrag", "Kette", "Planer" — EN "Work order", "Chain", "Planner". Never "Prüfung", "Plan bereit",
 * "danach"; a server only ever by the person's own name for it.
 */
import type { Messages } from '@/shared/i18n'

const O = 'features.coding.order'
const P = 'features.coding.order.pf'

export const messages: Messages = {
  en: {
    // what a card is about (the spec's table)
    [`${O}.preflight.ready`]: 'Chain ready',
    [`${O}.preflight.next`]: 'Go on with step {n}?',
    [`${O}.preflight.chainConfirm`]: 'Confirm chain',
    [`${O}.preflight.halted`]: 'Chain halted',
    [`${O}.preflight.request`]: 'Requested on another device',
    [`${O}.preflight.interrupted`]: 'Interrupted',
    // keys
    [`${P}.key.open`]: 'Open the work order',
    [`${P}.key.confirmChain`]: 'Confirm chain',
    [`${P}.key.planHere`]: 'Plan here',
    // bodies
    [`${P}.budget.none`]: 'Budget per chain: none — set it on the work order’s plate',
    [`${P}.budget.set`]: 'Budget per chain: {usd} — halts before the next step, never mid-step',
    [`${P}.spent`]: 'Claude Code so far: {spent} of {budget}',
    [`${P}.resumes`]: 'Resume starts: {n} {kind} ‹{title}›',
    [`${P}.resumesNothing`]: 'Resume starts no step now — the chain looks again at what runs.',
    [`${P}.confirm.lead`]: 'This device holds no record of this chain — its worker moved here, or the workspace came back from a backup. ↵ confirms every step exactly as shown here and carries the chain on from this device.',
    [`${P}.confirm.numbers`]: 'The step numbers are missing or doubled — confirm the chain on the device that started it',
    [`${P}.confirm.many`]: 'More than 24 steps carry this work order — confirm the chain on the device that started it',
    [`${P}.confirm.stages`]: 'Stages',
    [`${P}.made`]: 'created',
    [`${P}.notMade`]: 'not created yet',
    [`${P}.request.lead`]: '{id} was asked for on another device — the worker is attached here. ↵ plans it on this device.',
    // what Z says when it cannot take a key back
    [`${P}.final.go`]: 'Going on is not taken back here — H halts the chain on its plate',
    [`${P}.final.discard`]: 'The plan is discarded — plan again on its plate',
    [`${P}.final.replan`]: 'Planning is not taken back here',
    [`${P}.final.halt`]: 'A halt is lifted only by ↵ Resume',
    [`${P}.final.discardMade`]: 'The created steps are in the trash — restore them from there',
    [`${P}.final.confirm`]: 'A confirmed chain is not taken back here — H halts it on its plate',
  },
  de: {
    [`${O}.preflight.ready`]: 'Kette bereit',
    [`${O}.preflight.next`]: 'Weiter mit Schritt {n}?',
    [`${O}.preflight.chainConfirm`]: 'Kette bestätigen',
    [`${O}.preflight.halted`]: 'Kette angehalten',
    [`${O}.preflight.request`]: 'Auf anderem Gerät angefordert',
    [`${O}.preflight.interrupted`]: 'Unterbrochen',
    [`${P}.key.open`]: 'Prüfauftrag öffnen',
    [`${P}.key.confirmChain`]: 'Kette bestätigen',
    [`${P}.key.planHere`]: 'Hier planen',
    [`${P}.budget.none`]: 'Budget je Kette: keins — auf der Platte des Prüfauftrags setzen',
    [`${P}.budget.set`]: 'Budget je Kette: {usd} — hält vor dem nächsten Schritt, nicht mittendrin',
    [`${P}.spent`]: 'Claude Code bisher: {spent} von {budget}',
    [`${P}.resumes`]: 'Fortsetzen startet: {n} {kind} ‹{title}›',
    [`${P}.resumesNothing`]: 'Fortsetzen startet gerade keinen Schritt — die Kette schaut neu, was läuft.',
    [`${P}.confirm.lead`]: 'Dieses Gerät hat keinen Eintrag zu dieser Kette — ihr Worker ist hierher umgezogen, oder der Arbeitsbereich kam aus einem Backup. ↵ bestätigt jeden Schritt genau so, wie er hier steht, und führt die Kette von diesem Gerät aus weiter.',
    [`${P}.confirm.numbers`]: 'Die Schrittnummern fehlen oder sind doppelt — die Kette auf dem Gerät bestätigen, das sie gestartet hat',
    [`${P}.confirm.many`]: 'Mehr als 24 Schritte tragen diesen Prüfauftrag — die Kette auf dem Gerät bestätigen, das sie gestartet hat',
    [`${P}.confirm.stages`]: 'Stufen',
    [`${P}.made`]: 'angelegt',
    [`${P}.notMade`]: 'noch nicht angelegt',
    [`${P}.request.lead`]: '{id} wurde auf einem anderen Gerät angefordert — der Worker hängt an diesem. ↵ plant hier.',
    [`${P}.final.go`]: 'Weiter wird hier nicht zurückgenommen — H hält die Kette auf ihrer Platte an',
    [`${P}.final.discard`]: 'Der Plan ist verworfen — auf der Platte neu planen',
    [`${P}.final.replan`]: 'Planen wird hier nicht zurückgenommen',
    [`${P}.final.halt`]: 'Ein Halt endet nur mit ↵ Fortsetzen',
    [`${P}.final.discardMade`]: 'Die angelegten Schritte liegen im Papierkorb — von dort wiederherstellen',
    [`${P}.final.confirm`]: 'Eine bestätigte Kette wird hier nicht zurückgenommen — H hält sie auf ihrer Platte an',
  },
}
