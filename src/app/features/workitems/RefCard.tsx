/**
 * Task block — a linked task's card and the lists of linked tasks.
 *
 *  - RefCard (a blocker chip: the pointer resting on it 350 ms, or a click / Enter): title, page path, the state in
 *    words, due, people; keys Open (its page at its block, BlockFlash), Mark done (`writeItems` — disabled with the
 *    reason when that page can't be written; ONE toast: who it freed, else "… is done", with Undo), Remove link
 *    (this task's own link, one undo step here). A card the pointer opened takes no focus and goes when it leaves.
 *  - RefList (BLOCKS / FREED and RELATED chips): the same rows with Open + Remove. Removing a link the OTHER task
 *    holds writes that task (`writeItems`) with a toast + Undo; this task's own link is removed here.
 */
import { useId } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight, Check, Unlink } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { useLang, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed, templateRootOf } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { useCloud } from '../../cloud'
import { workItemDueText, type PickerCtx } from '../../editor'
import { getItemIndex, useItemIndexVersion, useItemView } from './live'
import { refOf, type ItemRef } from './view'
import { writeItems } from './write'
import { pagePath } from './ItemPicker'
import './items.css'

type T = ReturnType<typeof useT>

function stateWord(r: ItemRef, t: T): string {
  if (r.state === 'gone' || r.state === 'trash' || r.state === 'loading' || r.state === 'loop') return t(`editor.workItem.ref.${r.state}`)
  return t(`editor.workItem.status.${r.state === 'open' ? 'todo' : r.state}`)
}

/** Why the linked task's own page cannot be written now (null: it can). */
function useWriteBlock(r: ItemRef): string | null {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const { viewer, outdated } = useCloud(useShallow((c) => ({ viewer: c.readOnly && c.active.kind === 'cloud', outdated: c.outdated && c.active.kind === 'cloud' })))
  if (!r.pageId) return t('features.workItems.refused.gone')
  const page = pages[r.pageId]
  if (!page) return t('features.workItems.refused.gone')
  if (isEffectivelyTrashed(pages, r.pageId)) return t('features.workItems.refused.trash')
  if (page.settings?.locked) return t('features.workItems.refused.locked', { page: page.title || t('common.untitled') })
  if (outdated) return t('features.workItems.refused.outdated')
  if (viewer) return t('features.workItems.refused.readonly')
  return null
}

/** Mark a linked task done (one toast: who it freed, else "… is done"; Undo). */
function markDone(r: ItemRef, from: string, t: T): void {
  const res = writeItems([{ itemId: r.itemId, patch: { status: 'done' } }], { by: 'person', toasts: false, from })
  const ui = useUI.getState()
  const refused = res.results.find((x) => x.refused)
  if (refused) {
    const page = refused.pageId ? useWorkspace.getState().pages[refused.pageId]?.title || t('common.untitled') : ''
    ui.toast({ message: t(`features.workItems.refused.${refused.refused}`, { page }), kind: 'error' })
    return
  }
  const undo = { label: t('features.workItems.undo'), run: res.undo }
  const freed = res.unblocked
  if (freed.length) {
    const first = freed[0]
    const message = freed.length === 1 ? t('features.workItems.unblocked.one', { title: first.title || t('features.workItems.untitled') }) : t('features.workItems.unblocked.many', { n: freed.length, titles: freed.map((e) => e.title || t('features.workItems.untitled')).join(', ') })
    ui.toast({ message, kind: 'success', action: { label: t('features.workItems.unblocked.open'), run: () => openPage(first.pageId, first.blockId ?? undefined) }, more: [undo] })
  } else ui.toast({ message: t('features.workItems.markedDone', { title: r.title || t('features.workItems.untitled') }), kind: 'success', action: undo })
}

function RefFacts({ r }: { r: ItemRef }) {
  const t = useT()
  const lang = useLang()
  const pages = useWorkspace((s) => s.pages)
  const people = useWorkspace((s) => s.people)
  const names = r.people.map((id) => people.find((p) => p.id === id)?.name).filter((n): n is string => !!n)
  return (
    <dl className="wi-card__facts">
      {r.pageId && (
        <div>
          <dt className="label">{t('features.workItems.card.page')}</dt>
          <dd>{pagePath(pages, r.pageId, t('common.untitled'))}</dd>
        </div>
      )}
      <div>
        <dt className="label">{t('features.workItems.card.status')}</dt>
        <dd>
          <span className={r.state === 'done' ? 'led led--ok' : r.state === 'open' || r.state === 'in_progress' ? 'led led--on' : 'led'} aria-hidden /> {stateWord(r, t)}
        </dd>
      </div>
      {r.due && (
        <div>
          <dt className="label">{t('features.workItems.card.due')}</dt>
          <dd>{workItemDueText(r.due, lang)}</dd>
        </div>
      )}
      {names.length > 0 && (
        <div>
          <dt className="label">{t('features.workItems.card.people')}</dt>
          <dd>{names.join(', ')}</dd>
        </div>
      )}
    </dl>
  )
}

