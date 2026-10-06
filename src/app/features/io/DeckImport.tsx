/**
 * The PowerPoint and Claude Design steps of the Import dialog (ImportModal.tsx). Both end in a finished
 * ImportPlan that the dialog writes like any other import (progress, report, one Undo):
 *  - DeckStep: the preview of a read .pptx — slides, pictures, tables, notes, what does not come over 1:1 —
 *    the page title and the layout (one page with a heading per slide / a page per slide) → Import
 *  - DesignStep: "Take over from Claude Design" — three slots (HTML export, PPTX export, screenshots; a file
 *    dropped anywhere on the step goes into its slot), the design tokens read from them, the name,
 *    "Describe the screenshots with Claude" (asks first, needs the key) and "Save the style to One memory"
 *    (an Example with a tag) → Import
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { FileCode2, Images, Presentation, X } from 'lucide-react'
import { Led, Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { HelpLink } from '../../help'
import { useWorkspace } from '../../store/store'
import { ArchiveTooLargeError, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, basename, expandZip, extname, zipBudget, type ImportEntry, type ImportPlan } from './import/plan'
import { deckStats, PptxError, type PptxDeck, type PptxLost } from './import/pptx'
import { deckPlan, deckTitle, foldsTitle, slideTitle, type DeckLayout } from './import/deck'
import { deckReport, designPlan, designStyle, readDesignHtml, type DesignParts, type ReadHtml } from './import/design'
import { isEmptyStyle, styleBlocks, styleNote, type DesignStyle } from './import/style'
import { deckLabels, pptxErrorText, readDeck, styleLabels } from './import/labels'
import type { ImportResult } from './import/apply'
import type { ReportItem } from './import/report'
import { exampleByTag, savePatternExample, slugTag, TAG_RE } from '../ai/memory/example'
import { Readout } from './parts'
import { onRovingKey } from './roving'
import './deck.css'

const plural = (n: number) => (n === 1 ? 'one' : 'other')
const stem = (name: string) => basename(name).replace(/\.[^.]+$/, '')
const LOST: PptxLost[] = ['chart', 'smartart', 'media', 'ole', 'picture']

/** What the dialog does after writing a plan (the done step's keys). */
export interface ImportExtra {
  /** the page "Present" opens */
  present?: string | null
  /** One memory: the example saved (or why not) */
  memory?: { tag: string; how: 'new' | 'replaced' } | { failed: true }
  /** undo what `after` added (the memory entry) */
  undo?: () => void
}

export type OnPlan = (plan: ImportPlan, label: string, after?: (result: ImportResult) => ImportExtra) => void

/* ------------------------------------------------------------------ */
/* PowerPoint                                                           */
/* ------------------------------------------------------------------ */

