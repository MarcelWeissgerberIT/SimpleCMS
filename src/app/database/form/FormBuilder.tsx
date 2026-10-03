/**
 * Build mode: heading + description, the questions (title first, then the view's property order —
 * drag or keyboard to reorder, page breaks in between), per question required / help /
 * placeholder / presentation / "show only if …", the submit label, the closing screen and the
 * delivery section (response marker, webhook, share).
 */
import { useId, useMemo, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ArrowRight, Plus, Share2 } from 'lucide-react'
import type { FormPageBreak, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { Switch } from '../../ui/controls'
import { Menu, TypeIcon } from '../parts'
import { usePropertyCreate } from '../create/entry'
import type { DbModel } from '../hooks'
import { isDbLocked } from '../model/lock'
import { FORM_TYPES, formConfig, formProps, isValidHttpUrl, pageBreaksOf, questionOf, type Field } from './fields'
import { conditionIssue } from './logic'
import { addBreak, patchForm, patchQuestion, setBreaks, useDraft } from './config'
import { WebhookField } from './ShareForm'
import { PageBreakCard, QuestionCard } from './BuilderQuestion'
import { LogicRails, type Edge } from './LogicRails'
import { markerOf, startTracking, stopTracking } from './responses'
import { hostOf } from './webhook'

const pad = (n: number) => String(n).padStart(2, '0')

export function FormBuilder({ m, fields, onShare, onResponses }: { m: DbModel; fields: Field[]; onShare: () => void; onResponses: () => void }) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const cfg = formConfig(m.view)
  const { shown, hidden, computed, markers, title } = formProps(m.db, m.view)
  const dbName = m.dbPage.title.trim() || t('common.untitled')
  const dbId = m.db.id
  const viewId = m.view.id
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  // a state, not a ref: the rails measure once the list is in the DOM (a child's effect runs before a parent's ref)
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const heading = useDraft(cfg.title ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, title: v })))
  const desc = useDraft(cfg.description ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, description: v })))
  const submit = useDraft(cfg.submitLabel ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, submitLabel: v })))

  const shownIds = shown.map((p) => p.id)
  const titleShown = shown[0]?.type === 'title'
  const sortable = shown.filter((p) => p.type !== 'title')
  // a break counts when it starts a shown question other than the first
  const breaks = pageBreaksOf(cfg)
  const breakAt = new Map<string, FormPageBreak>()
  for (const b of breaks) if (shownIds.indexOf(b.before) > 0 && !breakAt.has(b.before)) breakAt.set(b.before, b)
  const breakIds = new Set([...breakAt.values()].map((b) => b.id))
  const sortIds = sortable.flatMap((p) => (breakAt.has(p.id) ? [breakAt.get(p.id)!.id, p.id] : [p.id]))
  const pageOf = new Map<string, number>()
  let pageNo = 1
  for (const id of shownIds) if (breakAt.has(id)) pageOf.set(breakAt.get(id)!.id, ++pageNo)

  const edges = useMemo<Edge[]>(
    () => fields.flatMap((f, i) => (f.showIf?.conditions ?? []).filter((c) => !conditionIssue(c, i, fields)).map((c) => ({ from: c.q, to: f.key }))).filter((e, i, all) => all.findIndex((x) => x.from === e.from && x.to === e.to) === i),
    [fields],
  )

  const setVisible = (ids: string[]) => useWorkspace.getState().updateView(dbId, viewId, { visibleProperties: ids })
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false)
    if (!e.over || e.active.id === e.over.id || isDbLocked(dbId)) return
    const from = sortIds.indexOf(String(e.active.id))
    const to = sortIds.indexOf(String(e.over.id))
    if (from < 0 || to < 0) return
    const seq = arrayMove(sortIds, from, to)
    // every break must start a question, two breaks never touch, page 1 starts with the first question
    for (let i = 0; i < seq.length; i++) {
      if (!breakIds.has(seq[i])) continue
      const next = seq[i + 1]
      if (!next || breakIds.has(next) || (i === 0 && !titleShown)) return
    }
    // questions: their new order inside the full list (it may also hold properties the form doesn't offer)
    const order = seq.filter((id) => !breakIds.has(id))
    const inForm = new Set(order)
    let k = 0
    const visibleProperties = m.view.visibleProperties.map((id) => (inForm.has(id) ? order[k++] : id))
    const before = new Map(seq.flatMap((id, i) => (breakIds.has(id) ? [[id, seq[i + 1]] as const] : [])))
    const pages = breaks.map((b) => (before.has(b.id) ? { ...b, before: before.get(b.id)! } : b))
    useWorkspace.getState().updateView(dbId, viewId, { visibleProperties, form: { ...cfg, pages } })
  }
  // a question leaves the form: its page break moves on to the next question (or goes)
  const moveBreakOff = (p: PropertyDef) => {
    const next = shownIds[shownIds.indexOf(p.id) + 1]
    setBreaks(dbId, viewId, (bs) => bs.flatMap((b) => (b.before !== p.id ? [b] : next && !bs.some((x) => x.before === next) ? [{ ...b, before: next }] : [])))
  }
  const hide = (p: PropertyDef) => {
    moveBreakOff(p)
    if (p.type === 'title') patchQuestion(dbId, viewId, p.id, { hidden: true })
    else setVisible(m.view.visibleProperties.filter((id) => id !== p.id))
  }
  const show = (p: PropertyDef) => {
    if (p.type === 'title') patchQuestion(dbId, viewId, p.id, { hidden: false })
    else setVisible([...m.view.visibleProperties.filter((id) => id !== p.id), p.id])
  }
  const breakAfter = (i: number) => {
    const next = shownIds[i + 1]
    if (!next || breakAt.has(next)) return undefined
    return () => setJustAdded(addBreak(dbId, viewId, next))
  }

  const card = (p: PropertyDef) => {
    const i = shownIds.indexOf(p.id)
    return <QuestionCard key={p.id} m={m} p={p} index={i} field={fields.find((f) => f.key === p.id)} fields={fields} onHide={() => hide(p)} onBreakAfter={breakAfter(i)} onActive={setActive} />
  }
  const pageBreak = (b: FormPageBreak) => <PageBreakCard key={b.id} m={m} id={b.id} page={pageOf.get(b.id) ?? 2} title={b.title ?? ''} description={b.description ?? ''} autoFocus={justAdded === b.id} />

  return (
    <div className="fb">
      {/* § 01 — heading */}
      <section className="fb-sec" aria-labelledby={`${uid}-s1`}>
        <h3 className="fb-sec__label label" id={`${uid}-s1`}>
          § 01 — {t('database.form.b.header')}
        </h3>
        <label className="visually-hidden" htmlFor={`${uid}-title`}>
          {t('database.form.b.title')}
        </label>
        <input id={`${uid}-title`} className="fb-title" placeholder={dbName} maxLength={200} {...heading.props} />
        <label className="visually-hidden" htmlFor={`${uid}-desc`}>
          {t('database.form.b.description')}
        </label>
        <textarea id={`${uid}-desc`} className="fb-desc" rows={2} placeholder={t('database.form.b.descriptionPh')} maxLength={2000} {...desc.props} />
      </section>

      {/* § 02 — questions */}
      <section className="fb-sec" aria-labelledby={`${uid}-s2`}>
        <h3 className="fb-sec__label label" id={`${uid}-s2`}>
          § 02 — {t('database.form.b.questions')} <span className="fb-sec__count">{pad(shown.length)}</span>
          {pageNo > 1 && <span className="fb-sec__count">{t('database.form.page.count', { count: pageNo })}</span>}
        </h3>
        {pageNo > 1 && <div className="label fb-page1">{t('database.form.page.label', { n: pad(1) })}</div>}
        <div className="fb-qwrap" ref={setListEl} data-logic={edges.length ? true : undefined}>
          <LogicRails list={listEl} edges={edges} active={active} hidden={dragging} layout={`${titleShown}|${sortIds.join(',')}`} />
          <ol className="fb-qs">
            {titleShown && card(shown[0])}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={onDragEnd}>
              <SortableContext items={sortIds} strategy={verticalListSortingStrategy}>
                {sortable.map((p) => (breakAt.has(p.id) ? [pageBreak(breakAt.get(p.id)!), card(p)] : card(p)))}
              </SortableContext>
            </DndContext>
          </ol>
        </div>
        {shown.length === 0 && <p className="fb-empty label">{t('database.form.b.noneShown')}</p>}
        {!m.fixed && <AddQuestion m={m} hidden={hidden} onShow={show} />}

        {hidden.length > 0 && (
          <div className="fb-hidden">
            <div className="label fb-hidden__label">{t('database.form.b.hidden')}</div>
            <ul className="fb-hidden__list">
              {hidden.map((p) => (
                <li key={p.id} className="fb-hidden__item">
                  <button type="button" className="fb-hidden__add" onClick={() => show(p)} aria-label={t('database.form.b.addQ', { name: p.name || t('common.untitled') })}>
                    <Plus size={13} aria-hidden />
                    <TypeIcon type={p.type} size={13} />
                    <span>{p.name || t('common.untitled')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {computed.length > 0 && (
          <p className="fb-note">
            <span className="label">{t('database.form.b.auto')}</span> {computed.map((p) => p.name || t('common.untitled')).join(', ')} — {t('database.form.b.autoNote')}
          </p>
        )}
        {markers.length > 0 && (
          <p className="fb-note fb-note--marker">
            <span className="label">{t('database.form.b.marked')}</span> {markers.map((p) => p.name || t('common.untitled')).join(', ')} — {t('database.form.b.markedNote')}
          </p>
        )}
        {title && questionOf(cfg, title.id).hidden && <p className="fb-note">{t('database.form.b.titleHidden')}</p>}
      </section>

      {/* § 03 — submit */}
      <section className="fb-sec" aria-labelledby={`${uid}-s3`}>
        <h3 className="fb-sec__label label" id={`${uid}-s3`}>
          § 03 — {t('database.form.b.submit')}
        </h3>
        <div className="fb-submit">
          <label className="label" htmlFor={`${uid}-submit`}>
            {t('database.form.b.submitLabel')}
          </label>
          <input id={`${uid}-submit`} className="input fb-submit__input" placeholder={t('database.form.submitDefault')} maxLength={60} {...submit.props} />
          <span className="btn btn--primary fb-submit__preview" aria-hidden>
            {submit.value.trim() || t('database.form.submitDefault')}
          </span>
        </div>
      </section>

      {/* § 04 — closing */}
      <Closing m={m} labelId={`${uid}-s4`} />

      {/* § 05 — delivery */}
      <section className="fb-sec" aria-labelledby={`${uid}-s5`}>
        <h3 className="fb-sec__label label" id={`${uid}-s5`}>
          § 05 — {t('database.form.b.responses')}
        </h3>
        <p className="fb-text">{t('database.form.b.localRows', { db: dbName })}</p>
        <Tracking m={m} onResponses={onResponses} />
        <WebhookField m={m} fields={fields} />
        <div className="fb-share">
          <button type="button" className="btn btn--ink" onClick={onShare}>
            <Share2 size={14} /> {t('database.form.share.button')}
          </button>
          <span className="fb-share__note">{t('database.form.b.shareNote')}</span>
        </div>
      </section>
    </div>
  )
}

/** § 04: what respondents see after submitting. */
function Closing({ m, labelId }: { m: DbModel; labelId: string }) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const cfg = formConfig(m.view)
  const dbId = m.db.id
  const viewId = m.view.id
  const head = useDraft(cfg.doneTitle ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, doneTitle: v })))
  const msg = useDraft(cfg.doneMessage ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, doneMessage: v })))
  const url = useDraft(cfg.redirectUrl ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, redirectUrl: v.trim() })), 300)
  const typed = url.value.trim()
  const valid = !typed || isValidHttpUrl(typed)
  return (
    <section className="fb-sec" aria-labelledby={labelId}>
      <h3 className="fb-sec__label label" id={labelId}>
        § 04 — {t('database.form.b.closing')}
      </h3>
      <div className="fb-closing">
        <label className="label" htmlFor={`${uid}-dt`}>
          {t('database.form.b.doneTitle')}
        </label>
        <input id={`${uid}-dt`} className="input fb-closing__title" placeholder={t('database.form.done.title')} maxLength={200} {...head.props} />
        <label className="label" htmlFor={`${uid}-dm`}>
          {t('database.form.b.doneMessage')}
        </label>
        <textarea id={`${uid}-dm`} className="input fb-closing__msg" rows={2} placeholder={t('database.form.done.subShared')} maxLength={2000} {...msg.props} />
        <label className="label" htmlFor={`${uid}-ru`}>
          {t('database.form.b.redirect')}
        </label>
        <div>
          <input
            id={`${uid}-ru`}
            className="input mono fb-closing__url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/thanks"
            aria-invalid={!valid || undefined}
            aria-describedby={`${uid}-ru-note`}
            maxLength={2000}
            {...url.props}
          />
          <p className="label fb-closing__note" id={`${uid}-ru-note`}>
            <span className={`led${typed ? (valid ? ' led--ok' : ' led--on') : ''}`} aria-hidden /> {typed ? (valid ? t('database.form.b.redirectOk', { host: hostOf(typed) }) : t('database.form.hook.err.url')) : t('database.form.b.redirectNone')}
          </p>
        </div>
      </div>
      <label className="fb-q__opt fb-closing__again">
        <Switch checked={cfg.allowAnother !== false} label={t('database.form.b.allowAnother')} onChange={(v) => patchForm(dbId, viewId, (c) => ({ ...c, allowAnother: v }))} />
        <span>{t('database.form.b.allowAnother')}</span>
      </label>
    </section>
  )
}