/** The card of one linked task (a blocker chip). */
export function RefCard({ ctx }: { ctx: PickerCtx }) {
  const t = useT()
  const id = useId()
  useItemIndexVersion()
  const pages = useWorkspace((s) => s.pages)
  const template = templateRootOf(pages, ctx.pageId)
  const refId = ctx.picker.ref ?? ''
  const r = refOf(getItemIndex(), refId, ctx.attrs.itemId, template)
  const block = useWriteBlock(r)
  const hover = !!ctx.picker.hover
  const own = ctx.attrs.blockedBy.includes(refId) || ctx.attrs.related.includes(refId)
  const unresolved = r.state === 'gone' || r.state === 'trash' || r.state === 'loading'
  return (
    <Popover
      open
      anchor={ctx.anchor}
      onClose={ctx.close}
      placement="bottom-start"
      offset={6}
      autoFocus={!hover}
      className="wi-pop wi-card"
      role="dialog"
      aria-labelledby={id}
    >
      <div onPointerEnter={(e) => e.pointerType === 'mouse' && ctx.hoverKeep()} onPointerLeave={(e) => e.pointerType === 'mouse' && ctx.hoverLeave()}>
        <div className="wi-card__title" id={id}>
          {unresolved ? stateWord(r, t) : r.title || t('features.workItems.untitled')}
        </div>
        {!unresolved && <RefFacts r={r} />}
        <div className="wi-card__keys">
          {r.pageId && !unresolved && (
            <button
              type="button"
              className="btn btn--sm"
              data-autofocus=""
              onClick={() => {
                ctx.close()
                openPage(r.pageId!, r.blockId ?? undefined)
              }}
            >
              <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
              {t('features.workItems.card.open')}
            </button>
          )}
          {(r.state === 'open' || r.state === 'in_progress') && (
            <button
              type="button"
              className="btn btn--sm"
              disabled={!!block}
              title={block ?? undefined}
              onClick={() => {
                ctx.close()
                markDone(r, ctx.pageId, t)
              }}
            >
              <Check size={14} strokeWidth={1.8} aria-hidden />
              {t('features.workItems.card.done')}
            </button>
          )}
          {own && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => ctx.commit(ctx.attrs.blockedBy.includes(refId) ? { blockedBy: { remove: [refId] } } : { related: { remove: [refId] } })}>
              <Unlink size={14} strokeWidth={1.8} aria-hidden />
              {t('features.workItems.card.remove')}
            </button>
          )}
        </div>
        {block && (r.state === 'open' || r.state === 'in_progress') && <p className="wi-card__why">{block}</p>}
      </div>
    </Popover>
  )
}

/** BLOCKS · FREED (dependents) and RELATED: the linked tasks, each with Open and Remove. */
export function RefList({ ctx, mode }: { ctx: PickerCtx; mode: 'dependents' | 'relatedList' }) {
  const t = useT()
  const id = useId()
  const view = useItemView(ctx.attrs, ctx.pageId)
  const list = mode === 'dependents' ? view.dependents : view.related
  const self = ctx.attrs.itemId
  const title = mode === 'dependents' ? t(ctx.attrs.status === 'done' ? 'features.workItems.list.freed' : 'features.workItems.list.blocks') : t('features.workItems.items.title.related')
  const remove = (r: ItemRef) => {
    if (!self) return
    // this task's own link: here (one undo step); the other task's: written there, with Undo
    if (mode === 'relatedList' && r.own) return void ctx.commit({ related: { remove: [r.itemId] } })
    const patch = mode === 'dependents' ? { blockedBy: { remove: [self] } } : { related: { remove: [self] } }
    const res = writeItems([{ itemId: r.itemId, patch }], { by: 'person', toasts: false, from: ctx.pageId })
    ctx.close()
    const refused = res.results.find((x) => x.refused)
    const ui = useUI.getState()
    if (refused) {
      const page = refused.pageId ? useWorkspace.getState().pages[refused.pageId]?.title || t('common.untitled') : ''
      ui.toast({ message: t(`features.workItems.refused.${refused.refused}`, { page }), kind: 'error' })
    } else ui.toast({ message: t('features.workItems.edge.removed'), kind: 'success', action: { label: t('features.workItems.undo'), run: res.undo } })
  }
  return (
    <Popover open anchor={ctx.anchor} onClose={ctx.close} placement="bottom-start" offset={6} className="wi-pop wi-list" role="dialog" aria-labelledby={id}>
      <div className="wi-pop__head label" id={id}>
        {title}
      </div>
      <ul className="wi-list__rows">
        {list.map((r, i) => (
          <li key={r.itemId} className="wi-list__row">
            <span className={r.state === 'done' ? 'led led--ok' : r.state === 'open' || r.state === 'in_progress' ? 'led led--on' : 'led'} aria-hidden />
            <span className="wi-opt__main">
              <span className="wi-opt__name">{r.title || t('features.workItems.untitled')}</span>
              <span className="wi-opt__sub">{stateWord(r, t)}</span>
            </span>
            {r.pageId && (
              <button
                type="button"
                className="icon-btn"
                aria-label={`${t('features.workItems.card.open')}: ${r.title || t('features.workItems.untitled')}`}
                title={t('features.workItems.card.open')}
                data-autofocus={i === 0 ? '' : undefined}
                onClick={() => {
                  ctx.close()
                  openPage(r.pageId!, r.blockId ?? undefined)
                }}
              >
                <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
              </button>
            )}
            <button type="button" className="icon-btn" aria-label={`${t('features.workItems.card.remove')}: ${r.title || t('features.workItems.untitled')}`} title={t('features.workItems.card.remove')} onClick={() => remove(r)}>
              <Unlink size={14} strokeWidth={1.8} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
