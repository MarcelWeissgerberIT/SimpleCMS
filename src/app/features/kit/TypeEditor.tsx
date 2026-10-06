/**
 * #/kit/types/<id> — one own property type, edited as a draft (Save / Revert, Mod+S): name, icon,
 * description; its base (fixed once created) with a bound list (select bases), number format, stars;
 * how values look (prefix / suffix / colour / style, with a live preview); its One Script bindings —
 * value · validate · options · format · onChange — each in the One Script editor (completion knows
 * `value`, `old`, `row`), with templates and "Test on a row" (query mode; onChange as a dry run).
 * Saving remembers the code as this device's (team trust); someone else's version shows a banner.
 */
import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, LayoutTemplate, Play, ShieldAlert, X } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { storedTypeOf } from '../../store/kit'
import type { CustomPropBase, CustomPropDisplay, CustomPropType, ID, NumberDisplay, NumberFormat, Page, PropertyDef, PropertyValue } from '../../store/types'
import { useT } from '../../i18n'
import { toast } from '../../store/ui'
import { tagStyle } from '../../lib/colors'
import { Menu } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { syntaxError } from '../script/lang'
import { errorInfo } from '../script/runtime/run'
import { CodeEditor, type EditorError } from '../script/editor/CodeEditor'
import { analyze } from '../script/editor/analyze'
import { propNamesOf, refCandidates, workspaceInfo } from '../script/editor/workspace'
import { T, type Ty, type WsInfo } from '../script/editor/types'
import { summarize } from '../script/ui/summary'
import { errorMessage } from '../script'
import { propsOfType, recordTypesUsingType } from './model'
import { bindingsFor, editorName, formatOf, optionsOf, refusalOf, runCode, trustType, untrustedOf, useKitTrust, type BindingKey, type BindingRun } from './scripts'
import { templatesFor } from './templates'
import { DisplayFrame } from './cells'
import { openReview } from './review'
import { EntryHead, PickButton, SaveBar, Section, Swatches, UsedList, pad2 } from './ui'

const ws = () => useWorkspace.getState()

/** What a draft change means (times and authors are the store's). */
const sig = (x: CustomPropType) => JSON.stringify({ ...x, createdAt: 0, updatedAt: 0, createdBy: null, updatedBy: null })

const NUMBER_FORMATS: NumberFormat[] = ['number', 'comma', 'percent', 'euro', 'dollar', 'pound']
const NUMBER_DISPLAYS: NumberDisplay[] = ['number', 'bar', 'ring']
const STYLES: Array<NonNullable<CustomPropDisplay['style']>> = ['plain', 'badge', 'led', 'bar']

export const baseLabel = (t: ReturnType<typeof useT>, base: CustomPropBase) => (base === 'free' ? t('features.kit.base.free') : t(`database.type.${base}`))

