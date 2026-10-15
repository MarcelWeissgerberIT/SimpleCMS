/**
 * Custom agents — what a mirror setup's draft says and does around the editor, shared by the agents gallery
 * (AgentsView's "New agent") and the dialogs over any route (AgentDialogs.tsx, the Patchbay's lamps 04 / 05):
 *  - introText(t, made) / mirrorUndoTitle(t, made): the editor's note after a setup and its Undo key's title
 *  - trashWithUndo(made, res?): what the setup created to the trash (never what a saved agent uses), a toast with Undo
 *  - leftBehind(made): the editor went with the draft unsaved and no prompt is possible — a toast whose Undo trashes it
 */
import { t as tr, type useT } from '../../i18n'
import { madeKind, restoreMirror, trashMirror, type KeptPage, type MirrorMade } from './mirror'
import { mirrorToast } from './mirrorToasts'

/** "“Tracker” stays — the agent “Digest” uses it." for the pages a saved agent kept out of the trash. */
export function keptText(kept: KeptPage[]): string {
  if (kept.length === 1) return tr('features.agents.mirror.kept.one', { title: kept[0].title, agent: kept[0].agent })
  const [a, b] = kept
  return kept.every((k) => k.agent === a.agent) ? tr('features.agents.mirror.kept.both', { a: a.title, b: b.title, agent: a.agent }) : tr('features.agents.mirror.kept.bothAgents', { a: a.title, b: b.title })
}

/**
 * What a mirror setup created (only that, and never what a saved agent uses — trashMirror) to the trash; the toast says
 * what went and what stayed, its Undo brings back what went.
 */
export function trashWithUndo(made: MirrorMade, res: ReturnType<typeof trashMirror> = trashMirror(made)) {
  const { ids, kept } = res
  if (!ids.length && !kept.length) return
  const vars = { name: made.name, report: made.reportTitle }
  const db = ids.includes(made.dbId)
  const report = ids.includes(made.reportId)
  const went = db && report ? 'trashed' : report ? 'trashedReport' : db ? 'trashedDb' : 'nothing'
  const message = [tr(`features.agents.mirror.discard.${went}`, vars), ...(kept.length ? [keptText(kept)] : [])].join(' ')
  mirrorToast({ message, kind: 'info', ...(kept.length ? { timeout: 8_000 } : {}), ...(ids.length ? { action: { label: tr('common.undo'), run: () => restoreMirror(ids) } } : {}) })
}

/**
 * The list went while a mirror draft was open and unsaved (a route change: Back, ⌘⌥N, ⌘K …) — no prompt is possible
 * any more: what the setup created stays, and the toast's Undo moves it (only it, and nothing a saved agent uses by
 * then) to the trash. Like every mirror toast, the next agent dialog takes it down (mirrorToasts.ts): its Undo never
 * takes a click meant for that dialog.
 */
export function leftBehind(made: MirrorMade) {
  const kind = madeKind(made)
  if (kind === 'none') return
  mirrorToast({
    message: tr(kind === 'both' ? 'features.agents.mirror.left' : 'features.agents.mirror.leftReport', { name: made.name, report: made.reportTitle }),
    kind: 'info',
    timeout: 10_000,
    action: { label: tr('common.undo'), run: () => trashWithUndo(made, trashMirror(made, { kind: 'you', via: 'undo' })) },
  })
}

/** The editor's note after a setup: what was made (both · only the report page · nothing), then what is left to do. */
export function introText(t: ReturnType<typeof useT>, made: MirrorMade): string {
  const vars = { name: made.name, report: made.reportTitle, count: made.placeholders }
  const next = made.placeholders > 1 ? 'other' : made.placeholders === 1 ? 'one' : 'none'
  return `${t(`features.agents.mirror.made.${madeKind(made)}`, vars)} ${t(`features.agents.mirror.next.${next}`, vars)}`
}

/** The note's Undo key's title: both go to the trash, or only the report page (the database was there). */
export function mirrorUndoTitle(t: ReturnType<typeof useT>, made: MirrorMade): string {
  return t(madeKind(made) === 'both' ? 'features.agents.mirror.undoTitle' : 'features.agents.mirror.undoTitleReport', { name: made.name, report: made.reportTitle })
}
