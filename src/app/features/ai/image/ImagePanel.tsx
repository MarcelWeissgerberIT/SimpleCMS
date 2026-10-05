/**
 * The image half of the AI panel (AIMenu.tsx): the actions it lists for an image, and — for a run about an
 * image — the result body (alt text + caption fields, the tables found, a database preview) and the result
 * keys (Apply / Insert below / as table · spreadsheet · database / Upload a copy …).
 *
 * The panel keeps its keyboard flow: the keys come back as rows of its list, the body only shows.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import {
  ArrowDownToLine,
  ArrowLeft,
  Captions,
  Check,
  Copy,
  Database,
  ImageUp,
  MessageSquareText,
  RotateCcw,
  ScanText,
  Sheet,
  Table2,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Kbd } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { TodbPreview } from '../todb/TodbPreview'
import { effectiveView, initialDraft, type TableDraft } from '../todb/plan'
import type { AIRun, RunRequest } from '../runs'
import { headerNames, parseDescription, parseTables, spreadsheetJson, tableBlocks, tablePlan, tablesMarkdown, type ImageTable } from './answers'
import { applyDescription, createImageDatabase, imageRequest, insertBelowImage, insertMarkdownBelow, runImage, uploadImageCopy } from './actions'
import { formatBytes } from './load'
import { imageTarget, type ImageHit } from './locate'
import { isStructured, type ImageAction } from './request'
import type { RunTarget } from '../runsTarget'
import './image.css'

/** A row of the panel's list (the shape AIMenu renders). */
export interface ImageRow {
  id: string
  label: ReactNode
  code?: string
  icon?: LucideIcon
  group?: string
  run: () => void
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
}

export const IMAGE_ICONS: Record<ImageAction, LucideIcon> = { describe: Captions, read: ScanText, table: Table2, ask: MessageSquareText }

const KEYWORDS: Record<ImageAction, string> = {
  describe: 'image alt text caption describe bild alternativtext bildunterschrift beschreiben',
  read: 'image ocr text read transcribe extract bild text auslesen lesen abschreiben',
  table: 'image table spreadsheet database extract bild tabelle tabellenkalkulation datenbank',
  ask: 'image question ask bild frage fragen',
}

/** The image actions the panel lists for an image (`ask` only focuses the prompt). */
export function imageActionRows(
  t: ReturnType<typeof useT>,
  run: (a: ImageAction) => void,
  ask: () => void,
): Array<{ id: string; label: string; code: string; icon: LucideIcon; group: string; keywords: string; run: () => void }> {
  const group = t('features.ai.image.group')
  return (['describe', 'read', 'table', 'ask'] as const).map((a) => ({
    id: `img-${a}`,
    label: t(`features.ai.image.act.${a}${a === 'ask' ? 'Menu' : ''}`),
    code: a === 'describe' ? 'ALT' : a === 'read' ? 'OCR' : a === 'table' ? 'TBL' : 'ASK',
    icon: IMAGE_ICONS[a],
    group,
    keywords: KEYWORDS[a],
    run: a === 'ask' ? ask : () => run(a),
  }))
}

/** A revision of an image answer: another question, or what to do differently. */
export function refineImage(req: Extract<RunRequest, { kind: 'image' }>, text: string): RunRequest {
  return req.action === 'ask' ? { ...req, question: text.trim() } : { ...req, instruction: text.trim() }
}

/** The target of an image run in the live editor: the image found again (lost when it is gone). */
export function imageRunTarget(editor: Editor, run: AIRun, target: RunTarget): RunTarget {
  const hit = runImage(editor, run)
  if (!hit) return target.lost ? target : { ...target, lost: true }
  if (!target.lost && hit.pos === target.from) return target
  return imageTarget(editor.state.doc, hit.pos)
}

export interface ImagePanelOptions {
  editor: Editor
  pageId: string
  /** the panel's run when it is an image request */
  run: AIRun | null
  phase: 'idle' | 'streaming' | 'done' | 'error'
  /** a new run in place of this one (Retry, after "Upload a copy") */
  start: (req: RunRequest, target?: RunTarget) => void
  /** the result is in the page: the run is done with, the panel closes */
  finish: () => void
  discard: () => void
  copy: (text: string) => void
}

export interface ImagePanel {
  /** the body under the output bar (null: none of the image's) */
  body: ReactNode
  /** the keys of a finished / failed image run (null: the panel's own) */
  rows: ImageRow[] | null
  /** the answer is JSON: the panel hides the raw text and the word count */
  structured: boolean
  /** which set of keys shows ('tables' → 'db' …): the panel's highlight goes back to the first key when it changes */
  mode: string
}

