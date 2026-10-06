/**
 * Import: Notion export ZIP (Markdown & CSV, nested part zips), Obsidian vaults, Evernote .enex,
 * Trello board JSON, HTML pages, Markdown/text files, CSV, One JSON backup, PowerPoint decks and
 * "Take over from Claude Design" (HTML / PPTX exports + screenshots, DeckImport.tsx).
 * Drag & drop (files or folders), the file pickers or a source tile → staged progress meter →
 * summary + import report → opens the imported root. The source is detected (sources.ts); a tile
 * only preselects it (e.g. the Obsidian tile forces vault handling and opens a folder picker). A
 * PowerPoint deck and a Claude Design take-over show a preview first; their done step offers Present
 * (a deck) and Undo import.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, Eye, FileUp, FolderUp, Presentation, RotateCcw, Undo2 } from 'lucide-react'
import { useCloud } from '../../cloud'
import { Modal } from '../../ui/Modal'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { resolveAssetUrl } from '../../lib/files'
import { navigate, openPage } from '../../lib/router'
import { flushSave } from '../../store/persistence'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { pauseAutomations } from '../automations/engine'
import { ArchiveTooLargeError, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, basename, expandZip, extname, isZip, planStats, zipBudget, type ImportEntry, type ImportPlan } from './import/plan'
import type { PptxDeck } from './import/pptx'
import { pptxErrorText, readDeck } from './import/labels'
import { DeckStep, DesignStep, type ImportExtra, type OnPlan } from './DeckImport'
import { applyPlan, type ImportResult } from './import/apply'
import { groupReport, type ReportItem } from './import/report'
import type { SourceMode } from './import/sources'
import type { TrelloBoard } from './import/trello'
import type { ColorName } from '../../store/types'
import { applyBackup, backupStats, parseBackup, type Backup, type RestoreResult } from './backup'
import { Meter, Readout } from './parts'
import { countList, unitOf } from './count'
import { onRovingKey } from './roving'
import './io.css'

interface Picked {
  path: string
  file: File
}

type StageId = 'read' | 'unpack' | 'files' | 'pages' | 'commit'
type Phase =
  | { name: 'idle' }
  | { name: 'running'; stages: Record<StageId, { done: number; total: number }>; current: StageId; source: string }
  | { name: 'backup'; backup: Backup; fileName: string }
  | { name: 'deck'; deck: PptxDeck; fileName: string }
  | { name: 'design' }
  | { name: 'done'; result: ImportResult; ms: number; skipped: string[]; source: string; extra?: ImportExtra; before?: string }
  | { name: 'restored'; result: RestoreResult; ms: number; fileName: string }
  | { name: 'error'; message: string }

const STAGES: StageId[] = ['read', 'unpack', 'files', 'pages', 'commit']
const ACCEPT = '.zip,.md,.markdown,.txt,.csv,.tsv,.json,.enex,.html,.htm,.pptx,image/*,.pdf'

type SourceId = Exclude<SourceMode, 'auto'>
type StageUpdate = (stage: StageId, done: number, total: number) => void
/** The source tiles: code plate, picker (accept / folder; none: a step of its own) — names and how-tos are in messages-import.ts / import/messages.ts */
const SOURCES: Array<{ id: SourceId; code: string; accept: string; folder?: boolean }> = [
  { id: 'notion', code: 'ZIP', accept: '.zip' },
  { id: 'obsidian', code: 'VAULT', accept: '.zip,.md,.markdown', folder: true },
  { id: 'evernote', code: 'ENEX', accept: '.enex' },
  { id: 'trello', code: 'JSON', accept: '.json' },
  { id: 'html', code: 'HTML', accept: '.html,.htm,.zip' },
  { id: 'markdown', code: 'MD · TXT', accept: '.md,.markdown,.txt,.zip' },
  { id: 'csv', code: 'CSV · TSV', accept: '.csv,.tsv' },
  { id: 'pptx', code: 'PPTX', accept: '.pptx' },
  { id: 'design', code: 'HTML · PPTX · PNG', accept: '' },
  { id: 'backup', code: 'JSON', accept: '.json' },
]
/** Folder pickers exist on desktop browsers; touch devices get the ZIP picker instead. */
const canPickFolder = () =>
  typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