export function DeckStep({ deck, fileName, onCancel, onImport }: { deck: PptxDeck; fileName: string; onCancel: () => void; onImport: OnPlan }) {
  const t = useT()
  const fallback = deckTitle(deck, stem(fileName))
  const [title, setTitle] = useState(fallback)
  const [layout, setLayout] = useState<DeckLayout>('page')
  const stats = deckStats(deck)
  const folded = foldsTitle(deck)
  const L = deckLabels()
  const titleRef = useRef<HTMLInputElement>(null)

  // the preview opens at its top, the title ready (Enter imports)
  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.closest('.modal__body')?.scrollTo({ top: 0 })
  }, [])

  const go = () => {
    const plan = deckPlan(deck, { layout, title: title.trim() || fallback, labels: L, name: fileName })
    plan.report = deckReport(deck, fileName)
    const root = plan.roots[0]
    onImport(plan, fileName, (result) => ({ present: layout === 'page' ? result.ids[root] : null }))
  }

  return (
    <div className="io-deck" data-testid="pptx-preview">
      <div className="io-backup__file">
        <span className="label">{t('features.imp.pptx.label')}</span>
        <span className="mono io-backup__name">{fileName}</span>
        <span className="faint mono">{t(`features.imp.pptx.slides.${plural(stats.slides)}`, { n: stats.slides })}</span>
      </div>
      <label className="io-deck__field">
        <span className="label">{t('features.imp.pptx.title')}</span>
        <input
          ref={titleRef}
          className="input"
          value={title}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              go()
            }
          }}
        />
      </label>
      <div className="io-readouts io-readouts--sm">
        <Readout value={stats.slides} label={t('features.imp.pptx.r.slides')} />
        <Readout value={stats.images} label={t('features.imp.pptx.r.pictures')} />
        <Readout value={stats.tables} label={t('features.imp.pptx.r.tables')} />
        <Readout value={stats.notes} label={t('features.imp.pptx.r.notes')} />
      </div>
      <ol className="io-deck__slides" aria-label={t('features.imp.pptx.list')}>
        {deck.slides.map((s, i) => {
          const tags = [
            ...(folded && i === 0 ? [t('features.imp.pptx.tag.titlePage')] : []),
            ...(s.tables ? [t('features.imp.pptx.tag.table')] : []),
            ...(s.images ? [t('features.imp.pptx.tag.img', { n: s.images })] : []),
            ...(s.notes.length ? [t('features.imp.pptx.tag.notes')] : []),
            ...(s.hidden ? [t('features.imp.pptx.tag.hidden')] : []),
          ]
          return (
            <li key={s.no} data-folded={(folded && i === 0) || undefined}>
              <span className="io-deck__no mono">{String(s.no).padStart(2, '0')}</span>
              <span className="io-deck__name">{slideTitle(s, L)}</span>
              {tags.length > 0 && <span className="io-deck__tags mono">{tags.join(' · ')}</span>}
            </li>
          )
        })}
      </ol>
      {folded && <p className="io-deck__note faint">{t('features.imp.pptx.folded')}</p>}
      {LOST.some((k) => stats.lost[k]) && (
        <div className="io-deck__lost" role="note" data-testid="pptx-lost">
          <span className="label">{t('features.imp.pptx.lost.title')}</span>
          <ul>
            {LOST.filter((k) => stats.lost[k]).map((k) => (
              <li key={k}>{t(`features.imp.pptx.lost.${k}.${plural(stats.lost[k])}`, { n: stats.lost[k] })}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="io-choice" role="radiogroup" aria-label={t('features.imp.pptx.layout')} onKeyDown={(e) => onRovingKey(e)}>
        {(['page', 'pages'] as const).map((m, i) => (
          <button key={m} type="button" role="radio" aria-checked={layout === m} tabIndex={layout === m ? 0 : -1} className="io-choice__opt" onClick={() => setLayout(m)}>
            <span className="io-choice__pos mono">{String.fromCharCode(65 + i)}</span>
            <span className="io-choice__text">
              <span className="io-choice__title">{t(`features.imp.pptx.layout.${m}`)}</span>
              <span className="io-choice__desc muted">{t(`features.imp.pptx.layout.${m}Desc`)}</span>
            </span>
            <span className="io-choice__led">
              <Led state={layout === m ? 'on' : 'off'} />
            </span>
          </button>
        ))}
      </div>
      <div className="io-actions io-deck__actions">
        <span className="io-deck__local label">{t('features.imp.pptx.local')}</span>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" onClick={go} data-testid="pptx-import">
          {t(`features.imp.pptx.import.${plural(stats.slides)}`, { n: stats.slides })}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Claude Design                                                        */
/* ------------------------------------------------------------------ */

type Slot = 'html' | 'pptx' | 'shots'

interface HtmlPart {
  name: string
  entries: ImportEntry[]
  read: ReadHtml
}

interface Shot {
  file: File
  url: string
}

const SHOT_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const slotOf = (name: string): Slot | null => {
  const ext = extname(name)
  if (ext === 'html' || ext === 'htm' || ext === 'zip') return 'html'
  if (ext === 'pptx') return 'pptx'
  return SHOT_EXT.has(ext) ? 'shots' : null
}
const ACCEPT: Record<Slot, string> = { html: '.html,.htm,.zip', pptx: '.pptx', shots: 'image/png,image/jpeg,image/webp,image/gif' }
const autoTag = (name: string) => `design-${slugTag(name) || 'style'}`.slice(0, 32).replace(/-+$/, '')

export function DesignStep({ onCancel, onImport }: { onCancel: () => void; onImport: OnPlan }) {
  const t = useT()
  const lang = useLang()
  const [html, setHtml] = useState<HtmlPart | null>(null)
  const [deck, setDeck] = useState<{ name: string; deck: PptxDeck } | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [name, setName] = useState('')
  const [describe, setDescribe] = useState(false)
  const [remember, setRemember] = useState(false)
  const [tag, setTag] = useState('')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [reading, setReading] = useState<Slot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState<Slot | 'all' | null>(null)
  const keyOk = useWorkspace((s) => !!s.settings.aiApiKey)
  const inputs = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({})
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  const abort = useRef<AbortController | null>(null)

  // thumbnails: object URLs go with the step
  useEffect(
    () => () => {
      for (const s of shotsRef.current) URL.revokeObjectURL(s.url)
      abort.current?.abort()
    },
    [],
  )

  const style: DesignStyle = useMemo(() => designStyle(html?.read ?? null, deck?.deck ?? null), [html, deck])
  const hasStyle = !isEmptyStyle(style)
  const autoName = html?.read.title || (deck ? deckTitle(deck.deck, stem(deck.name)) : '') || (shots[0] ? stem(shots[0].file.name) : '')
  const finalName = name.trim() || autoName || 'Claude Design'
  const finalTag = slugTag(tag) || autoTag(finalName)
  const tagOk = TAG_RE.test(finalTag)
  const taken = remember && tagOk ? exampleByTag(finalTag) : null
  const canDescribe = shots.length > 0 && keyOk

  const add = async (files: File[], only?: Slot) => {
    setError(null)
    setArmed(false)
    const bad: string[] = []
    for (const file of files) {
      const slot = slotOf(file.name)
      if (!slot || (only && slot !== only)) {
        bad.push(file.name)
        continue
      }
      if (slot === 'shots') {
        setShots((list) => [...list, { file, url: URL.createObjectURL(file) }])
        continue
      }
      setReading(slot)
      try {
        const data = new Uint8Array(await file.arrayBuffer())
        if (slot === 'pptx') setDeck({ name: file.name, deck: readDeck(data) })
        else {
          const entries = extname(file.name) === 'zip' ? await expandZip(data, '', 0, zipBudget()) : [{ path: file.name, data }]
          const read = readDesignHtml({ name: file.name, entries })
          if (!read) setError(t('features.imp.design.err.html'))
          else setHtml({ name: file.name, entries, read })
        }
      } catch (e) {
        if (e instanceof PptxError || slot === 'pptx') setError(pptxErrorText(e, lang))
        else if (e instanceof ArchiveTooLargeError) {
          const nf = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB')
          setError(t('features.io.err.tooLarge', { mb: nf.format(ZIP_MAX_BYTES / 1048576), files: nf.format(ZIP_MAX_ENTRIES) }))
        }
        else setError(t('features.io.err.generic', { msg: (e as Error)?.message ?? String(e) }))
      } finally {
        setReading(null)
      }
    }
    if (bad.length) setError(t('features.imp.design.err.shot', { name: bad.join(', ') }))
  }

  const removeShot = (i: number) => {
    setArmed(false)
    setShots((list) => {
      URL.revokeObjectURL(list[i].url)
      return list.filter((_, k) => k !== i)
    })
  }

  const drop = (e: DragEvent, slot?: Slot) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(null)
    if (busy) return
    void add([...e.dataTransfer.files], slot)
  }
  const dragOver = (e: DragEvent, slot: Slot | 'all') => {
    e.preventDefault()
    e.stopPropagation()
    if (!busy && over !== slot) setOver(slot)
  }

  const go = async () => {
    if (busy) return
    if (!html && !deck && !shots.length) return setError(t('features.imp.design.err.nothing'))
    if (remember && hasStyle && !tagOk) return setError(t('features.imp.design.tagBad'))
    const ask = describe && canDescribe
    if (ask && !armed) return setArmed(true)
    setError(null)
    const ctrl = new AbortController()
    abort.current = ctrl
    const parts: DesignParts = { name: finalName, html: html ? { name: html.name, entries: html.entries } : null, deck, shots: [] }
    const report: ReportItem[] = []
    try {
      const { describeShot } = ask ? await import('./import/shots') : { describeShot: null }
      for (let i = 0; i < shots.length; i++) {
        const s = shots[i]
        const data = new Uint8Array(await s.file.arrayBuffer())
        let d = {}
        if (describeShot) {
          setBusy(t('features.imp.design.describing', { i: i + 1, n: shots.length }))
          try {
            d = await describeShot(s.file, lang === 'de' ? 'de' : 'en', ctrl.signal)
          } catch (e) {
            if (ctrl.signal.aborted) return
            console.warn('[import] screenshot not described', e)
            report.push({ code: 'describe', detail: s.file.name })
          }
        }
        parts.shots.push({ name: s.file.name, data, ...d })
      }
    } finally {
      setBusy(null)
    }
    const source = html?.name ?? deck?.name ?? finalName
    const labels = styleLabels(style, source)
    const plan = designPlan(parts, html?.read ?? null, hasStyle ? styleNote(style, labels) : null, {
      deck: deckLabels(),
      screenshots: t('features.imp.design.screenshots'),
      shotText: t('features.imp.design.shotText'),
    })
    plan.report = [...(plan.report ?? []), ...report]
    const deckKey = plan.nodes.find((n) => n.parentKey === plan.roots[0])?.key ?? null
    const keep = remember && hasStyle
    const pattern = [{ type: 'paragraph', content: [{ type: 'text', text: t('features.imp.design.memoryIntro') }] }, ...styleBlocks(style, labels)]
    onImport(plan, source, (result) => {
      const extra: ImportExtra = { present: deckKey ? result.ids[deckKey] : null }
      if (!keep || !result.rootId) return extra
      try {
        const saved = savePatternExample({ tag: finalTag, title: t('features.imp.design.memoryTitle', { name: finalName }), pattern, example: exampleOf(result), sourcePageId: result.rootId })
        extra.memory = { tag: finalTag, how: saved.how }
        extra.undo = saved.undo
      } catch (e) {
        console.warn('[import] style not saved to memory', e)
        extra.memory = { failed: true }
      }
      return extra
    })
  }

  const slot = (id: Slot, icon: ReactNode, filled: ReactNode, multiple = false) => (
    <div
      className="io-slot"
      data-slot={id}
      data-over={over === id || undefined}
      data-filled={(id === 'html' ? !!html : id === 'pptx' ? !!deck : shots.length > 0) || undefined}
      onDragOver={(e) => dragOver(e, id)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
      onDrop={(e) => drop(e, id)}
    >
      <span className="io-slot__icon" aria-hidden>
        {icon}
      </span>
      <span className="io-slot__text">
        <span className="io-slot__name">{t(`features.imp.design.slot.${id}`)}</span>
        <span className="io-slot__how">{reading === id ? t('features.imp.design.read.reading') : (filled ?? t(`features.imp.design.slot.${id}How`))}</span>
      </span>
      <button type="button" className="btn btn--sm" onClick={() => inputs.current[id]?.click()} disabled={!!busy} aria-label={`${t(multiple && shots.length ? 'features.imp.design.slot.add' : 'features.imp.design.slot.choose')} · ${t(`features.imp.design.slot.${id}`)}`}>
        {t(multiple && shots.length ? 'features.imp.design.slot.add' : 'features.imp.design.slot.choose')}
      </button>
      <input
        ref={(el) => {
          inputs.current[id] = el
        }}
        type="file"
        hidden
        multiple={multiple}
        accept={ACCEPT[id]}
        data-slot-input={id}
        onChange={(e) => {
          void add([...(e.target.files ?? [])], id)
          e.target.value = ''
        }}
      />
    </div>
  )

  const fileLine = (fileName: string, spec: string, onRemove: () => void) => (
    <span className="io-slot__file">
      <span className="mono">{fileName}</span>
      <span className="faint"> · {spec}</span>
      <button type="button" className="io-slot__x" onClick={onRemove} aria-label={t('features.imp.design.slot.remove', { name: fileName })} title={t('features.imp.design.slot.remove', { name: fileName })}>
        <X size={12} aria-hidden />
      </button>
    </span>
  )

  return (
    <div
      className="io-design"
      data-testid="design-import"
      data-over={over === 'all' || undefined}
      onDragOver={(e) => dragOver(e, 'all')}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
      onDrop={(e) => drop(e)}
    >
      <div className="io-design__head">
        <span className="label">§ IO-CD</span>
        <span className="io-design__title display">{t('features.imp.design.title')}</span>
        <HelpLink id="claude-design" topic={t('features.imp.design.help')} />
      </div>
      <p className="io-design__intro muted">{t('features.imp.design.intro')}</p>

      <div className="io-slots" role="group" aria-label={t('features.imp.design.slots')}>
        {slot(
          'html',
          <FileCode2 size={16} strokeWidth={1.7} />,
          html ? fileLine(html.name, t('features.imp.design.read.html', { colors: html.read.style.colors.length, fonts: html.read.style.fonts.length, sizes: html.read.style.sizes.length }), () => setHtml(null)) : null,
        )}
        {slot(
          'pptx',
          <Presentation size={16} strokeWidth={1.7} />,
          deck ? fileLine(deck.name, t('features.imp.design.read.pptx', { slides: deck.deck.slides.length, colors: deck.deck.theme?.colors.length ?? 0 }), () => setDeck(null)) : null,
        )}
        {slot('shots', <Images size={16} strokeWidth={1.7} />, shots.length ? <span className="faint">{t(`features.imp.design.read.shots.${plural(shots.length)}`, { n: shots.length })}</span> : null, true)}
        {shots.length > 0 && (
          <ul className="io-shots" aria-label={t('features.imp.design.slot.shots')}>
            {shots.map((s, i) => (
              <li key={s.url}>
                <img src={s.url} alt={s.file.name} draggable={false} />
                <button type="button" className="io-slot__x" onClick={() => removeShot(i)} disabled={!!busy} aria-label={t('features.imp.design.slot.remove', { name: s.file.name })}>
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Tokens style={style} />

      <label className="io-deck__field">
        <span className="label">{t('features.imp.design.name')}</span>
        <input className="input" value={name} placeholder={autoName || 'Claude Design'} spellCheck={false} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="io-opts">
        <div className="io-opt" data-disabled={!canDescribe || undefined}>
          <span className="io-opt__text">
            <span className="io-opt__title">{t('features.imp.design.describe')}</span>
            <span className="io-opt__desc muted">{shots.length && !keyOk ? t('features.imp.design.describeNoKey') : t('features.imp.design.describeDesc')}</span>
          </span>
          <Switch
            checked={describe && canDescribe}
            disabled={!canDescribe || !!busy}
            label={t('features.imp.design.describe')}
            onChange={(v) => {
              setDescribe(v)
              setArmed(false)
            }}
          />
        </div>
        <div className="io-opt" data-disabled={!hasStyle || undefined}>
          <span className="io-opt__text">
            <span className="io-opt__title">{t('features.imp.design.remember')}</span>
            <span className="io-opt__desc muted">{hasStyle ? t('features.imp.design.rememberDesc', { tag: finalTag }) : t('features.imp.design.rememberNone')}</span>
          </span>
          <Switch checked={remember && hasStyle} disabled={!hasStyle || !!busy} label={t('features.imp.design.remember')} onChange={setRemember} />
          {remember && hasStyle && (
            <label className="io-opt__tag">
              <span className="label">{t('features.imp.design.tag')}</span>
              <span className="io-opt__hash mono" aria-hidden>
                #
              </span>
              <input className="input mono" value={tag} placeholder={autoTag(finalName)} spellCheck={false} aria-invalid={!tagOk || undefined} onChange={(e) => setTag(e.target.value.toLowerCase())} />
              {taken && <span className="io-opt__taken faint">{t('features.imp.design.tagTaken', { tag: finalTag })}</span>}
              {!tagOk && <span className="io-inline-error">{t('features.imp.design.tagBad')}</span>}
            </label>
          )}
        </div>
      </div>

      {armed && describe && canDescribe && (
        <div className="io-warn" role="alert" data-testid="design-confirm">
          <div className="io-error__stripe" />
          <p>{t(`features.imp.design.confirm.${plural(shots.length)}`, { n: shots.length })}</p>
        </div>
      )}
      {error && (
        <p className="io-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="io-actions">
        {busy && (
          <span className="io-design__busy label" aria-live="polite">
            <Led state="on" /> {busy}
          </span>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            abort.current?.abort()
            onCancel()
          }}
        >
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void go()} disabled={!!busy || !!reading} data-testid="design-import-go">
          {describe && canDescribe && armed ? t('features.imp.design.send') : t('features.imp.design.import')}
        </button>
      </div>
    </div>
  )
}

/** The design tokens read so far: swatches (the design's own colours), fonts, sizes, radii. */
function Tokens({ style }: { style: DesignStyle }) {
  const t = useT()
  const L = styleLabels(style, '')
  if (isEmptyStyle(style))
    return (
      <div className="io-tokens io-tokens--empty" data-testid="design-tokens">
        <span className="label">{t('features.imp.design.tokens')}</span>
        <span className="faint">{t('features.imp.design.tokens.none')}</span>
      </div>
    )
  return (
    <div className="io-tokens" data-testid="design-tokens">
      <span className="label">{t('features.imp.design.tokens')}</span>
      {style.colors.length > 0 && (
        <ul className="io-tokens__swatches" aria-label={L.palette}>
          {style.colors.map((c) => (
            <li key={c.hex} title={`${c.hex} · ${L.roleName(c.role, c.n)}${c.token ? ` · ${c.token}` : ''}`}>
              {/* the design's own colour (data, not a token of One) */}
              <span className="io-tokens__chip" style={{ background: c.hex }} />
              <span className="io-tokens__hex mono">{c.hex}</span>
              <span className="io-tokens__role">{L.roleName(c.role, c.n)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="io-tokens__spec mono">
        {style.fonts.length > 0 && <span>{style.fonts.map((f) => f.family).join(' / ')}</span>}
        {(['px', 'pt'] as const).map((unit) => {
          const list = style.sizes.filter((s) => s.unit === unit)
          return list.length ? (
            <span key={unit}>
              {list.map((s) => `${Math.round(s.value * 10) / 10}`).join(' · ')} {unit}
            </span>
          ) : null
        })}
        {style.radii.length > 0 && (
          <span>
            {L.radii} {style.radii.join(' · ')}
          </span>
        )}
      </div>
    </div>
  )
}

/** The first text blocks of what was imported (the example under the pattern; ≤ ~2,500 characters). */
function exampleOf(result: ImportResult) {
  const pages = useWorkspace.getState().pages
  const root = result.rootId ? pages[result.rootId] : undefined
  const deckId = Object.values(result.ids).find((id) => id !== result.rootId && pages[id]?.parentId === result.rootId)
  const TEXT = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'callout', 'table'])
  const pick = (blocks: Array<{ type?: string; content?: unknown[] }>) => {
    const out: typeof blocks = []
    let chars = 0
    for (const b of blocks) {
      if (!TEXT.has(b.type ?? '')) continue
      const size = JSON.stringify(b).length / 3
      if (out.length && chars + size > 2500) break
      out.push(b)
      chars += size
    }
    return out
  }
  const fromRoot = pick(root?.content?.content ?? [])
  return (fromRoot.length ? fromRoot : pick((deckId ? pages[deckId]?.content?.content : null) ?? [])) as JSONContent[]
}