/** The image part of the panel for its run (does nothing for other runs). */
export function useImagePanel({ editor, pageId, run, phase, start, finish, discard, copy }: ImagePanelOptions): ImagePanel {
  const t = useT()
  const lang = useLang()
  const req = run?.req.kind === 'image' ? run.req : null
  const output = run?.output ?? ''
  const done = phase === 'done' && !!req
  const desc = useMemo(() => (done && req?.action === 'describe' ? parseDescription(output) : null), [done, req?.action, output])
  const tables = useMemo(() => (done && req?.action === 'table' ? parseTables(output) : null), [done, req?.action, output])
  const [edit, setEdit] = useState<{ id: string; alt: string; caption: string } | null>(null)
  const [db, setDb] = useState<{ id: string; draft: TableDraft } | null>(null)
  const [busy, setBusy] = useState(false)

  const column = (n: number) => t('features.ai.image.column', { n })
  const sheet = (n: number) => t('features.ai.image.sheet', { n })
  const draftDesc = run && desc ? (edit?.id === run.id ? edit : { id: run.id, ...desc }) : null
  const plan = useMemo(() => (tables?.length === 1 ? tablePlan(tables[0], { untitled: t('common.untitled'), column }) : null), [tables, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const dbDraft = run && plan && db?.id === run.id ? db.draft : null

  if (!req || !run) return { body: null, rows: null, structured: false, mode: '' }
  const structured = isStructured(req.action)

  const once = (fn: () => Promise<unknown>) => async () => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const gone = () => useUI.getState().toast({ message: t('features.ai.image.gone'), kind: 'error' })

  const retry: ImageRow = { id: 'retry', label: t('features.ai.res.retry'), icon: RotateCcw, run: () => start(req) }
  const drop: ImageRow = { id: 'discard', label: t('features.ai.res.discard'), icon: Trash2, run: discard, hint: <Kbd>esc</Kbd>, danger: true }

  /* ---------------- rows ---------------- */

  let rows: ImageRow[] | null = null
  if (phase === 'error' && run.imageIssue) {
    rows = []
    if (run.imageIssue === 'cors' || run.imageIssue === 'missing' || run.imageIssue === 'decode')
      rows.push({
        id: 'img-upload',
        label: t('features.ai.image.res.upload'),
        icon: ImageUp,
        hint: <Kbd>↵</Kbd>,
        run: once(async () => {
          const hit = await uploadImageCopy(editor, run)
          if (hit) start(imageRequest(req.action, hit, req), imageTarget(editor.state.doc, hit.pos))
        }),
      })
    rows.push(retry, drop)
  } else if (done && req.action === 'describe') {
    rows = draftDesc
      ? [
          {
            id: 'img-apply',
            label: t('features.ai.image.res.apply'),
            icon: Check,
            hint: <Kbd>↵</Kbd>,
            run: once(async () => ((await applyDescription(editor, pageId, run, draftDesc)) ? finish() : gone())),
          },
          { id: 'copy', label: t('features.ai.res.copy'), icon: Copy, run: () => copy([draftDesc.alt, draftDesc.caption].filter(Boolean).join('\n')) },
          retry,
          drop,
        ]
      : [retry, drop]
  } else if (done && req.action === 'table') {
    if (dbDraft && plan)
      rows = [
        {
          id: 'img-db-create',
          label: t('features.ai.image.res.createDb'),
          code: t(`features.ai.todb.view.${effectiveView(plan.plan, dbDraft)}`).toUpperCase(),
          icon: Database,
          hint: <Kbd>↵</Kbd>,
          run: once(async () => ((await createImageDatabase(editor, pageId, run, plan.plan, dbDraft, plan.titleName)) ? finish() : gone())),
        },
        { id: 'img-db-back', label: t('features.ai.image.res.back'), icon: ArrowLeft, run: () => setDb(null) },
        drop,
      ]
    else if (tables?.length)
      rows = [
        {
          id: 'img-table',
          label: tables.length === 1 ? t('features.ai.image.res.table') : t('features.ai.image.res.tables', { n: tables.length }),
          icon: Table2,
          hint: <Kbd>↵</Kbd>,
          run: once(async () => {
            await insertBelowImage(editor, pageId, run, tableBlocks(tables, column))
            finish()
          }),
        },
        {
          id: 'img-sheet',
          label: t('features.ai.image.res.sheet'),
          icon: Sheet,
          run: once(async () => {
            await insertBelowImage(editor, pageId, run, [spreadsheetJson(tables, { sheet, column })])
            finish()
          }),
        },
        ...(plan && plan.plan.entries.length
          ? [{ id: 'img-db', label: t('features.ai.image.res.db'), icon: Database, run: () => setDb({ id: run.id, draft: initialDraft(plan.plan) }) }]
          : []),
        { id: 'copy', label: t('features.ai.res.copy'), icon: Copy, run: () => copy(tablesMarkdown(tables, column)) },
        retry,
        drop,
      ]
    else rows = [retry, drop]
  } else if (done && output.trim()) {
    rows = [
      {
        id: 'img-below',
        label: t('features.ai.image.res.below'),
        icon: ArrowDownToLine,
        hint: <Kbd>↵</Kbd>,
        run: once(async () => {
          await insertMarkdownBelow(editor, pageId, run, output)
          finish()
        }),
      },
      { id: 'copy', label: t('features.ai.res.copy'), icon: Copy, run: () => copy(output) },
      retry,
      drop,
    ]
  }

  /* ---------------- body ---------------- */

  const meta = run.image ? (
    <div className="ai-img__meta label" data-testid="ai-image-meta">
      <span className="ai-img__glyph" aria-hidden>
        ▣
      </span>
      {t('features.ai.image.sent', {
        size: `${run.image.width}×${run.image.height}`,
        type: run.image.mediaType.replace('image/', '').toUpperCase(),
        bytes: formatBytes(run.image.bytes, lang),
      })}
    </div>
  ) : null

  let main: ReactNode = null
  if (phase === 'streaming' && structured)
    main = (
      <div className="ai-out__body">
        <div className="ai-wait label" data-testid="ai-image-wait">
          {req.action === 'table' ? t('features.ai.image.waitTables') : t('features.ai.image.waitLooking')}
          <span className="ai-wait__dots" aria-hidden />
        </div>
      </div>
    )
  else if (phase === 'error' && run.imageIssue)
    main = (
      <div className="ai-error" role="alert" data-testid="ai-image-error">
        <span className="ai-error__code label">ERR · IMAGE_{run.imageIssue.toUpperCase()}</span>
        <p>{t(`features.ai.image.err.${run.imageIssue}`)}</p>
      </div>
    )
  else if (done && req.action === 'describe')
    main = draftDesc ? (
      <div className="ai-img__desc" data-testid="ai-image-describe">
        <label className="ai-img__field">
          <span className="label">{t('features.ai.image.alt')}</span>
          <textarea
            className="input ai-img__input"
            rows={2}
            value={draftDesc.alt}
            spellCheck={false}
            onChange={(e) => setEdit({ ...draftDesc, alt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                rows?.[0]?.run()
              }
            }}
          />
        </label>
        <label className="ai-img__field">
          <span className="label">{t('features.ai.image.caption')}</span>
          <input
            className="input ai-img__input"
            value={draftDesc.caption}
            spellCheck={false}
            onChange={(e) => setEdit({ ...draftDesc, caption: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                rows?.[0]?.run()
              }
            }}
          />
        </label>
      </div>
    ) : (
      <BadAnswer />
    )
  else if (done && req.action === 'table')
    main = !tables ? (
      <BadAnswer />
    ) : !tables.length ? (
      <p className="ai-lost" role="note" data-testid="ai-image-none">
        {t('features.ai.image.noTables')}
      </p>
    ) : dbDraft && plan ? (
      <div className="ai-img__db">
        <TodbPreview plan={plan.plan} draft={dbDraft} onDraft={(draft) => setDb({ id: run.id, draft })} gists={[t('features.ai.image.kept')]} onConvert={() => rows?.[0]?.run()} />
      </div>
    ) : (
      <TablesPreview tables={tables} column={column} />
    )

  return {
    body: meta || main ? (
      <>
        {meta}
        {main}
      </>
    ) : null,
    rows,
    structured,
    mode: `${run.id}:${phase}:${dbDraft ? 'db' : 'result'}`,
  }
}

function BadAnswer() {
  const t = useT()
  return (
    <div className="ai-error" role="alert">
      <span className="ai-error__code label">ERR · BAD_ANSWER</span>
      <p>{t('features.ai.image.bad')}</p>
    </div>
  )
}

const SAMPLE_ROWS = 6

/** The tables Claude found: a spec line and the first rows of each. */
function TablesPreview({ tables, column }: { tables: ImageTable[]; column: (n: number) => string }) {
  const t = useT()
  return (
    <div className="ai-img__tables" data-testid="ai-image-tables">
      {tables.map((tb, i) => {
        const head = headerNames(tb, column)
        const more = tb.rows.length - SAMPLE_ROWS
        return (
          <section key={i} className="ai-img__table">
            <div className="ai-img__spec label">
              <span className="ai-img__no">{String(i + 1).padStart(2, '0')}</span>
              <span className="ai-img__title">{tb.title || t('features.ai.image.table', { n: i + 1 })}</span>
              <span className="ai-img__dims">{t('features.ai.image.dims', { rows: tb.rows.length, cols: head.length })}</span>
            </div>
            <div className="ai-img__scroll">
              <table>
                <thead>
                  <tr>
                    {head.map((h, c) => (
                      <th key={c}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tb.rows.slice(0, SAMPLE_ROWS).map((r, ri) => (
                    <tr key={ri}>
                      {r.map((cell, c) => (
                        <td key={c}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {more > 0 && <div className="ai-img__more label">{t('features.ai.image.more', { n: more })}</div>}
          </section>
        )
      })}
    </div>
  )
}

export type { ImageHit }