export function TypeEditor({ type, n }: { type: CustomPropType; n: number }) {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly)
  const lists = useWorkspace((s) => s.kit?.lists)
  const databases = useWorkspace((s) => s.databases)
  const kit = useWorkspace((s) => s.kit)
  useKitTrust((s) => s.ok)
  const [draft, setDraft] = useState<CustomPropType>(type)
  const dirty = sig(draft) !== sig(type)
  // the stored type changed elsewhere (another tab, a teammate): an untouched draft follows it
  const [seen, setSeen] = useState(type)
  if (seen !== type) {
    setSeen(type)
    if (sig(draft) === sig(seen)) setDraft(type)
  }
  const patch = (p: Partial<CustomPropType>) => setDraft((d) => ({ ...d, ...p }))
  const setDisplay = (p: Partial<CustomPropDisplay>) => setDraft((d) => ({ ...d, display: { ...(d.display ?? {}), ...p } }))
  const setScript = (key: BindingKey, code: string) => setDraft((d) => ({ ...d, scripts: { ...(d.scripts ?? {}), [key]: code } }))
  const save = () => {
    const clean: CustomPropType = { ...draft, scripts: Object.fromEntries(Object.entries(draft.scripts ?? {}).filter(([, c]) => !!c?.trim())) }
    ws().upsertPropType(clean)
    void trustType(clean)
    toast(t('features.kit.save.saved', { name: clean.name }))
  }

  const untrusted = untrustedOf(type)
  const who = editorName(type)
  const used = useMemo(() => propsOfType(type.id), [type.id, databases]) // eslint-disable-line react-hooks/exhaustive-deps
  const records = useMemo(() => recordTypesUsingType(type.id), [type.id, kit]) // eslint-disable-line react-hooks/exhaustive-deps
  const isOptions = type.base === 'select' || type.base === 'multi_select'

  return (
    <div className="kt-editor" data-testid="kt-type-editor">
      <EntryHead
        code={`PT-${pad2(n)}`}
        icon={draft.icon}
        name={draft.name}
        description={draft.description ?? ''}
        readOnly={readOnly}
        placeholder={t('features.kit.types.namePlaceholder')}
        onIcon={(icon) => patch({ icon })}
        onName={(name) => patch({ name })}
        onDescription={(description) => patch({ description })}
        onDelete={() => {
          const name = type.name
          ws().deletePropType(type.id)
          window.location.hash = '#/kit/types'
          toast(t('features.kit.types.deleted', { name }))
        }}
        extra={<span>{t('features.kit.types.kind')}</span>}
      />
      {untrusted.length > 0 && (
        <div className="kt-banner" role="alert" data-testid="kt-trust-banner">
          <ShieldAlert size={16} strokeWidth={1.8} aria-hidden />
          <span>{who ? t('features.kit.trust.bannerBy', { name: who }) : t('features.kit.trust.banner')}</span>
          <button type="button" className="btn btn--sm" onClick={() => openReview(type.id)}>
            {t('features.kit.trust.review')}
          </button>
        </div>
      )}
      <Section num="01" title={t('features.kit.types.settings')}>
        <div className="kt-grid">
          <span className="label">{t('features.kit.types.base')}</span>
          <span className="kt-spec" data-testid="kt-base">
            <span className="mono">{baseLabel(t, type.base).toUpperCase()}</span>
            <span className="faint">{t('features.kit.types.baseFixed')}</span>
          </span>
          {isOptions && (
            <>
              <span className="label">{t('features.kit.types.list')}</span>
              <PickButton
                value={draft.listId ?? '__none'}
                disabled={readOnly}
                label={t('features.kit.types.list')}
                placeholder={t('features.kit.types.noList')}
                testId="kt-type-list"
                items={[{ value: '__none', label: t('features.kit.types.noList') }, ...Object.values(lists ?? {}).map((l) => ({ value: l.id, label: l.name, hint: String(l.items.length), icon: l.icon ? <PageIcon icon={l.icon} size={14} /> : undefined }))]}
                onChange={(v) => patch({ listId: v === '__none' ? null : v })}
              />
            </>
          )}
          {type.base === 'number' && (
            <>
              <span className="label">{t('database.number.format')}</span>
              <PickButton value={draft.numberFormat ?? 'number'} disabled={readOnly} label={t('database.number.format')} placeholder="" items={NUMBER_FORMATS.map((f) => ({ value: f, label: t(`database.number.fmt.${f}`) }))} onChange={(v) => patch({ numberFormat: v })} />
              <span className="label">{t('database.number.showAs')}</span>
              <Seg value={draft.numberDisplay ?? 'number'} disabled={readOnly} items={NUMBER_DISPLAYS.map((d) => ({ value: d, label: t(`database.number.display.${d}`) }))} onChange={(v) => patch({ numberDisplay: v })} label={t('database.number.showAs')} />
            </>
          )}
          {type.base === 'rating' && (
            <>
              <span className="label">{t('database.rating.max')}</span>
              <Seg value={String(draft.ratingMax ?? 5)} disabled={readOnly} items={['3', '5', '10'].map((v) => ({ value: v, label: v }))} onChange={(v) => patch({ ratingMax: Number(v) })} label={t('database.rating.max')} />
            </>
          )}
        </div>
      </Section>
      <Section num="02" title={t('features.kit.display.title')}>
        <DisplaySettings draft={draft} readOnly={readOnly} setDisplay={setDisplay} />
      </Section>
      <Section num="03" title={t('features.kit.scripts.title')} aside={<span className="mono">{pad2(Object.values(draft.scripts ?? {}).filter((c) => c?.trim()).length)}</span>}>
        <Scripts draft={draft} readOnly={readOnly} setScript={setScript} />
      </Section>
      <Section num="04" title={t('features.kit.used.title')} aside={<span className="mono">{pad2(used.length + records.length)}</span>}>
        <UsedList
          empty={t('features.kit.types.unused')}
          items={[
            ...used.map((u) => ({ key: `${u.db.id}:${u.prop.id}`, dbId: u.db.id, label: <>{u.title || t('common.untitled')} <span className="faint">›</span> {u.prop.name}</>, meta: t('features.kit.used.property') })),
            ...records.map((r) => ({ key: `r:${r.id}`, href: `#/kit/records/${r.id}`, label: r.name, meta: t('features.kit.used.recordType') })),
          ]}
        />
      </Section>
      <SaveBar dirty={dirty} readOnly={readOnly} onSave={save} onRevert={() => setDraft(type)} />
    </div>
  )
}

