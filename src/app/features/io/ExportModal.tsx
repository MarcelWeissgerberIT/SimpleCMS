/**
 * Export: scope (this page + subpages / whole workspace) × format (Markdown ZIP · HTML · JSON backup · PDF).
 */
import { useEffect, useMemo, useState } from 'react'
import { Download, FileDown, Printer } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Led } from '../../ui/controls'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { usePage } from '../../store/selectors'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { listFileRefs } from '../../lib/files'
import { collectRefs, collectTree, downloadBlob, formatBytes, slugify, todayStamp, treeStats } from './export/collect'
import { buildMarkdownZip } from './export/markdown'
import { buildHTML, printHTML } from './export/html'
import { buildBackup } from './backup'
import { Meter } from './parts'
import './io.css'

type Format = 'md' | 'html' | 'json' | 'pdf'
const FORMATS: Array<{ id: Format; code: string; ext: string }> = [
  { id: 'md', code: 'MD.ZIP', ext: 'zip' },
  { id: 'html', code: 'HTML', ext: 'html' },
  { id: 'json', code: 'JSON', ext: 'json' },
  { id: 'pdf', code: 'PDF', ext: 'pdf' },
]

export function ExportModal({ pageId, onClose }: { pageId?: ID | null; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const page = usePage(pageId ?? null)
  const pages = useWorkspace((s) => s.pages)
  const workspaceName = useWorkspace((s) => s.settings.workspaceName)
  const hasPage = !!page && !page.trashed
  const [scope, setScope] = useState<'page' | 'workspace'>(hasPage ? 'page' : 'workspace')
  const [format, setFormat] = useState<Format>(() => {
    try {
      const f = localStorage.getItem('one.export.format') as Format | null
      return f && FORMATS.some((x) => x.id === f) ? f : 'md'
    } catch {
      return 'md'
    }
  })
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<{ name: string; size: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wsFiles, setWsFiles] = useState<number | null>(null)

  const rootId = scope === 'page' && hasPage ? page!.id : null
  const tree = useMemo(() => collectTree(rootId), [rootId, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => treeStats(tree), [tree])
  const pageTree = useMemo(() => (hasPage ? treeStats(collectTree(page!.id)) : null), [hasPage, page, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const allStats = useMemo(() => treeStats(collectTree(null)), [pages])
  const fileCount = rootId ? collectRefs(tree).length : (wsFiles ?? collectRefs(tree).length)

  useEffect(() => {
    let alive = true
    listFileRefs()
      .then((r) => alive && setWsFiles(r.length))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('one.export.format', format)
    } catch {
      /* private mode */
    }
    setResult(null)
    setError(null)
  }, [format, scope])

  const baseName = `${slugify(rootId ? page!.title || t('common.untitled') : workspaceName || 'one')}-${todayStamp()}`
  const fmt = FORMATS.find((f) => f.id === format)!
  const fileName = format === 'pdf' ? t('features.io.export.printDialog') : `${baseName}.${fmt.ext}`
  const title = rootId ? page!.title.trim() || t('common.untitled') : workspaceName || 'One'

  const run = async () => {
    setProgress(0)
    setError(null)
    setResult(null)
    const onProgress = (done: number, total: number) => setProgress(total ? done / total : 1)
    try {
      if (format === 'md') {
        const blob = await buildMarkdownZip(tree, { untitled: t('common.untitled'), onProgress })
        downloadBlob(blob, fileName)
        setResult({ name: fileName, size: blob.size })
      } else if (format === 'json') {
        const backup = await buildBackup(rootId, onProgress)
        const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
        downloadBlob(blob, fileName)
        setResult({ name: fileName, size: blob.size })
      } else {
        const html = await buildHTML(tree, {
          title,
          lang,
          untitled: t('common.untitled'),
          appUrl: `${window.location.origin}${window.location.pathname}`,
          forPrint: format === 'pdf',
          labels: {
            exported: t('features.io.export.plate'),
            pages: t('features.io.unit.pages'),
            contents: t('features.io.export.contents'),
            rows: t('features.io.unit.rows'),
            generator: t('features.io.export.generator'),
          },
          onProgress,
        })
        if (format === 'html') {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
          downloadBlob(blob, fileName)
          setResult({ name: fileName, size: blob.size })
        } else {
          await printHTML(html)
          setResult({ name: t('features.io.export.printed'), size: null })
        }
      }
      setProgress(1)
    } catch (err) {
      console.error('[export] failed', err)
      setError((err as Error)?.message ?? String(err))
      setProgress(null)
    }
  }

  const busy = progress !== null && progress < 1 && !result && !error

  return (
    <Modal
      open
      onClose={onClose}
      label="§ IO-02"
      title={t('features.io.export.title')}
      width={720}
      className="io-modal"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {result ? t('common.done') : t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={run} disabled={busy || tree.all.length === 0} data-export-run="">
            {format === 'pdf' ? <Printer size={15} /> : <Download size={15} />}
            {format === 'pdf' ? t('features.io.export.print') : t('features.io.export.go', { fmt: fmt.code })}
          </button>
        </>
      }
    >
      <div className="io">
        <section className="io-section">
          <div className="io-section__label label">
            <b>A</b> {t('features.io.export.scope')}
          </div>
          <div className="io-scope" role="radiogroup" aria-label={t('features.io.export.scope')}>
            <button type="button" role="radio" aria-checked={scope === 'page'} className="io-scope__opt" disabled={!hasPage} onClick={() => setScope('page')}>
              <Led state={scope === 'page' ? 'on' : 'off'} />
              <span className="io-scope__text">
                <span className="io-scope__title">
                  {hasPage && <PageIcon icon={page!.icon} kind={page!.kind} size={15} />}
                  {hasPage ? page!.title.trim() || t('common.untitled') : t('features.io.export.noPage')}
                </span>
                <span className="io-scope__meta label">
                  {pageTree ? t('features.io.export.pageMeta', { n: Math.max(0, pageTree.pages + pageTree.dbs - 1), rows: pageTree.rows }) : '—'}
                </span>
              </span>
            </button>
            <button type="button" role="radio" aria-checked={scope === 'workspace'} className="io-scope__opt" onClick={() => setScope('workspace')}>
              <Led state={scope === 'workspace' ? 'on' : 'off'} />
              <span className="io-scope__text">
                <span className="io-scope__title">{t('features.io.export.workspace')}</span>
                <span className="io-scope__meta label">{t('features.io.export.wsMeta', { pages: allStats.pages, dbs: allStats.dbs })}</span>
              </span>
            </button>
          </div>
        </section>

        <section className="io-section">
          <div className="io-section__label label">
            <b>B</b> {t('features.io.export.format')}
          </div>
          <div className="io-formats" role="radiogroup" aria-label={t('features.io.export.format')}>
            {FORMATS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={format === f.id} className="io-fmt" onClick={() => setFormat(f.id)}>
                <span className="io-fmt__top">
                  <span className="io-fmt__code">{f.code}</span>
                  <Led state={format === f.id ? 'on' : 'off'} />
                </span>
                <span className="io-fmt__name">{t(`features.io.fmt.${f.id}`)}</span>
                <span className="io-fmt__desc muted">{t(`features.io.fmt.${f.id}Desc`)}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="io-manifest" aria-live="polite">
          <span>
            <b>{stats.pages}</b> {t('features.io.unit.pages')}
          </span>
          <span>
            <b>{stats.dbs}</b> {t('features.io.unit.dbs')}
          </span>
          <span>
            <b>{stats.rows}</b> {t('features.io.unit.rows')}
          </span>
          <span>
            <b>{fileCount}</b> {t('features.io.unit.files')}
          </span>
          <span className="io-manifest__file">→ {fileName}</span>
        </div>

        {progress !== null && (
          <div className="io-export-run">
            <Led state={result ? 'ok' : error ? 'off' : 'on'} />
            <Meter value={progress} segments={36} />
            <span className="mono faint" style={{ fontSize: 'var(--text-xs)', minWidth: 40, textAlign: 'right' }}>
              {Math.round(progress * 100)}%
            </span>
          </div>
        )}
        {result && (
          <p className="io-saved" role="status">
            <FileDown size={15} /> {result.size !== null ? t('features.io.export.saved', { name: result.name, size: formatBytes(result.size, lang) }) : result.name}
          </p>
        )}
        {error && <p className="io-inline-error">{t('features.io.err.generic', { msg: error })}</p>}
      </div>
    </Modal>
  )
}