/** The response marker: on / off, and where the responses are. */
function Tracking({ m, onResponses }: { m: DbModel; onResponses: () => void }) {
  const t = useT()
  const marker = markerOf(m.db, m.view)
  const title = formConfig(m.view).title?.trim() || m.dbPage.title.trim() || t('common.untitled')
  const label = t('database.form.b.track')
  return (
    <div className="fb-track">
      <label className="fb-q__opt">
        <Switch checked={!!marker} label={label} onChange={(v) => (v ? startTracking(m.db.id, m.view.id, t('database.form.r.propName'), title) : stopTracking(m.db.id, m.view.id))} />
        <span>{label}</span>
      </label>
      <span className="label fb-track__state">{marker ? t('database.form.r.onState', { prop: marker.prop.name, option: marker.option.name }) : t('database.form.b.trackOff', { prop: t('database.form.r.propName') })}</span>
      {marker && (
        <button type="button" className="fb-act" onClick={onResponses}>
          {t('database.form.b.toResponses')} <ArrowRight size={12} />
        </button>
      )}
    </div>
  )
}

/** "Add a question": a property that isn't asked yet, or a new one ("Create property “X”"). */
function AddQuestion({ m, hidden, onShow }: { m: DbModel; hidden: PropertyDef[]; onShow: (p: PropertyDef) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const createEntry = usePropertyCreate(m.db, { types: FORM_TYPES })
  return (
    <>
      <button type="button" className="fb-hidden__add fb-addq" aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <Plus size={13} aria-hidden />
        <span>{t('database.form.b.addQuestion')}</span>
      </button>
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        width={300}
        searchable
        searchPlaceholder={t('database.form.b.findQuestion')}
        entries={[
          ...(hidden.length ? [{ kind: 'section' as const, label: t('database.form.b.notAsked') }] : [{ kind: 'section' as const, label: t('database.form.b.typeToCreate') }]),
          ...hidden.map((p) => ({ label: p.name || t('common.untitled'), icon: <TypeIcon type={p.type} />, onSelect: () => onShow(p) })),
        ]}
        create={(q) => createEntry(q, () => {})}
      />
    </>
  )
}