function Seg<V extends string>({ value, items, onChange, label, disabled }: { value: V; items: Array<{ value: V; label: string }>; onChange: (v: V) => void; label: string; disabled?: boolean }) {
  return (
    <div className="kt-seg" role="radiogroup" aria-label={label}>
      {items.map((i) => (
        <button key={i.value} type="button" role="radio" aria-checked={i.value === value} className={`kt-seg__b${i.value === value ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(i.value)}>
          {i.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ display */

/** A sample value of a base for the preview. */
function Sample({ type }: { type: CustomPropType }) {
  const t = useT()
  const list = type.listId ? ws().kit?.lists[type.listId] : undefined
  switch (type.base) {
    case 'select':
    case 'multi_select': {
      const items = list?.items.slice(0, type.base === 'select' ? 1 : 2) ?? [{ id: 'a', name: t('features.kit.display.sampleOption'), color: 'blue' as const }]
      return (
        <span className="kt-chips">
          {items.map((o) => (
            <span key={o.id} className="tag" style={tagStyle(o.color)}>
              {o.name}
            </span>
          ))}
        </span>
      )
    }
    case 'number':
      return <span className="mono">{type.numberFormat === 'percent' ? '72 %' : '72'}</span>
    case 'checkbox':
      return <span className="mono">✓</span>
    case 'rating':
      return <span className="mono">★★★☆☆</span>
    case 'date':
      return <span>{new Date().toLocaleDateString()}</span>
    case 'person':
      return <span>{t('features.kit.display.samplePerson')}</span>
    default:
      return <span>{t('features.kit.display.sampleText')}</span>
  }
}

function DisplaySettings({ draft, readOnly, setDisplay }: { draft: CustomPropType; readOnly: boolean; setDisplay: (p: Partial<CustomPropDisplay>) => void }) {
  const t = useT()
  const d = draft.display ?? {}
  return (
    <div className="kt-display">
      <div className="kt-grid">
        <span className="label">{t('features.kit.display.prefix')}</span>
        <input className="input kt-short" value={d.prefix ?? ''} maxLength={16} readOnly={readOnly} placeholder="€ · #" aria-label={t('features.kit.display.prefix')} data-testid="kt-prefix" onChange={(e) => setDisplay({ prefix: e.target.value })} />
        <span className="label">{t('features.kit.display.suffix')}</span>
        <input className="input kt-short" value={d.suffix ?? ''} maxLength={16} readOnly={readOnly} placeholder="kg · %" aria-label={t('features.kit.display.suffix')} data-testid="kt-suffix" onChange={(e) => setDisplay({ suffix: e.target.value })} />
        <span className="label">{t('features.kit.display.color')}</span>
        <Swatches value={d.color} disabled={readOnly} label={t('features.kit.display.color')} onChange={(color) => setDisplay({ color })} />
        <span className="label">{t('features.kit.display.style')}</span>
        <Seg value={d.style ?? 'plain'} disabled={readOnly} label={t('features.kit.display.style')} items={STYLES.map((s) => ({ value: s, label: t(`features.kit.display.styles.${s}`) }))} onChange={(style) => setDisplay({ style })} />
      </div>
      <div className="kt-preview" aria-label={t('features.kit.display.preview')}>
        <span className="kt-preview__label label">{t('features.kit.display.preview')}</span>
        <span className="kt-preview__cell" data-testid="kt-preview">
          <DisplayFrame display={d} base={draft.base} ratio={0.72}>
            <Sample type={draft} />
          </DisplayFrame>
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ scripts */

function tyOfBase(base: CustomPropBase): Ty {
  switch (base) {
    case 'number':
    case 'rating':
      return T.number
    case 'checkbox':
      return T.bool
    case 'date':
      return T.date
    case 'multi_select':
      return T.list(T.text)
    case 'person':
      return T.list(T.person)
    default:
      return T.text
  }
}

/** Rows to test on: the rows of databases holding a property of the type, else recent rows anywhere. */
function testRows(typeId: ID): Page[] {
  const s = ws()
  const dbs = new Set(Object.values(s.databases).filter((d) => d.properties.some((p) => p.custom === typeId)).map((d) => d.id))
  const rows = Object.values(s.pages).filter((p) => p.databaseId && !p.trashed && s.databases[p.databaseId] && (!dbs.size || dbs.has(p.databaseId)))
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200)
}

function Scripts({ draft, readOnly, setScript }: { draft: CustomPropType; readOnly: boolean; setScript: (key: BindingKey, code: string) => void }) {
  const t = useT()
  const keys = bindingsFor(draft)
  const [key, setKey] = useState<BindingKey>(() => keys.find((k) => draft.scripts?.[k]?.trim()) ?? 'validate')
  return (
    <div className="kt-scripts">
      <div className="kt-tabs kt-tabs--sub" role="tablist" aria-label={t('features.kit.scripts.title')}>
        {keys.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === key} className="kt-tab" onClick={() => setKey(k)} data-testid={`kt-binding-${k}`}>
            <span className={draft.scripts?.[k]?.trim() ? 'led led--ok' : 'led'} aria-hidden />
            {t(`features.kit.binding.${k}`)}
          </button>
        ))}
      </div>
      <BindingPanel key={key} draft={draft} binding={key} readOnly={readOnly} code={draft.scripts?.[key] ?? ''} onCode={(c) => setScript(key, c)} />
    </div>
  )
}

function BindingPanel({ draft, binding, code, onCode, readOnly }: { draft: CustomPropType; binding: BindingKey; code: string; onCode: (c: string) => void; readOnly: boolean }) {
  const t = useT()
  const rows = useMemo(() => testRows(draft.id), [draft.id])
  const [rowId, setRowId] = useState<ID | null>(rows[0]?.id ?? null)
  const [tryValue, setTryValue] = useState('')
  const [result, setResult] = useState<BindingRun | null>(null)
  const [running, setRunning] = useState(false)
  const [tplAnchor, setTplAnchor] = useState<HTMLElement | null>(null)
  const row = rowId ? ws().pages[rowId] : undefined
  const dbId = row?.databaseId ?? null
  const ownProp = dbId ? ws().databases[dbId]?.properties.find((p) => p.custom === draft.id && p.type === storedTypeOf(draft.base)) : undefined

  const syntax = useMemo(() => (code.trim() ? syntaxError(code) : null), [code])
  const editorError: EditorError | null = syntax ? (() => {
    const info = errorInfo(syntax)
    return info.line !== null ? { start: info.start, end: info.end, line: info.line, message: errorMessage(info, t) } : null
  })() : null
  const analysis = useMemo(() => analyze(code), [code])
  const propNames = useMemo(() => {
    const names = propNamesOf(analysis.dbRefs)
    for (const p of dbId ? (ws().databases[dbId]?.properties ?? []) : []) names.add(p.name)
    return names
  }, [analysis, dbId])
  const info: WsInfo = useMemo(() => {
    const dbName = dbId ? ws().pages[dbId]?.title.trim() || null : null
    const rowTy: Ty = dbId ? T.row({ id: dbId, name: dbName }) : T.page
    const names: Array<[string, Ty | null]> = [
      ['value', tyOfBase(draft.base)],
      ['row', rowTy],
    ]
    if (binding === 'onChange') names.push(['old', tyOfBase(draft.base)])
    return { ...workspaceInfo, globals: () => names }
  }, [dbId, draft.base, binding])
  const templates = templatesFor(binding, draft.base)
  const canTry = binding !== 'value' && binding !== 'options' && ['text', 'free', 'number', 'email', 'url', 'phone', 'checkbox', 'date'].includes(draft.base)

  const test = async () => {
    if (!row || !code.trim() || running) return
    setRunning(true)
    const prop: PropertyDef = ownProp ?? { id: '__kit_test', name: draft.name, type: storedTypeOf(draft.base), custom: draft.id }
    let valuePlain: unknown = undefined
    if (canTry && tryValue.trim()) valuePlain = draft.base === 'number' ? (Number.isFinite(Number(tryValue.replace(',', '.'))) ? Number(tryValue.replace(',', '.')) : tryValue) : draft.base === 'checkbox' ? ['true', 'yes', 'ja', '1', 'x'].includes(tryValue.trim().toLowerCase()) : tryValue
    else if (!ownProp && binding !== 'value' && binding !== 'options') valuePlain = null
    const old = (ownProp ? row.properties[ownProp.id] : null) as PropertyValue
    const r = await runCode(code, draft.name, binding, { row, prop, valuePlain, old }, { mode: binding === 'onChange' ? 'dry' : 'query', trusted: true })
    setRunning(false)
    if (r !== 'untrusted') setResult(r)
  }

  return (
    <div className="kt-binding" data-binding={binding}>
      <p className="kt-note">{t(`features.kit.binding.${binding}Help`)}</p>
      <div className="kt-binding__bar">
        <span className="label kt-binding__scope">{t(binding === 'onChange' ? 'features.kit.scripts.scopeChange' : 'features.kit.scripts.scope')}</span>
        <span className="kt-spacer" />
        {!readOnly && templates.length > 0 && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={(e) => setTplAnchor(e.currentTarget)} data-testid="kt-templates">
            <LayoutTemplate size={13} strokeWidth={1.8} aria-hidden /> {t('features.kit.scripts.templates')}
          </button>
        )}
        {!readOnly && code.trim() && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onCode('')}>
            <X size={13} strokeWidth={1.8} aria-hidden /> {t('features.kit.scripts.clear')}
          </button>
        )}
      </div>
      <div className="kt-code">
        <CodeEditor
          value={code}
          onChange={onCode}
          error={editorError}
          readOnly={readOnly}
          refs={(q) => refCandidates(q, null)}
          ws={info}
          propNames={propNames}
          ariaLabel={t('features.kit.scripts.codeLabel', { binding: t(`features.kit.binding.${binding}`) })}
          onKey={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void test()
              return true
            }
            return false
          }}
        />
      </div>
      <div className="kt-tester" aria-label={t('features.kit.test.title')}>
        <span className="label">{t('features.kit.test.title')}</span>
        <PickButton
          value={rowId}
          placeholder={t('features.kit.test.noRow')}
          label={t('features.kit.test.row')}
          testId="kt-test-row"
          items={rows.map((r) => ({ value: r.id, label: r.title.trim() || t('common.untitled'), hint: ws().pages[r.databaseId ?? '']?.title.trim() ?? '' }))}
          onChange={(v) => {
            setRowId(v)
            setResult(null)
          }}
        />
        {canTry && <input className="input kt-tester__value" value={tryValue} placeholder={t('features.kit.test.valuePlaceholder')} aria-label={t('features.kit.test.value')} data-testid="kt-test-value" onChange={(e) => setTryValue(e.target.value)} />}
        <button type="button" className="btn btn--sm" disabled={!row || !code.trim() || !!syntax || running} onClick={() => void test()} data-testid="kt-test-run">
          {binding === 'onChange' ? <FlaskConical size={13} strokeWidth={1.8} aria-hidden /> : <Play size={11} strokeWidth={2} aria-hidden />} {binding === 'onChange' ? t('features.kit.test.dry') : t('features.kit.test.run')}
        </button>
      </div>
      {result && <TestResult binding={binding} r={result} draft={draft} />}
      <Menu
        open={!!tplAnchor}
        anchor={tplAnchor}
        onClose={() => setTplAnchor(null)}
        entries={templates.map((tpl) => ({ label: t(`features.kit.tpl.${tpl.id}`), onSelect: () => onCode(tpl.build({ base: draft.base, dbId })) }))}
      />
    </div>
  )
}

function TestResult({ binding, r, draft }: { binding: BindingKey; r: BindingRun; draft: CustomPropType }) {
  const t = useT()
  if (!r.ok)
    return (
      <div className="kt-result kt-result--err" role="status" data-testid="kt-test-result">
        <span className="led kt-led--err" aria-hidden /> <span>{r.error}</span>
      </div>
    )
  let body: React.ReactNode = <span className="mono">{r.text || '—'}</span>
  if (binding === 'validate') {
    const no = refusalOf(r.plain)
    body = no ? <span>{t('features.kit.test.refused', { msg: no })}</span> : <span>{t('features.kit.test.accepted')}</span>
  } else if (binding === 'format') {
    body = (
      <DisplayFrame display={draft.display} base={draft.base}>
        <span>{formatOf(r) || '—'}</span>
      </DisplayFrame>
    )
  } else if (binding === 'options') {
    const opts = optionsOf(r.plain)
    body = opts.length ? (
      <span className="kt-chips">
        {opts.slice(0, 30).map((o) => (
          <span key={o.name} className="tag" style={tagStyle((o.color as never) ?? 'default')}>
            {o.name}
          </span>
        ))}
        {opts.length > 30 && <span className="faint">+{opts.length - 30}</span>}
      </span>
    ) : (
      <span>{t('features.kit.test.noOptions')}</span>
    )
  } else if (binding === 'onChange') {
    const lines = summarize(r.result.changes, r.result.effects, 'dry', t)
    body = lines.length ? (
      <ul className="kt-result__lines">
        {lines.map((l) => (
          <li key={l.key}>{l.text}</li>
        ))}
      </ul>
    ) : (
      <span>{t('features.kit.test.nothing')}</span>
    )
  }
  const refused = binding === 'validate' && !!refusalOf(r.plain)
  return (
    <div className={`kt-result${refused ? ' kt-result--warn' : ''}`} role="status" data-testid="kt-test-result">
      <span className={refused ? 'led kt-led--err' : 'led led--ok'} aria-hidden />
      <span className="kt-result__body">{body}</span>
      <span className="kt-result__ms label">{r.result.ms} ms</span>
    </div>
  )
}
