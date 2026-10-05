/**
 * The file half of the AI panel (AIMenu.tsx): the actions it lists for a file block, and — for a run about
 * a file — the result body (what was sent or converted, the page preview, the tables / sheets, the database
 * preview) and the result keys (Create the page / Insert below / as spreadsheet · table · database / Upload a
 * copy …).
 *
 * The panel keeps its keyboard flow: the keys come back as rows of its list, the body only shows.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { ArrowDownToLine, ArrowLeft, Copy, Database, FilePlus2, FileUp, RotateCcw, Sheet, Table2, Trash2, type LucideIcon } from 'lucide-react'
import { Kbd } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { docToMarkdown } from '../../../editor'
import { TodbPreview } from '../todb/TodbPreview'
import { effectiveView, initialDraft, type TableDraft } from '../todb/plan'
import { spreadsheetJson, tableBlocks, tablesMarkdown } from '../image/answers'
import { MAX_ROWS as SHEET_MAX_ROWS } from '../../sheets'
import type { AIRun, RunRequest } from '../runs'
import type { RunTarget } from '../runsTarget'
import { createFileDatabase, createFilePage, fileRequest, insertBelowFile, insertMarkdownBelowFile, runFile, uploadFileCopy } from './actions'
import { dataPlan, parsePage, parseSheets, sheetTable, tablesOf, type ParsedPage } from './answers'
import { baseName, docStats, markdownPage } from './convert'
import { FILE_ACTIONS, FILE_CODES, isLocalAction, isStructuredAction, kindLabel, type FileAction, type FileKind } from './kinds'
import { formatBytes, PDF_MAX_PAGES, TEXT_MAX_CHARS } from './load'
import { fileTarget } from './locate'
import type { DataSheet } from './xlsx'
import { FILE_ICONS, fileActionLabel } from './menu'
import './file.css'

/** A row of the panel's list (the shape AIMenu renders). */
export interface FileRow {
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

const KEYWORDS: Record<FileAction, string> = {
  summarize: 'file pdf document summary summarize datei dokument zusammenfassung zusammenfassen',
  extract: 'file pdf text page extract transcribe ocr datei text seite auslesen abschreiben',
  tables: 'file pdf table tables spreadsheet database datei tabelle tabellen datenbank',
  ask: 'file pdf document question ask datei dokument frage fragen',
  page: 'file word docx text markdown html rtf page open convert datei seite öffnen umwandeln',
  database: 'file csv excel xlsx tsv import database datei datenbank importieren',
  sheet: 'file csv excel xlsx tsv spreadsheet sheet datei tabellenkalkulation',
}

/** Room the previews need below the file (a database draft, a page outline, the tables) — like "Transform into". */
export const FILE_ROOM = 560

/** A table block gets at most this many rows (larger data: a spreadsheet or a database). */
const TABLE_MAX_ROWS = 500

const actionLabel = (t: ReturnType<typeof useT>, a: FileAction, kind: FileKind, menu = false) => fileActionLabel(t, a, kind, menu)

/** The actions the panel (and the block menus) list for a file (`ask` only focuses the prompt). */
export function fileActionRows(
  t: ReturnType<typeof useT>,
  kind: FileKind,
  run: (a: FileAction) => void,
  ask: () => void,
): Array<{ id: string; label: string; code: string; icon: LucideIcon; group: string; keywords: string; run: () => void }> {
  const group = t('features.ai.file.group', { type: kindLabel(kind) })
  return FILE_ACTIONS[kind].map((a) => ({
    id: `file-${a}`,
    label: actionLabel(t, a, kind, true),
    code: FILE_CODES[a],
    icon: FILE_ICONS[a],
    group,
    keywords: KEYWORDS[a],
    run: a === 'ask' ? ask : () => run(a),
  }))
}

/** The label of a typed question about the file ("Ask about the PDF"). */
export const fileAskLabel = (t: ReturnType<typeof useT>, kind: FileKind) => actionLabel(t, 'ask', kind)

/**
 * Text typed after a file result: another question (after an answer — or after a local conversion, which
 * cannot be told anything: then it is a question about the file), else what Claude should do differently.
 */
export function refineFile(t: ReturnType<typeof useT>, req: Extract<RunRequest, { kind: 'file' }>, text: string): RunRequest {
  if (req.action === 'ask') return { ...req, question: text.trim() }
  if (isLocalAction(req.action)) {
    const { instruction: _i, ...rest } = req
    return { ...rest, action: 'ask', label: actionLabel(t, 'ask', req.fileKind), code: FILE_CODES.ask, question: text.trim() }
  }
  return { ...req, instruction: text.trim() }
}

/** The target of a file run in the live editor: the file found again (lost when it is gone). */
export function fileRunTarget(editor: Editor, run: AIRun, target: RunTarget): RunTarget {
  const hit = runFile(editor, run)
  if (!hit) return target.lost ? target : { ...target, lost: true }
  if (!target.lost && hit.pos === target.from) return target
  return fileTarget(editor.state.doc, hit.pos)
}

export interface FilePanelOptions {
  editor: Editor
  pageId: string
  /** the panel's run when it is a file request */
  run: AIRun | null
  phase: 'idle' | 'streaming' | 'done' | 'error'
  /** a new run in place of this one (Retry, after "Upload a copy") */
  start: (req: RunRequest, target?: RunTarget) => void
  /** the result is in the page: the run is done with, the panel closes */
  finish: () => void
  discard: () => void
  copy: (text: string) => void
}

export interface FilePanel {
  /** the body under the output bar (null: none of the file's) */
  body: ReactNode
  /** the keys of a finished / failed file run (null: the panel's own) */
  rows: FileRow[] | null
  /** the answer is data (tables, a converted page, sheets): the panel hides the raw text and the word count */
  structured: boolean
  /** which set of keys shows ('data' → 'db' …): the panel's highlight goes back to the first key when it changes */
  mode: string
}

/** The file part of the panel for its run (does nothing for other runs). */
export function useFilePanel({ editor, pageId, run, phase, start, finish, discard, copy }: FilePanelOptions): FilePanel {
  const t = useT()
  const lang = useLang()
  const req = run?.req.kind === 'file' ? run.req : null
  const output = run?.output ?? ''
  const done = phase === 'done' && !!req
  const action = req?.action ?? null
  const page = useMemo(() => (done && action === 'page' ? parsePage(output) : null), [done, action, output])
  const sheets = useMemo(
    () => (done && (action === 'database' || action === 'sheet') ? parseSheets(output) : done && action === 'tables' ? tablesOf(output) : null),
    [done, action, output],
  )
  /** the sheet / table shown (per run) */
  const [pick, setPick] = useState<{ id: string; n: number } | null>(null)
  /** the database preview (per run): open or closed by "Back", the draft as changed for the sheet it was made from */
  const [db, setDb] = useState<{ id: string; open: boolean; draft: TableDraft | null; sheet: number } | null>(null)
  const [title, setTitle] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const column = (n: number) => t('features.ai.image.column', { n })
  const sheetName = (n: number) => t('features.ai.image.sheet', { n })
  const active = run && sheets?.length ? Math.min(pick?.id === run.id ? pick.n : 0, sheets.length - 1) : 0
  const sheet: DataSheet | null = sheets?.[active] ?? null
  const plan = useMemo(() => (sheet ? dataPlan(sheet, { untitled: t('common.untitled'), column }) : null), [sheet, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const dbState = run && db?.id === run.id ? db : null
  // "Import as database" opens on the preview; another sheet starts from its own draft
  const dbOpen = dbState ? dbState.open : action === 'database'
  const dbDraft = run && plan && plan.plan.entries.length && dbOpen ? (dbState?.draft && dbState.sheet === active ? dbState.draft : initialDraft(plan.plan)) : null

  if (!req || !run) return { body: null, rows: null, structured: false, mode: '' }
  const structured = isStructuredAction(req.action)
  const local = isLocalAction(req.action)

  const once = (fn: () => Promise<unknown>) => async () => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const gone = () => useUI.getState().toast({ message: t('features.ai.file.gone'), kind: 'error' })
  const origin = local ? ('import' as const) : ('ai' as const)

  const retry: FileRow = { id: 'retry', label: t('features.ai.res.retry'), icon: RotateCcw, run: () => start(req) }
  const drop: FileRow = { id: 'discard', label: t('features.ai.res.discard'), icon: Trash2, run: discard, hint: <Kbd>esc</Kbd>, danger: true }
  const pageTitle = title?.id === run.id ? title.text : (page?.title ?? baseName(req.name))

  /* ---------------- rows ---------------- */

  let rows: FileRow[] | null = null
  const sheetRows = (list: DataSheet[]): FileRow[] => {
    const out: FileRow[] = []
    const many = list.length > 1
    out.push({
      id: 'file-sheet',
      label: many ? t('features.ai.file.res.sheets', { n: list.length }) : t('features.ai.image.res.sheet'),
      icon: Sheet,
      hint: list.some((s) => s.rows.length > SHEET_MAX_ROWS - 1) ? <span className="ai-file__hint">{t('features.ai.file.res.firstRows', { n: (SHEET_MAX_ROWS - 1).toLocaleString(lang) })}</span> : undefined,
      run: once(async () => {
        await insertBelowFile(editor, pageId, run, [spreadsheetJson(list.map(sheetTable), { sheet: sheetName, column })])
        finish()
      }),
    })
    if (plan?.plan.entries.length)
      out.push({ id: 'file-db', label: t('features.ai.image.res.db'), icon: Database, run: () => setDb({ id: run.id, open: true, draft: null, sheet: active }) })
    if (sheet && sheet.rows.length <= TABLE_MAX_ROWS)
      out.push({
        id: 'file-table',
        label: t('features.ai.image.res.table'),
        icon: Table2,
        run: once(async () => {
          await insertBelowFile(editor, pageId, run, tableBlocks([sheetTable(sheet)], column))
          finish()
        }),
      })
    return out
  }

  if (phase === 'error' && run.fileIssue) {
    rows = []
    if (run.fileIssue.issue === 'cors' || run.fileIssue.issue === 'missing')
      rows.push({
        id: 'file-upload',
        label: t('features.ai.image.res.upload'),
        icon: FileUp,
        hint: <Kbd>↵</Kbd>,
        run: once(async () => {
          const hit = await uploadFileCopy(editor, run)
          if (hit) start(fileRequest(req.action, hit, req), fileTarget(editor.state.doc, hit.pos))
        }),
      })
    rows.push(retry, drop)
  } else if (done && req.action === 'page') {
    rows = page
      ? [
          {
            id: 'file-page',
            label: t('features.ai.file.res.createPage'),
            icon: FilePlus2,
            hint: <Kbd>↵</Kbd>,
            run: once(async () => ((await createFilePage(editor, pageId, run, { title: pageTitle, doc: page.doc, origin })) ? finish() : gone())),
          },
          {
            id: 'file-below',
            label: t('features.ai.file.res.below'),
            icon: ArrowDownToLine,
            run: once(async () => {
              await insertBelowFile(editor, pageId, run, page.doc.content ?? [])
              finish()
            }),
          },
          { id: 'copy', label: t('features.ai.file.res.copyMd'), icon: Copy, run: () => copy(docToMarkdown(page.doc)) },
          drop,
        ]
      : [retry, drop]
  } else if (done && sheets && (req.action === 'database' || req.action === 'sheet' || req.action === 'tables')) {
    if (dbDraft && plan)
      rows = [
        {
          id: 'file-db-create',
          label: t('features.ai.file.res.createDb'),
          code: t(`features.ai.todb.view.${effectiveView(plan.plan, dbDraft)}`).toUpperCase(),
          icon: Database,
          hint: <Kbd>↵</Kbd>,
          run: once(async () => ((await createFileDatabase(editor, pageId, run, plan.plan, dbDraft, plan.titleName, origin)) ? finish() : gone())),
        },
        { id: 'file-db-back', label: req.action === 'tables' ? t('features.ai.image.res.back') : t('features.ai.file.res.back'), icon: ArrowLeft, run: () => setDb({ id: run.id, open: false, draft: null, sheet: active }) },
        drop,
      ]
    else if (sheets.length) {
      rows =
        req.action === 'tables'
          ? [
              {
                id: 'file-tables',
                label: sheets.length === 1 ? t('features.ai.image.res.table') : t('features.ai.image.res.tables', { n: sheets.length }),
                icon: Table2,
                run: once(async () => {
                  await insertBelowFile(editor, pageId, run, tableBlocks(sheets.map(sheetTable), column))
                  finish()
                }),
              },
              ...sheetRows(sheets).filter((r) => r.id !== 'file-table'),
              { id: 'copy', label: t('features.ai.res.copy'), icon: Copy, run: () => copy(tablesMarkdown(sheets.map(sheetTable), column)) },
              retry,
              drop,
            ]
          : [...sheetRows(sheets), drop]
      if (rows[0]) rows[0] = { ...rows[0], hint: rows[0].hint ?? <Kbd>↵</Kbd> }
    } else rows = req.action === 'tables' ? [retry, drop] : [drop]
  } else if (done && output.trim()) {
    rows = [
      ...(req.action === 'extract'
        ? [
            {
              id: 'file-page',
              label: t('features.ai.file.res.createPage'),
              icon: FilePlus2,
              hint: <Kbd>↵</Kbd>,
              run: once(async () => {
                const ok = await createFilePage(editor, pageId, run, { ...markdownPage(output, baseName(req.name)), origin: 'ai' })
                return ok ? finish() : gone()
              }),
            },
          ]
        : []),
      {
        id: 'file-below',
        label: t('features.ai.file.res.below'),
        icon: ArrowDownToLine,
        hint: req.action === 'extract' ? undefined : <Kbd>↵</Kbd>,
        run: once(async () => {
          await insertMarkdownBelowFile(editor, pageId, run, output)
          finish()
        }),
      },
      { id: 'copy', label: t('features.ai.res.copy'), icon: Copy, run: () => copy(output) },
      retry,
      drop,
    ]
  }

  /* ---------------- body ---------------- */

  const f = run.file
  const meta = f ? (
    <div className="ai-file__meta label" data-testid="ai-file-meta" data-local={f.sent ? undefined : ''}>
      <span className="ai-file__glyph" aria-hidden>
        ▤
      </span>
      {f.sent
        ? f.kind === 'pdf'
          ? t('features.ai.file.sentPdf', { pages: f.pages ? t(f.pages === 1 ? 'features.ai.file.pagesOne' : 'features.ai.file.pages', { n: f.pages.toLocaleString(lang) }) : t('features.ai.file.pagesUnknown'), bytes: formatBytes(f.bytes, lang) })
          : t(f.clipped ? 'features.ai.file.sentTextCut' : 'features.ai.file.sentText', { type: kindLabel(f.kind, req.name), chars: (f.chars ?? 0).toLocaleString(lang), max: TEXT_MAX_CHARS.toLocaleString(lang) })
        : t('features.ai.file.local', { type: kindLabel(f.kind, req.name), bytes: formatBytes(f.bytes, lang) })}
    </div>
  ) : null

  let main: ReactNode = null
  if (phase === 'streaming' && structured)
    main = (
      <div className="ai-out__body">
        <div className="ai-wait label" data-testid="ai-file-wait">
          {local ? t('features.ai.file.waitLocal') : t('features.ai.image.waitTables')}
          <span className="ai-wait__dots" aria-hidden />
        </div>
      </div>
    )
  else if (phase === 'error' && run.fileIssue) {
    const p = run.fileIssue
    main = (
      <div className="ai-error" role="alert" data-testid="ai-file-error">
        <span className="ai-error__code label">ERR · FILE_{p.issue.toUpperCase()}</span>
        <p>
          {t(`features.ai.file.err.${p.issue === 'pages' && (p.max ?? 0) < PDF_MAX_PAGES ? 'pagesSmall' : p.issue}`, {
            bytes: p.bytes ? formatBytes(p.bytes, lang) : '',
            max: p.issue === 'pages' ? (p.max ?? 0).toLocaleString(lang) : p.max ? formatBytes(p.max, lang) : '',
            pages: (p.pages ?? 0).toLocaleString(lang),
          })}
        </p>
      </div>
    )
  } else if (done && req.action === 'page')
    main = page ? <PagePreview page={page} title={pageTitle} onTitle={(text) => setTitle({ id: run.id, text })} onEnter={() => rows?.[0]?.run()} /> : <BadResult />
  else if (done && (req.action === 'database' || req.action === 'sheet' || req.action === 'tables'))
    main = !sheets ? (
      <BadResult />
    ) : !sheets.length ? (
      <p className="ai-lost" role="note" data-testid="ai-file-none">
        {req.action === 'tables' ? t('features.ai.file.noTables') : t('features.ai.file.noData')}
      </p>
    ) : dbDraft && plan ? (
      <div className="ai-file__db">
        {sheets.length > 1 && <SheetPicker sheets={sheets} active={active} onPick={(n) => setPick({ id: run.id, n })} locked />}
        <TodbPreview plan={plan.plan} draft={dbDraft} onDraft={(draft) => setDb({ id: run.id, open: true, draft, sheet: active })} gists={[t('features.ai.file.kept')]} onConvert={() => rows?.[0]?.run()} />
      </div>
    ) : (
      <div className="ai-file__data" data-testid="ai-file-tables">
        {sheets.length > 1 && <SheetPicker sheets={sheets} active={active} onPick={(n) => setPick({ id: run.id, n })} />}
        <SheetPreview sheet={sheets[active]} no={active + 1} column={column} />
      </div>
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

function BadResult() {
  const t = useT()
  return (
    <div className="ai-error" role="alert">
      <span className="ai-error__code label">ERR · BAD_RESULT</span>
      <p>{t('features.ai.image.bad')}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Previews                                                             */
/* ------------------------------------------------------------------ */

const OUTLINE = 9

/** One line of the page outline: "H2  Payment terms" / "¶  The parties agree …" / "•  3 items" / "▦  4 × 3". */
function outlineOf(doc: ParsedPage['doc'], t: ReturnType<typeof useT>): Array<{ tag: string; text: string; level?: number }> {
  const text = (n: ParsedPage['doc']): string => (n.text ?? '') + (n.content ?? []).map(text).join(n.type === 'paragraph' ? '' : ' ')
  return (doc.content ?? []).slice(0, OUTLINE).map((n) => {
    if (n.type === 'heading') return { tag: `H${n.attrs?.level ?? 1}`, text: text(n), level: Number(n.attrs?.level ?? 1) }
    if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') return { tag: n.type === 'orderedList' ? '1.' : '•', text: t('features.ai.file.items', { n: n.content?.length ?? 0 }) }
    if (n.type === 'table') return { tag: '▦', text: t('features.ai.image.dims', { rows: n.content?.length ?? 0, cols: n.content?.[0]?.content?.length ?? 0 }) }
    return { tag: '¶', text: text(n) }
  })
}

function PagePreview({ page, title, onTitle, onEnter }: { page: ParsedPage; title: string; onTitle: (s: string) => void; onEnter: () => void }) {
  const t = useT()
  const lang = useLang()
  const s = docStats(page.doc)
  const spec = [
    s.headings === 1 ? t('features.ai.file.headingsOne') : t('features.ai.file.headings', { n: s.headings }),
    s.paragraphs === 1 ? t('features.ai.file.parasOne') : t('features.ai.file.paras', { n: s.paragraphs }),
    ...(s.lists ? [s.lists === 1 ? t('features.ai.file.listsOne') : t('features.ai.file.lists', { n: s.lists })] : []),
    ...(s.tables ? [s.tables === 1 ? t('features.ai.file.tablesOne') : t('features.ai.file.tables', { n: s.tables })] : []),
    s.words === 1 ? t('features.ai.file.wordsOne') : t('features.ai.file.words', { n: s.words.toLocaleString(lang) }),
  ].join(' · ')
  const lines = outlineOf(page.doc, t)
  const more = (page.doc.content?.length ?? 0) - lines.length
  return (
    <div className="ai-file__page" data-testid="ai-file-page">
      <label className="ai-file__field">
        <span className="label">{t('features.ai.file.pageTitle')}</span>
        <input
          className="input ai-file__input"
          value={title}
          spellCheck={false}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onEnter()
            }
          }}
        />
      </label>
      <div className="ai-file__spec label" data-testid="ai-file-spec">
        {spec}
      </div>
      <ol className="ai-file__outline" aria-label={t('features.ai.file.outline')}>
        {lines.map((l, i) => (
          <li key={i} data-level={l.level}>
            <span className="ai-file__tag">{l.tag}</span>
            <span className="ai-file__line">{l.text || '—'}</span>
          </li>
        ))}
      </ol>
      {more > 0 && <div className="ai-file__more label">{t('features.ai.file.moreBlocks', { n: more })}</div>}
      {page.images > 0 && (
        <p className="ai-file__note" role="note">
          {page.images === 1 ? t('features.ai.file.imagesOne') : t('features.ai.file.images', { n: page.images })}
        </p>
      )}
    </div>
  )
}

/** The sheets / tables of a file: one key each (the database and the table take the one picked). */
function SheetPicker({ sheets, active, onPick, locked }: { sheets: DataSheet[]; active: number; onPick: (n: number) => void; locked?: boolean }) {
  const t = useT()
  return (
    <div className="ai-file__sheets" role="radiogroup" aria-label={t('features.ai.file.sheets')}>
      {sheets.map((s, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={i === active}
          className="ai-file__chip"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
          title={locked ? t('features.ai.file.sheetFor') : undefined}
        >
          <span className="ai-file__no">{String(i + 1).padStart(2, '0')}</span>
          {s.name || t('features.ai.image.table', { n: i + 1 })}
        </button>
      ))}
    </div>
  )
}

const SAMPLE_ROWS = 6

function SheetPreview({ sheet, no, column }: { sheet: DataSheet; no: number; column: (n: number) => string }) {
  const t = useT()
  const lang = useLang()
  const head = sheet.header.map((h, i) => h || column(i + 1))
  const more = sheet.total - SAMPLE_ROWS
  return (
    <section className="ai-file__table">
      <div className="ai-file__tspec label">
        <span className="ai-file__no">{String(no).padStart(2, '0')}</span>
        <span className="ai-file__title">{sheet.name || t('features.ai.image.table', { n: no })}</span>
        <span className="ai-file__dims">{t('features.ai.image.dims', { rows: sheet.total.toLocaleString(lang), cols: head.length })}</span>
      </div>
      <div className="ai-file__scroll">
        <table>
          <thead>
            <tr>
              {head.map((h, c) => (
                <th key={c}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.slice(0, SAMPLE_ROWS).map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <div className="ai-file__more label">{t('features.ai.image.more', { n: more.toLocaleString(lang) })}</div>}
      {sheet.total > sheet.rows.length && <div className="ai-file__more label">{t('features.ai.file.capped', { n: sheet.rows.length.toLocaleString(lang) })}</div>}
    </section>
  )
}
