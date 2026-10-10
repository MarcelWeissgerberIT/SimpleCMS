/**
 * The draft popover (a route on one or more rows): an optional instruction with the "@" / "one:" picker for the
 * person's own pages, typed values for routes without a text, "Claude drafts ↵" (a request with no tools) and
 * "Write it myself". Several rows: one slip per row (≤ 10), drafted one after another. Closing it never stops a
 * draft — the dock shows "Drafting …" until the slip lands.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FileText, X } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import type { ID, RouteParam } from '../../../store/types'
import { Popover, virtualAnchor } from '../../../ui/Popover'
import { useLang, useT, t as translate } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { isAIConfigured } from '../../ai/client'
import { HelpLink } from '../../../help'
import { draftSlip, estimateDraft } from '../draft'
import { keyPropOf, useRoutesFor } from '../routes'
import { stage } from '../stage'
import { showDock } from '../hooks'
import { useOutbox, OUTBOX_LIMITS } from '../store'
import type { ResolvedRoute, StageRefusal } from '../types'
import { ServerTag } from './parts'
import { closeDraft, useDraftUI, type DraftRequest } from './draftState'
import { mentionAt, mentionHits, rowHits, type MentionHit } from './mentions'

export const refusalText = (r: { refused: StageRefusal | 'aborted' | 'ai'; detail?: string }) => translate(`features.outbox.refused.${r.refused}`, { detail: r.detail ?? '' })

/** Mounted once (App): the popover while one is open. */
export function DraftHost() {
  const open = useDraftUI((s) => s.open)
  if (!open) return null
  return <DraftPopover key={`${open.dbId}|${open.route.profileId}/${open.route.routeId}|${open.rowIds.join(',')}`} req={open} />
}