const plural = (n: number) => (n === 1 ? 'one' : 'other')
/** Notion splits big exports into "…-Part-1.zip", "…-Part-2.zip" — they share one root */
const PART_ZIP = /Part-\d+\.zip$/i

const freshStages = () => Object.fromEntries(STAGES.map((s) => [s, { done: 0, total: 0 }])) as Record<StageId, { done: number; total: number }>

/** Recursively read a dropped folder (Chrome/Firefox/Safari: webkitGetAsEntry). */
async function readDrop(dt: DataTransfer): Promise<Picked[]> {
  const items = [...dt.items].filter((i) => i.kind === 'file')
  const entries = items.map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null)
  if (!entries.length || entries.some((e) => !e)) return [...dt.files].map((file) => ({ path: file.name, file }))
  const out: Picked[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ path: `${prefix}${file.name}`, file })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  for (const e of entries) await walk(e!, '')
  return out
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [over, setOver] = useState(false)
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<HTMLInputElement>(null)
  const sourceMode = useRef<{ mode: SourceMode; folder: boolean }>({ mode: 'auto', folder: false })
  const busy = phase.name === 'running'
  // viewers of a team workspace read it; nothing can be imported into it
  const viewOnly = useCloud((s) => s.readOnly)

  const dateLabel = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())

  /** The staged progress meter of one import. */
  const meter = (source: string): StageUpdate => {
    const stages = freshStages()
    return (stage, done, total) => {
      stages[stage] = { done, total }
      setPhase({ name: 'running', stages: { ...stages }, current: stage, source })
    }
  }

  /** A failed import → the error step. */
  const fail = (err: unknown) => {
    if (err instanceof ArchiveTooLargeError) {
      const nf = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB')
      setPhase({ name: 'error', message: t('features.io.err.tooLarge', { mb: nf.format(ZIP_MAX_BYTES / 1048576), files: nf.format(ZIP_MAX_ENTRIES) }) })
      return
    }
    console.error('[import] failed', err)
    setPhase({ name: 'error', message: t('features.io.err.generic', { msg: (err as Error)?.message ?? String(err) }) })
  }

  /** Write a plan (one store update), open its root → the done step. `after`: what the source adds (Present, the memory example). */
  const commit = async (plan: ImportPlan, update: StageUpdate, o: { started: number; label: string; skipped?: string[]; after?: (result: ImportResult) => ImportExtra }) => {
    const stats = planStats(plan)
    const containerTitle =
      plan.source === 'obsidian'
        ? t('features.imp.container.obsidian', { name: plan.name || dateLabel })
        : plan.source === 'evernote' || plan.source === 'trello' || plan.source === 'html'
          ? t(`features.imp.container.${plan.source}`, { date: dateLabel })
          : plan.isNotion
            ? t('features.io.containerNotion', { date: dateLabel })
            : t('features.io.container', { date: dateLabel })
    update('files', 0, stats.files)
    update('pages', 0, plan.nodes.length)
    if (!stats.files) update('files', 1, 1)
    const before = window.location.hash
    const result = await applyPlan(plan, {
      containerTitle,
      containerNote: t('features.io.containerNote', {
        list: countList(t, [
          ['page', stats.pages],
          ['db', stats.databases],
          ['row', stats.rows],
          ['file', stats.files],
        ]),
        source: o.label,
      }),
      untitled: t('common.untitled'),
      viewNames: { table: t('features.io.view.table'), board: t('features.io.view.board'), calendar: t('features.io.view.calendar') },
      onProgress: (p) => update(p.stage, p.done, p.total),
    })
    update('commit', 1, 1)
    const extra = o.after?.(result)
    await flushSave()
    if (result.rootId) openPage(result.rootId)
    setPhase({ name: 'done', result, ms: performance.now() - o.started, skipped: o.skipped ?? [], source: plan.source ?? (plan.isNotion ? 'notion' : 'markdown'), extra, before })
  }

  /** A plan a step built (PowerPoint, Claude Design) → written like any other import. */
  const importPlan: OnPlan = (plan, label, after) => {
    const started = performance.now()
    const update = meter(label)
    update('read', 1, 1)
    update('unpack', 1, 1)
    const resume = pauseAutomations()
    void commit(plan, update, { started, label, after })
      .catch(fail)
      .finally(resume)
  }

  /** Undo of a finished import: its pages (and what the source added) gone, back where the person was. */
  const undoImport = (result: ImportResult, extra: ImportExtra | undefined, before: string | undefined) => {
    extra?.undo?.()
    if (result.rootId && useWorkspace.getState().pages[result.rootId]) useWorkspace.getState().deletePagePermanently(result.rootId)
    navigate(before || '#/', { replace: true })
    useUI.getState().toast({ message: t('features.imp.done.undone'), kind: 'success' })
    setPhase({ name: 'idle' })
  }

  const run = useCallback(
    async (picked: Picked[], mode: SourceMode = 'auto') => {
      if (!picked.length) return
      // a PowerPoint deck: read here, previewed first (one at a time)
      const decks = picked.filter((p) => extname(p.path) === 'pptx')
      if (decks.length) {
        if (picked.length > 1) return setPhase({ name: 'error', message: t('features.imp.pptx.err.one') })
        try {
          const deck = readDeck(new Uint8Array(await decks[0].file.arrayBuffer()))
          return setPhase({ name: 'deck', deck, fileName: decks[0].file.name })
        } catch (e) {
          return setPhase({ name: 'error', message: pptxErrorText(e, lang) })
        }
      }
      const sources = await import('./import/sources')
      // 1) JSON: a One backup (merge / replace flow) or a Trello board export; backups mixed with
      //    other files are skipped (and reported)
      const jsons = picked.filter((p) => extname(p.path) === 'json')
      const boards: TrelloBoard[] = []
      const backups: Array<{ p: Picked; backup: Backup }> = []
      const strays: ReportItem[] = []
      for (const p of jsons) {
        const text = await p.file.text()
        const board = sources.parseTrello(text)
        if (board) {
          boards.push(board)
          continue
        }
        const backup = parseBackup(text)
        if (backup) backups.push({ p, backup })
        else strays.push({ code: 'skipped', detail: basename(p.path) })
      }
      if (jsons.length && jsons.length === picked.length && !boards.length) {
        if (!backups.length) return setPhase({ name: 'error', message: t(mode === 'backup' ? 'features.io.err.backup' : 'features.imp.err.json') })
        if (backups.length > 1 || strays.length) return setPhase({ name: 'error', message: t('features.io.err.backupOne') })
        return setPhase({ name: 'backup', backup: backups[0].backup, fileName: backups[0].p.file.name })
      }
      const skipped = backups.map(({ p }) => basename(p.path))
      const started = performance.now()
      const label = picked.length === 1 ? picked[0].file.name : t('features.io.nFiles', { n: picked.length })
      const update = meter(label)
      const resume = pauseAutomations()
      try {
        // 2) read files
        const entries: ImportEntry[] = []
        const zips: Array<{ name: string; data: Uint8Array }> = []
        let i = 0
        for (const p of picked) {
          const data = new Uint8Array(await p.file.arrayBuffer())
          if (extname(p.path) === 'zip' && isZip(data)) zips.push({ name: basename(p.path), data })
          else if (extname(p.path) !== 'json') entries.push({ path: p.path, data })
          update('read', ++i, picked.length)
        }
        // 3) unpack (nested Notion part zips included)
        update('unpack', 0, zips.length || 1)
        let z = 0
        const usedPrefixes = new Set<string>()
        const budget = zipBudget()
        for (const zip of zips) {
          // several unrelated zips → one folder each (named after the zip); Notion parts → shared root
          let prefix = ''
          if (zips.length > 1 && !PART_ZIP.test(zip.name)) {
            const base = zip.name.replace(/\.zip$/i, '') || 'zip'
            prefix = base
            for (let k = 2; usedPrefixes.has(prefix.toLowerCase()); k++) prefix = `${base} (${k})`
            usedPrefixes.add(prefix.toLowerCase())
          }
          entries.push(...(await expandZip(zip.data, prefix, 0, budget)))
          update('unpack', ++z, zips.length)
        }
        if (!zips.length) update('unpack', 1, 1)
        // 4) plan: detect the source (Evernote, Trello, Obsidian, Notion / Markdown / CSV / HTML)
        const first = picked[0].path
        const name = first.includes('/') ? first.split('/')[0] : picked.length === 1 ? first.replace(/\.[^.]+$/, '') : undefined
        const plan: ImportPlan = await sources.planImport(entries, {
          mode,
          name,
          boards,
          looseTitle: t('features.io.looseTitle', { date: dateLabel }),
          enex: { tags: t('features.imp.enex.tags'), source: t('features.imp.enex.source'), author: t('features.imp.enex.author'), encrypted: t('features.imp.enex.encrypted') },
          trello: {
            name: t('features.imp.trello.name'),
            status: t('features.imp.trello.status'),
            labels: t('features.imp.trello.labels'),
            members: t('features.imp.trello.members'),
            due: t('features.imp.trello.due'),
            done: t('features.imp.trello.done'),
            start: t('features.imp.trello.start'),
            link: t('features.imp.trello.link'),
            attachments: t('features.imp.trello.attachments'),
            comments: t('features.imp.trello.comments'),
            colorName: (c: ColorName) => t(`color.${c}`),
            archived: (cards, lists) =>
              [cards ? t(`features.imp.trello.cards.${plural(cards)}`, { n: cards }) : '', lists ? t(`features.imp.trello.lists.${plural(lists)}`, { n: lists }) : ''].filter(Boolean).join(', '),
          },
          onProgress: (done, total) => update('unpack', done, total),
        })
        plan.report = [...(plan.report ?? []), ...strays]
        if (!plan.nodes.length) {
          setPhase({ name: 'error', message: t('features.imp.err.nothing') })
          return
        }
        await commit(plan, update, { started, label, skipped })
      } catch (err) {
        fail(err)
      } finally {
        resume()
      }
    },
    [t, dateLabel, lang], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const onPick = (list: FileList | null, folder = false, mode: SourceMode = 'auto') => {
    if (!list?.length) return
    const picked = [...list].map((file) => ({ path: (folder && (file as File & { webkitRelativePath?: string }).webkitRelativePath) || file.name, file }))
    void run(picked, mode)
  }

  // a source tile: the matching picker (a folder picker for a vault), and the source preselected
  const pickSource = (id: SourceId) => {
    // Claude Design: a step of its own (three exports)
    if (id === 'design') return setPhase({ name: 'design' })
    const input = sourceRef.current
    const src = SOURCES.find((x) => x.id === id)
    if (!input || !src) return
    const folder = !!src.folder && canPickFolder()
    sourceMode.current = { mode: id, folder }
    input.accept = folder ? '' : src.accept
    input.toggleAttribute('webkitdirectory', folder)
    input.click()
  }

  // the PowerPoint preview and the Claude Design step take their files themselves
  const stepOpen = phase.name === 'deck' || phase.name === 'design'

  // drag & drop anywhere on the dialog
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (busy || stepOpen) return
    void run(await readDrop(e.dataTransfer))
  }

  // paste files (⌘V) while the dialog is open
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (busy || stepOpen || !e.clipboardData?.files.length) return
      e.preventDefault()
      onPick(e.clipboardData.files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  return (
    <Modal open onClose={busy ? () => {} : onClose} label="§ IO-01" title={t('features.io.import.title')} width={720} className="io-modal">
      {viewOnly ? (
        <div className="io-error io-viewonly" role="note" data-testid="import-view-only">
          <div className="io-error__stripe" />
          <div className="io-error__body">
            <Eye size={18} aria-hidden />
            <div>
              <div className="label io-error__label">{t('features.io.viewOnly.label')}</div>
              <p>{t('features.io.viewOnly.body')}</p>
            </div>
          </div>
          <div className="io-actions">
            <button type="button" className="btn" onClick={onClose} data-autofocus="">
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
      <div
        className="io"
        data-over={over || undefined}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
        }}
        onDrop={onDrop}
      >
        {phase.name === 'idle' && (
          <>
            <div className="io-drop" data-over={over || undefined}>
              <span className="io-crop io-crop--tl" />
              <span className="io-crop io-crop--tr" />
              <span className="io-crop io-crop--bl" />
              <span className="io-crop io-crop--br" />
              <img className="io-drop__art" src={resolveAssetUrl('assets/icons/import.webp')} alt="" width={72} height={72} draggable={false} />
              <div className="io-drop__title display">{over ? t('features.io.drop.release') : t('features.io.drop.title')}</div>
              <div className="io-drop__sub muted">{t('features.imp.drop.sub')}</div>
              <div className="io-drop__actions">
                <button type="button" className="btn btn--ink" onClick={() => filesRef.current?.click()} data-autofocus="">
                  <FileUp size={15} /> {t('features.io.pickFiles')}
                </button>
                <button type="button" className="btn" onClick={() => folderRef.current?.click()}>
                  <FolderUp size={15} /> {t('features.io.pickFolder')}
                </button>
              </div>
              <div className="io-drop__formats label">ZIP · VAULT · ENEX · JSON · HTML · MD · CSV · PPTX</div>
              <input ref={filesRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (onPick(e.target.files), (e.target.value = ''))} />
              <input
                ref={folderRef}
                type="file"
                hidden
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => (onPick(e.target.files, true), (e.target.value = ''))}
              />
              <input
                ref={sourceRef}
                type="file"
                multiple
                hidden
                data-source-input=""
                onChange={(e) => (onPick(e.target.files, sourceMode.current.folder, sourceMode.current.mode), (e.target.value = ''))}
              />
            </div>
            <div className="io-sources">
              <div className="io-sources__head label">
                <span>{t('features.imp.sources')}</span>
                <span>{t('features.imp.sources.pick')}</span>
              </div>
              <div className="io-sources__grid" role="group" aria-label={t('features.imp.sources')}>
                {SOURCES.map((s, i) => (
                  <button key={s.id} type="button" className="io-src" data-source={s.id} aria-label={t(`features.imp.src.${s.id}`)} aria-describedby={`io-src-${s.id}`} onClick={() => pickSource(s.id)}>
                    <span className="io-src__n mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="io-src__name">{t(`features.imp.src.${s.id}`)}</span>
                    <span className="io-src__code mono">{s.code}</span>
                    <span className="io-src__how" id={`io-src-${s.id}`}>
                      {t(`features.imp.src.${s.id}.how`)}
                    </span>
                    <ChevronRight className="io-src__go" size={14} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
            <p className="io-hint faint">{t('features.imp.hint')}</p>
          </>
        )}

        {phase.name === 'running' && (
          <div className="io-run" aria-live="polite">
            <div className="io-run__src">
              <Led state="on" />
              <span className="label">{t('features.io.running')}</span>
              <span className="io-run__name mono">{phase.source}</span>
            </div>
            {STAGES.map((s, i) => {
              const st = phase.stages[s]
              const ratio = st.total ? st.done / st.total : 0
              const idx = STAGES.indexOf(phase.current)
              const state = i < idx || (ratio >= 1 && i <= idx) ? 'done' : i === idx ? 'active' : 'wait'
              return (
                <div key={s} className="io-stage" data-state={state}>
                  <span className="io-stage__n mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="io-stage__name label">{t(`features.io.stage.${s}`)}</span>
                  <Meter value={state === 'done' ? 1 : state === 'wait' ? 0 : ratio} />
                  <span className="io-stage__count mono">{st.total ? `${st.done}/${st.total}` : '—'}</span>
                </div>
              )
            })}
          </div>
        )}

        {phase.name === 'done' && (
          <div className="io-done">
            <div className="io-done__head">
              <Led state="ok" />
              <span className="label">{t('features.io.done.label', { s: new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(phase.ms / 1000) })}</span>
              <span className="io-done__src mono">{t(`features.imp.src.${phase.source}`)}</span>
            </div>
            <p className="io-done__summary">
              {t('features.io.done.summary', {
                list: countList(t, [
                  ['page', phase.result.pages],
                  ['db', phase.result.databases],
                  ['row', phase.result.rows],
                  ['file', phase.result.files],
                ]),
              })}
            </p>
            <div className="io-readouts">
              <Readout value={phase.result.pages} label={unitOf(t, 'page', phase.result.pages)} />
              <Readout value={phase.result.databases} label={unitOf(t, 'db', phase.result.databases)} />
              <Readout value={phase.result.rows} label={unitOf(t, 'row', phase.result.rows)} />
              <Readout value={phase.result.files} label={unitOf(t, 'file', phase.result.files)} />
            </div>
            {phase.skipped.length > 0 && (
              <div className="io-warn" role="status">
                <div className="io-error__stripe" />
                <p>{t('features.io.skippedBackup', { names: phase.skipped.join(', ') })}</p>
              </div>
            )}
            {phase.extra?.memory && (
              <p className="io-done__memory" role="status" data-testid="import-memory" data-failed={'failed' in phase.extra.memory || undefined}>
                {'failed' in phase.extra.memory
                  ? t('features.imp.done.memoryFailed')
                  : t(phase.extra.memory.how === 'replaced' ? 'features.imp.done.memoryReplaced' : 'features.imp.done.memory', { tag: phase.extra.memory.tag })}
              </p>
            )}
            {phase.result.report.length > 0 && <ImportReport items={phase.result.report} />}
            <div className="io-actions">
              {(phase.source === 'pptx' || phase.source === 'design') && (
                <button type="button" className="btn btn--ghost io-done__undo" onClick={() => undoImport(phase.result, phase.extra, phase.before)}>
                  <Undo2 size={14} /> {t('features.imp.done.undo')}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setPhase({ name: 'idle' })}>
                <RotateCcw size={14} /> {t('features.io.again')}
              </button>
              {phase.extra?.present && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const id = phase.extra!.present!
                    onClose()
                    useUI.getState().present(id)
                  }}
                >
                  <Presentation size={14} /> {t('features.imp.done.present')}
                </button>
              )}
              <button type="button" className="btn btn--primary" onClick={onClose} data-autofocus="">
                {t('features.io.done.open')}
              </button>
            </div>
          </div>
        )}

        {phase.name === 'deck' && <DeckStep deck={phase.deck} fileName={phase.fileName} onCancel={() => setPhase({ name: 'idle' })} onImport={importPlan} />}

        {phase.name === 'design' && <DesignStep onCancel={() => setPhase({ name: 'idle' })} onImport={importPlan} />}

        {phase.name === 'backup' && (
          <BackupStep
            backup={phase.backup}
            fileName={phase.fileName}
            onCancel={() => setPhase({ name: 'idle' })}
            onDone={(result, ms) => setPhase({ name: 'restored', result, ms, fileName: phase.fileName })}
          />
        )}

        {phase.name === 'restored' && (
          <div className="io-done">
            <div className="io-done__head">
              <Led state="ok" />
              <span className="label">
                {t(phase.result.mode === 'replace' ? 'features.io.restored.labelReplace' : 'features.io.restored.labelMerge', {
                  s: new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(phase.ms / 1000),
                })}
              </span>
              <span className="io-run__name mono">{phase.fileName}</span>
            </div>
            <p className="io-done__summary">
              {phase.result.added + phase.result.updated === 0
                ? t('features.io.restored.nothing', { n: phase.result.unchanged })
                : t('features.io.restored.summary', { added: phase.result.added, updated: phase.result.updated, unchanged: phase.result.unchanged })}
            </p>
            <div className="io-readouts">
              <Readout value={phase.result.added} label={t('features.io.restored.added')} />
              <Readout value={phase.result.updated} label={t('features.io.restored.updated')} />
              <Readout value={phase.result.unchanged} label={t('features.io.restored.unchanged')} />
              <Readout value={phase.result.files} label={unitOf(t, 'file', phase.result.files)} />
            </div>
            <div className="io-actions">
              <button type="button" className="btn" onClick={() => setPhase({ name: 'idle' })}>
                <RotateCcw size={14} /> {t('features.io.again')}
              </button>
              <button type="button" className="btn btn--primary" onClick={onClose} data-autofocus="">
                {t('features.io.done.open')}
              </button>
            </div>
          </div>
        )}

        {phase.name === 'error' && (
          <div className="io-error" role="alert">
            <div className="io-error__stripe" />
            <div className="io-error__body">
              <AlertTriangle size={18} />
              <div>
                <div className="label io-error__label">{t('features.io.err.label')}</div>
                <p>{phase.message}</p>
              </div>
            </div>
            <div className="io-actions">
              <button type="button" className="btn" onClick={() => setPhase({ name: 'idle' })} data-autofocus="">
                <RotateCcw size={14} /> {t('features.io.again')}
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </Modal>
  )
}

/** What could not be carried over 1:1 — grouped, the first few items listed. */
function ImportReport({ items }: { items: ReportItem[] }) {
  const t = useT()
  const SHOW = 6
  return (
    <details className="io-report" open data-report="">
      <summary className="io-report__head">
        <ChevronRight className="io-report__caret" size={14} aria-hidden />
        <span className="label">{t('features.imp.report.title')}</span>
        <span className="io-report__count mono">{String(items.length).padStart(2, '0')}</span>
      </summary>
      <div className="io-report__body">
        {groupReport(items).map((g) => (
          <div key={g.code} className="io-report__group" data-code={g.code}>
            <p className="io-report__msg">{t(`features.imp.report.${g.code}.${plural(g.items.length)}`, { n: g.items.length })}</p>
            <ul className="io-report__list">
              {g.items.filter((it) => it.detail).slice(0, SHOW).map((it, i) => (
                <li key={i}>
                  <span className="mono">{it.detail}</span>
                  {it.where && it.where !== it.detail && <span className="faint"> · {it.where}</span>}
                </li>
              ))}
              {g.items.length > SHOW && <li className="faint">{t('features.imp.report.more', { n: g.items.length - SHOW })}</li>}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}

function BackupStep({ backup, fileName, onCancel, onDone }: { backup: Backup; fileName: string; onCancel: () => void; onDone: (result: RestoreResult, ms: number) => void }) {
  const t = useT()
  const lang = useLang()
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  // a team workspace is everyone's: a backup can add to it, never swap it out
  const team = useCloud((s) => s.active.kind === 'cloud')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stats = backupStats(backup)
  const date = backup.exportedAt ? new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(backup.exportedAt)) : '—'

  const go = async () => {
    if (mode === 'replace' && team) return
    if (mode === 'replace' && !armed) return setArmed(true)
    setBusy({ done: 0, total: backup.files.length })
    const started = performance.now()
    const resume = pauseAutomations()
    try {
      const result = await applyBackup(backup, mode, (done, total) => setBusy({ done, total }))
      await flushSave()
      if (result.target) openPage(result.target)
      onDone(result, performance.now() - started)
    } catch (err) {
      setError((err as Error)?.message ?? String(err))
      setBusy(null)
    } finally {
      resume()
    }
  }

  return (
    <div className="io-backup">
      <div className="io-backup__file">
        <span className="label">{t('features.io.backup.label')}</span>
        <span className="mono io-backup__name">{fileName}</span>
        <span className="faint mono">{date}</span>
      </div>
      <div className="io-readouts io-readouts--sm">
        <Readout value={stats.pages} label={unitOf(t, 'page', stats.pages)} />
        <Readout value={stats.databases} label={unitOf(t, 'db', stats.databases)} />
        <Readout value={stats.rows} label={unitOf(t, 'row', stats.rows)} />
        <Readout value={stats.files} label={unitOf(t, 'file', stats.files)} />
      </div>
      <div className="io-choice" role="radiogroup" aria-label={t('features.io.backup.mode')} onKeyDown={(e) => onRovingKey(e)}>
        {(['merge', 'replace'] as const).map((m, i) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            tabIndex={mode === m ? 0 : -1}
            className="io-choice__opt"
            data-danger={m === 'replace' || undefined}
            disabled={m === 'replace' && team}
            onClick={() => {
              setMode(m)
              setArmed(false)
            }}
          >
            <span className="io-choice__pos mono">{String.fromCharCode(65 + i)}</span>
            <span className="io-choice__text">
              <span className="io-choice__title">{t(`features.io.backup.${m}`)}</span>
              <span className="io-choice__desc muted">{t(team ? `features.io.backup.${m}Team` : `features.io.backup.${m}Desc`)}</span>
            </span>
            <span className="io-choice__led">
              <Led state={mode === m ? 'on' : 'off'} />
            </span>
          </button>
        ))}
      </div>
      {armed && mode === 'replace' && (
        <div className="io-warn" role="alert">
          <div className="io-error__stripe" />
          <p>
            {t('features.io.backup.confirm', {
              list: countList(t, [
                ['page', stats.pages],
                ['db', stats.databases],
                ['row', stats.rows],
                ['file', stats.files],
              ]),
            })}
          </p>
        </div>
      )}
      {error && <p className="io-inline-error">{error}</p>}
      <div className="io-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={!!busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className={`btn ${mode === 'replace' ? 'btn--danger-solid' : 'btn--primary'}`} onClick={go} disabled={!!busy}>
          {busy ? `${t('features.io.restoring')} ${busy.done}/${busy.total}` : mode === 'replace' ? (armed ? t('features.io.backup.confirmBtn') : t('features.io.backup.replace')) : t('features.io.backup.mergeBtn')}
        </button>
      </div>
    </div>
  )
}
