/**
 * Import: Notion export ZIP (Markdown & CSV, nested part zips), Markdown/text files, CSV, One JSON backup.
 * Drag & drop (files or folders) or file picker → staged progress meter → summary → opens the imported root.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileUp, FolderUp, RotateCcw } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { resolveAssetUrl } from '../../lib/files'
import { openPage } from '../../lib/router'
import { flushSave } from '../../store/persistence'
import { pauseAutomations } from '../automations/engine'
import { basename, buildPlan, expandZip, extname, isZip, planStats, type ImportEntry } from './import/plan'
import { applyPlan, type ImportResult } from './import/apply'
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
  | { name: 'done'; result: ImportResult; ms: number; skipped: string[] }
  | { name: 'restored'; result: RestoreResult; ms: number; fileName: string }
  | { name: 'error'; message: string }

const STAGES: StageId[] = ['read', 'unpack', 'files', 'pages', 'commit']
const ACCEPT = '.zip,.md,.markdown,.txt,.csv,.tsv,.json,image/*,.pdf'
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
  const busy = phase.name === 'running'

  const dateLabel = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())

  const run = useCallback(
    async (picked: Picked[]) => {
      if (!picked.length) return
      // 1) a single JSON → backup flow; backups mixed with other files are skipped (and reported)
      const jsons = picked.filter((p) => extname(p.path) === 'json')
      if (jsons.length && jsons.length === picked.length) {
        if (jsons.length > 1) return setPhase({ name: 'error', message: t('features.io.err.backupOne') })
        const text = await jsons[0].file.text()
        const backup = parseBackup(text)
        if (!backup) return setPhase({ name: 'error', message: t('features.io.err.backup') })
        return setPhase({ name: 'backup', backup, fileName: jsons[0].file.name })
      }
      const skipped = jsons.map((p) => basename(p.path))
      const started = performance.now()
      const stages = freshStages()
      let current: StageId = 'read'
      const update = (stage: StageId, done: number, total: number) => {
        current = stage
        stages[stage] = { done, total }
        setPhase({ name: 'running', stages: { ...stages }, current, source: picked.length === 1 ? picked[0].file.name : t('features.io.nFiles', { n: picked.length }) })
      }
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
        for (const zip of zips) {
          // several unrelated zips → one folder each (named after the zip); Notion parts → shared root
          let prefix = ''
          if (zips.length > 1 && !PART_ZIP.test(zip.name)) {
            const base = zip.name.replace(/\.zip$/i, '') || 'zip'
            prefix = base
            for (let k = 2; usedPrefixes.has(prefix.toLowerCase()); k++) prefix = `${base} (${k})`
            usedPrefixes.add(prefix.toLowerCase())
          }
          entries.push(...(await expandZip(zip.data, prefix)))
          update('unpack', ++z, zips.length)
        }
        if (!zips.length) update('unpack', 1, 1)
        const plan = buildPlan(entries, { looseTitle: t('features.io.looseTitle', { date: dateLabel }) })
        if (!plan.nodes.length) {
          setPhase({ name: 'error', message: plan.warnings.includes('html-export') ? t('features.io.err.html') : t('features.io.err.nothing') })
          return
        }
        const stats = planStats(plan)
        update('files', 0, stats.files)
        update('pages', 0, plan.nodes.length)
        if (!stats.files) update('files', 1, 1)
        const result = await applyPlan(plan, {
          containerTitle: plan.isNotion ? t('features.io.containerNotion', { date: dateLabel }) : t('features.io.container', { date: dateLabel }),
          containerNote: t('features.io.containerNote', {
            list: countList(t, [
              ['page', stats.pages],
              ['db', stats.databases],
              ['row', stats.rows],
              ['file', stats.files],
            ]),
            source: picked.length === 1 ? picked[0].file.name : t('features.io.nFiles', { n: picked.length }),
          }),
          untitled: t('common.untitled'),
          viewNames: { table: t('features.io.view.table'), board: t('features.io.view.board'), calendar: t('features.io.view.calendar') },
          onProgress: (p) => update(p.stage, p.done, p.total),
        })
        update('commit', 1, 1)
        await flushSave()
        if (result.rootId) openPage(result.rootId)
        setPhase({ name: 'done', result, ms: performance.now() - started, skipped })
      } catch (err) {
        console.error('[import] failed', err)
        setPhase({ name: 'error', message: t('features.io.err.generic', { msg: (err as Error)?.message ?? String(err) }) })
      } finally {
        resume()
      }
    },
    [t, dateLabel],
  )

  const onPick = (list: FileList | null, folder = false) => {
    if (!list?.length) return
    const picked = [...list].map((file) => ({ path: (folder && (file as File & { webkitRelativePath?: string }).webkitRelativePath) || file.name, file }))
    void run(picked)
  }

  // drag & drop anywhere on the dialog
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (busy) return
    void run(await readDrop(e.dataTransfer))
  }

  // paste files (⌘V) while the dialog is open
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (busy || !e.clipboardData?.files.length) return
      e.preventDefault()
      onPick(e.clipboardData.files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  return (
    <Modal open onClose={busy ? () => {} : onClose} label="§ IO-01" title={t('features.io.import.title')} width={720} className="io-modal">
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
              <img className="io-drop__art" src={resolveAssetUrl('assets/icons/import.webp')} alt="" width={84} height={84} draggable={false} />
              <div className="io-drop__title display">{over ? t('features.io.drop.release') : t('features.io.drop.title')}</div>
              <div className="io-drop__sub muted">{t('features.io.drop.sub')}</div>
              <div className="io-drop__actions">
                <button type="button" className="btn btn--ink" onClick={() => filesRef.current?.click()} data-autofocus="">
                  <FileUp size={15} /> {t('features.io.pickFiles')}
                </button>
                <button type="button" className="btn" onClick={() => folderRef.current?.click()}>
                  <FolderUp size={15} /> {t('features.io.pickFolder')}
                </button>
              </div>
              <div className="io-drop__formats label">ZIP · MD · TXT · CSV · TSV · JSON</div>
              <input ref={filesRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (onPick(e.target.files), (e.target.value = ''))} />
              <input
                ref={folderRef}
                type="file"
                hidden
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => (onPick(e.target.files, true), (e.target.value = ''))}
              />
            </div>
            <div className="io-spec">
              <div className="io-spec__head label">
                <span>{t('features.io.spec.input')}</span>
                <span>{t('features.io.spec.result')}</span>
              </div>
              {(
                [
                  ['01', 'ZIP', t('features.io.spec.notion'), t('features.io.spec.notionOut')],
                  ['02', 'MD · TXT', t('features.io.spec.md'), t('features.io.spec.mdOut')],
                  ['03', 'CSV · TSV', t('features.io.spec.csv'), t('features.io.spec.csvOut')],
                  ['04', 'JSON', t('features.io.spec.json'), t('features.io.spec.jsonOut')],
                ] as const
              ).map(([n, code, what, out]) => (
                <div key={n} className="io-spec__row">
                  <span className="io-spec__n mono">{n}</span>
                  <span className="io-spec__code mono">{code}</span>
                  <span className="io-spec__what">{what}</span>
                  <span className="io-spec__out muted">→ {out}</span>
                </div>
              ))}
            </div>
            <p className="io-hint faint">{t('features.io.hint')}</p>
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
    </Modal>
  )
}

function BackupStep({ backup, fileName, onCancel, onDone }: { backup: Backup; fileName: string; onCancel: () => void; onDone: (result: RestoreResult, ms: number) => void }) {
  const t = useT()
  const lang = useLang()
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stats = backupStats(backup)
  const date = backup.exportedAt ? new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(backup.exportedAt)) : '—'

  const go = async () => {
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
            onClick={() => {
              setMode(m)
              setArmed(false)
            }}
          >
            <span className="io-choice__pos mono">{String.fromCharCode(65 + i)}</span>
            <span className="io-choice__text">
              <span className="io-choice__title">{t(`features.io.backup.${m}`)}</span>
              <span className="io-choice__desc muted">{t(`features.io.backup.${m}Desc`)}</span>
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