function DraftPopover({ req }: { req: DraftRequest }) {
  const t = useT()
  const lang = useLang()
  const routes = useRoutesFor(req.dbId)
  const route = routes.find((r) => r.ref.profileId === req.route.profileId && r.ref.routeId === req.route.routeId) ?? null
  const db = useWorkspace((s) => s.databases[req.dbId])
  const keyProp = keyPropOf(db)
  const [rowIds, setRowIds] = useState<ID[]>(req.rowIds)
  const [instruction, setInstruction] = useState('')
  const [mentions, setMentions] = useState<MentionHit[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const anchor = useMemo(() => (req.anchor && req.anchor.isConnected ? req.anchor : virtualAnchor(() => new DOMRect(window.innerWidth / 2 - 1, 64, 2, 2))), [req.anchor])
  const close = () => closeDraft()

  if (!route) {
    return (
      <Popover open anchor={anchor} onClose={close} placement="bottom-end" className="obx-draft" role="dialog" aria-label={t('features.outbox.draft.label')}>
        <p className="obx-draft__note">{t('features.outbox.refused.noRoute')}</p>
      </Popover>
    )
  }
  const tp = route.draftParam
  const typed = route.params.filter((p) => p.type !== 'text')
  const aiOk = isAIConfigured()

  const go = async (mode: 'claude' | 'self' | 'typed') => {
    if (busy) return
    if (!rowIds.length) return setError(t('features.outbox.draft.pickRow'))
    setError(null)
    const params: Record<string, string | number> = {}
    for (const p of typed) params[p.name] = values[p.name] ?? ''
    const origin = { kind: mode === 'self' ? ('manual' as const) : ('command' as const), ref: `${route.ref.profileId}/${route.ref.routeId}` }
    if (mode === 'typed' || mode === 'self') {
      setBusy(true)
      const made: string[] = []
      for (const rowId of rowIds) {
        const res = await stage({ route: route.ref, rowId, ...(mode === 'self' ? { draft: null } : {}), params, origin, sources: [] })
        if ('refused' in res) {
          setBusy(false)
          return setError(refusalText(res))
        }
        made.push(res.slip.id)
      }
      setBusy(false)
      close()
      if (made[0]) useOutbox.setState({ focus: made[0] })
      showDock(req.dbId)
      toastDone(route, made.length, rowIds[0])
      return
    }
    // Claude drafts: the popover closes, the drafts run on (one after another); the dock shows them
    const ids = mentions.filter((m) => instruction.includes(`@${m.title}`) || instruction.includes(`one:${m.title}`)).map((m) => m.id)
    close()
    showDock(req.dbId)
    void runDrafts(route, rowIds, instruction, ids, req.dbId)
  }

  return (
    <Popover open anchor={anchor} onClose={close} placement="bottom-end" className="obx-draft" role="dialog" aria-label={t('features.outbox.draft.label')} resizable="outbox-draft">
      <div className="obx-draft__head">
        <span className="label">{t('features.outbox.draft.label')}</span>
        <HelpLink id="outbox" />
      </div>
      <div className="obx-draft__route">
        <ServerTag name={route.server.name} />
        <b className="obx-draft__label">{route.label}</b>
        <span className="obx-out" title={t('features.outbox.routes.outTitle')}>
          {t('features.outbox.routes.out')}
        </span>
      </div>
      <RowPicker dbId={req.dbId} keyPropId={keyProp?.id ?? null} rowIds={rowIds} onChange={setRowIds} />
      {tp && (
        <InstructionField
          value={instruction}
          onChange={setInstruction}
          mentions={mentions}
          onMention={(m) => setMentions((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))}
          onRemove={(id) => setMentions((list) => list.filter((x) => x.id !== id))}
          onSubmit={() => void go(aiOk ? 'claude' : 'self')}
        />
      )}
      {typed.map((p) => (
        <ParamField key={p.name} p={p} value={values[p.name] ?? ''} onChange={(v) => setValues((x) => ({ ...x, [p.name]: v }))} onSubmit={() => void go('typed')} />
      ))}
      {rowIds.length > 1 && <p className="obx-draft__note">{t('features.outbox.draft.several', { n: rowIds.length })}</p>}
      {tp && aiOk && rowIds[0] && <Estimate route={route} rowId={rowIds[0]} instruction={instruction} mentions={mentions.map((m) => m.id)} lang={lang} />}
      {tp && !aiOk && <p className="obx-draft__note">{t('features.outbox.draft.noKey')}</p>}
      {error && (
        <p className="obx-draft__error" role="alert">
          {error}
        </p>
      )}
      <div className="obx-draft__keys">
        {tp ? (
          <>
            <button type="button" className="btn btn--primary" disabled={!aiOk || busy || !rowIds.length} onClick={() => void go('claude')} data-testid="outbox-draft-claude">
              {t('features.outbox.draft.claude')}
              <kbd className="kbd">↵</kbd>
            </button>
            <button type="button" className="btn" disabled={busy || !rowIds.length} onClick={() => void go('self')} data-testid="outbox-draft-self">
              {t('features.outbox.draft.self')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--primary" disabled={busy || !rowIds.length} onClick={() => void go('typed')} data-testid="outbox-draft-stage">
            {t('features.outbox.draft.stage')}
            <kbd className="kbd">↵</kbd>
          </button>
        )}
      </div>
    </Popover>
  )
}

function toastDone(route: ResolvedRoute, n: number, firstRow: ID): void {
  const key = rowKeyOf(firstRow)
  useUI.getState().toast({
    message: n === 1 ? translate('features.outbox.draft.done', { label: route.label, key }) : translate('features.outbox.draft.doneN', { n }),
    kind: 'success',
  })
}

function rowKeyOf(rowId: ID): string {
  const s = useWorkspace.getState()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  const k = keyPropOf(db)
  return k ? String(row?.properties[k.id] ?? '') : ''
}

/** The drafts, one after another (in memory: the popover is gone already). */
async function runDrafts(route: ResolvedRoute, rowIds: ID[], instruction: string, mentions: ID[], dbId: ID): Promise<void> {
  let made = 0
  let first: string | null = null
  for (let i = 0; i < rowIds.length; i++) {
    const res = await draftSlip({ route: route.ref, rowId: rowIds[i], instruction, mentions, origin: { kind: 'command', ref: `${route.ref.profileId}/${route.ref.routeId}` }, ...(rowIds.length > 1 ? { step: { n: i + 1, of: rowIds.length } } : {}) })
    if ('refused' in res) {
      useUI.getState().toast({ message: `${route.label} · #${rowKeyOf(rowIds[i])} · ${refusalText(res)}`, kind: 'error', timeout: 8000 })
      continue
    }
    made++
    // the first new slip takes the dock's focus unless the person is on another slip of this database
    if (made === 1)
      useOutbox.setState((s) => {
        const cur = s.focus ? s.slips[s.focus] : null
        return cur && cur.target.dbId === dbId && cur.state !== 'withdrawn' && cur.id !== res.slip.id && rowIds.length > 1 ? {} : { focus: res.slip.id }
      })
  }
  if (made) toastDone(route, made, rowIds[0])
}

function RowPicker({ dbId, keyPropId, rowIds, onChange }: { dbId: ID; keyPropId: ID | null; rowIds: ID[]; onChange: (ids: ID[]) => void }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const [q, setQ] = useState('')
  const hits = useMemo(() => (rowIds.length ? [] : rowHits(dbId, keyPropId, q)), [dbId, keyPropId, q, rowIds.length, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  if (rowIds.length)
    return (
      <ul className="obx-draft__rows" aria-label={t('features.outbox.draft.rows')}>
        {rowIds.map((id) => {
          const p = pages[id]
          return (
            <li key={id} className="obx-draft__row">
              <span className="obx-tt__key">#{keyPropId ? String(p?.properties[keyPropId] ?? '') : ''}</span>
              <span className="obx-draft__rowtitle" title={p?.title}>
                {p?.title || t('common.untitled')}
              </span>
              {rowIds.length > 1 && (
                <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.remove')} onClick={() => onChange(rowIds.filter((x) => x !== id))}>
                  <X size={12} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    )
  return (
    <div className="obx-draft__find">
      <label className="label" htmlFor="obx-find">
        {t('features.outbox.draft.pickRow')}
      </label>
      <input id="obx-find" className="input" data-autofocus value={q} placeholder={t('features.outbox.draft.findRow')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hits[0] && (e.preventDefault(), onChange([hits[0].id]))} />
      <ul className="obx-draft__hits" role="listbox" aria-label={t('features.outbox.draft.rows')}>
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" role="option" aria-selected={false} className="obx-draft__hit" onClick={() => onChange([h.id])}>
              <span className="obx-tt__key">#{h.key}</span>
              <span className="obx-draft__rowtitle">{h.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function InstructionField({
  value,
  onChange,
  mentions,
  onMention,
  onRemove,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  mentions: MentionHit[]
  onMention: (m: MentionHit) => void
  onRemove: (id: ID) => void
  onSubmit: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [closed, setClosed] = useState(false)
  const token = closed ? null : mentionAt(value, caret)
  const hits = useMemo(() => (token ? mentionHits(token.query) : []), [token?.query, token?.from]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(0), [token?.query])

  const pick = (m: MentionHit) => {
    if (!token) return
    const before = value.slice(0, token.from)
    const after = value.slice(caret)
    const insert = `@${m.title} `
    const next = before + insert + after
    onChange(next)
    onMention(m)
    const at = before.length + insert.length
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(at, at)
      setCaret(at)
    })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (hits.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(hits[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setClosed(true)
        return
      }
    }
    // ⌘↵ / Ctrl+↵ does nothing here (it is the send key elsewhere); ↵ drafts, ⇧↵ is a new line
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="obx-draft__field">
      <label className="label" htmlFor="obx-instruction">
        {t('features.outbox.draft.instruction')}
      </label>
      <textarea
        id="obx-instruction"
        ref={ref}
        className="input obx-draft__ta"
        rows={3}
        data-autofocus
        value={value}
        placeholder={t('features.outbox.draft.placeholder')}
        aria-autocomplete="list"
        aria-expanded={hits.length > 0}
        aria-controls={hits.length ? 'obx-mentions' : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setClosed(false)
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={onKey}
      />
      {hits.length > 0 && (
        <ul id="obx-mentions" className="obx-draft__mentionlist" role="listbox" aria-label={t('features.outbox.draft.mentionList')}>
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active} className="obx-draft__mention" data-active={i === active || undefined} onMouseDown={(e) => (e.preventDefault(), pick(h))}>
              <FileText size={13} aria-hidden />
              {h.title}
            </li>
          ))}
        </ul>
      )}
      {mentions.length > 0 && (
        <div className="obx-draft__chips" aria-label={t('features.outbox.draft.mentions')}>
          <span className="label">{t('features.outbox.draft.mentions')}</span>
          {mentions.map((m) => (
            <span key={m.id} className="obx-chip">
              {m.title}
              <button type="button" className="obx-chip__x" aria-label={t('features.outbox.draft.removeMention', { title: m.title })} onClick={() => onRemove(m.id)}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ParamField({ p, value, onChange, onSubmit }: { p: RouteParam; value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  const t = useT()
  const lang = useLang()
  const label = (typeof p.label === 'string' ? p.label : (p.label?.[lang] ?? p.label?.[lang === 'en' ? 'de' : 'en'])) || (p.type === 'minutes' ? t('features.outbox.draft.minutes') : p.type === 'option' ? t('features.outbox.draft.value') : t('features.outbox.draft.number'))
  const id = `obx-p-${p.name}`
  if (p.type === 'option')
    return (
      <fieldset className="obx-draft__field obx-draft__options">
        <legend className="label">{label}</legend>
        {(p.values ?? []).map((v) => (
          <label key={v} className="obx-draft__option">
            <input type="radio" name={id} value={v} checked={value === v} onChange={() => onChange(v)} />
            {v}
          </label>
        ))}
      </fieldset>
    )
  return (
    <div className="obx-draft__field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input obx-draft__num"
        inputMode="numeric"
        data-autofocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onSubmit())}
        {...(p.max ? { 'aria-describedby': `${id}-max` } : {})}
      />
      {p.max !== undefined && (
        <span id={`${id}-max`} className="obx-draft__hint">
          ≤ {p.max}
          {p.round ? ` · ${p.round}` : ''}
        </span>
      )}
    </div>
  )
}

function Estimate({ route, rowId, instruction, mentions, lang }: { route: ResolvedRoute; rowId: ID; instruction: string; mentions: ID[]; lang: 'en' | 'de' }) {
  const t = useT()
  const est = useMemo(() => estimateDraft(route.ref, rowId, instruction, mentions), [route.ref, rowId, instruction, mentions])
  if (!est) return null
  return <p className="obx-draft__est label">{t('features.outbox.draft.estimate', { model: est.model, usd: fmtUsd(est.usd, lang) })}</p>
}

export const DRAFT_ROWS_MAX = OUTBOX_LIMITS.rows
