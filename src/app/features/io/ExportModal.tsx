/**
 * Export: scope (this page + subpages / whole workspace) × format (Website ZIP · Markdown ZIP · HTML · JSON backup · PDF).
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
import { collectRefs, collectTree, downloadBlob, formatBytes, slugify, todayStamp, treeStats } from './export/collect'
import { buildMarkdownZip } from './export/markdown'
import { buildHTML, printHTML } from './export/html'
import { backupFileRefs, buildBackup } from './backup'
import { normalizeBaseUrl, planSite, siteCounts } from './export/site/plan'
import { Meter } from './parts'
import { countOf, unitOf } from './count'
import { onRovingKey } from './roving'
import { SiteOptions, loadSitePrefs, saveSitePrefs } from './SiteOptions'
import './io.css'

type Format = 'site' | 'md' | 'html' | 'json' | 'pdf'
const FORMATS: Array<{ id: Format; code: string; ext: string }> = [
  { id: 'site', code: 'SITE', ext: 'zip' },
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
  const [result, setResult] = useState<{ name: string; size: number | null; files?: number } | null>(null)
  // website options (base URL + feed are remembered on this device)
  const [siteTitle, setSiteTitle] = useState(() => workspaceName || 'One')
  const [baseUrlRaw, setBaseUrlRaw] = useState(() => loadSitePrefs().baseUrl)
  const [feed, setFeed] = useState(() => loadSitePrefs().feed)
  const [error, setError] = useState<string | null>(null)

  const rootId = scope === 'page' && hasPage ? page!.id : null
  const tree = useMemo(() => collectTree(rootId), [rootId, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => treeStats(tree), [tree])
  const pageTree = useMemo(() => (hasPage ? treeStats(collectTree(page!.id)) : null), [hasPage, page, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const allStats = useMemo(() => treeStats(collectTree(null)), [pages])
  const baseUrl = useMemo(() => normalizeBaseUrl(baseUrlRaw), [baseUrlRaw])
  const plan = useMemo(() => (format === 'site' ? planSite(tree, rootId) : null), [format, tree, rootId])
  const feedDbs = useMemo(() => (plan ? [...plan.rows.keys()].map((id) => tree.pages[id]).filter(Boolean) : []), [plan, tree])
  const feedValue = feedDbs.some((p) => p.id === feed) ? feed : 'recent'
  const site = plan ? siteCounts(plan, !!baseUrl) : null
  // exactly the files the chosen format will contain (a backup also keeps files of trashed pages)
  const fileCount = useMemo(() => (format === 'json' ? backupFileRefs(rootId).length : collectRefs(tree).length), [format, rootId, tree])

  useEffect(() => {
    saveSitePrefs({ baseUrl: baseUrlRaw, feed })
  }, [baseUrlRaw, feed])

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
  const fileName = format === 'pdf' ? t('features.io.export.printDialog') : format === 'site' ? `${slugify(siteTitle || workspaceName || 'one')}-site.zip` : `${baseName}.${fmt.ext}`
  const title = rootId ? page!.title.trim() || t('common.untitled') : workspaceName || 'One'

  const run = async () => {
    setProgress(0)
    setError(null)
    setResult(null)
    const onProgress = (done: number, total: number) => setProgress(total ? done / total : 1)
    try {
      if (format === 'site') {
        const { buildSite } = await import('./export/site/build')
        const built = await buildSite(tree, rootId, {
          title: siteTitle.trim() || workspaceName || 'One',
          baseUrl: baseUrl ?? '',
          feed: feedValue === 'recent' ? { kind: 'recent' } : { kind: 'database', databaseId: feedValue },
          lang,
          onProgress,
        })
        downloadBlob(built.blob, fileName)
        setResult({ name: fileName, size: built.blob.size, files: built.files })
      } else if (format === 'md') {
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
            pages: (n) => countOf(t, 'page', n),
            contents: t('features.io.export.contents'),
            rows: (n) => countOf(t, 'row', n),
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
  const blocked = format === 'site' && baseUrl === null

  return (
    <Modal
      open
      onClose={onClose}
      label="§ IO-02"
      title={t('features.io.export.title')}
      width={800}
      className="io-modal"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {result ? t('common.done') : t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={run} disabled={busy || blocked || tree.all.length === 0} data-export-run="">
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
          <div className="io-scope" role="radiogroup" aria-label={t('features.io.export.scope')} onKeyDown={(e) => onRovingKey(e)}>
            <button type="button" role="radio" aria-checked={scope === 'page'} tabIndex={scope === 'page' ? 0 : -1} className="io-scope__opt" disabled={!hasPage} onClick={() => setScope('page')}>
              <Led state={scope === 'page' ? 'on' : 'off'} />
              <span className="io-scope__text">
                <span className="io-scope__title">
                  {hasPage && <PageIcon icon={page!.icon} kind={page!.kind} size={15} />}
                  {hasPage ? page!.title.trim() || t('common.untitled') : t('features.io.export.noPage')}
                </span>
                <span className="io-scope__meta label">
                  {pageTree ? `+ ${countOf(t, 'subpage', Math.max(0, pageTree.pages + pageTree.dbs - 1))} · ${countOf(t, 'row', pageTree.rows)}` : '—'}
                </span>
              </span>
            </button>
            <button type="button" role="radio" aria-checked={scope === 'workspace'} tabIndex={scope === 'workspace' ? 0 : -1} className="io-scope__opt" onClick={() => setScope('workspace')}>
              <Led state={scope === 'workspace' ? 'on' : 'off'} />
              <span className="io-scope__text">
                <span className="io-scope__title">{t('features.io.export.workspace')}</span>
                <span className="io-scope__meta label">
                  {countOf(t, 'page', allStats.pages)} · {countOf(t, 'db', allStats.dbs)}
                </span>
              </span>
            </button>
          </div>
        </section>

        <section className="io-section">
          <div className="io-section__label label">
            <b>B</b> {t('features.io.export.format')}
          </div>
          <div className="io-formats" role="radiogroup" aria-label={t('features.io.export.format')} onKeyDown={(e) => onRovingKey(e)}>
            {FORMATS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={format === f.id} tabIndex={format === f.id ? 0 : -1} className="io-fmt" onClick={() => setFormat(f.id)}>
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

        {format === 'site' && (
          <SiteOptions
            title={siteTitle}
            onTitle={setSiteTitle}
            baseUrlRaw={baseUrlRaw}
            onBaseUrl={setBaseUrlRaw}
            baseUrl={baseUrl}
            feed={feedValue}
            onFeed={setFeed}
            feedDbs={feedDbs}
          />
        )}

        <div className="io-manifest" aria-live="polite">
          {site ? (
            <span data-site-pages="">
              <b>{site.pages}</b> {t(site.pages === 1 ? 'features.site.webPage.one' : 'features.site.webPage.other')}
            </span>
          ) : (
            <span>
              <b>{stats.pages}</b> {unitOf(t, 'page', stats.pages)}
            </span>
          )}
          <span>
            <b>{stats.dbs}</b> {unitOf(t, 'db', stats.dbs)}
          </span>
          <span>
            <b>{stats.rows}</b> {unitOf(t, 'row', stats.rows)}
          </span>
          <span>
            <b>{site ? site.files : fileCount}</b> {unitOf(t, 'file', site ? site.files : fileCount)}
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
            <FileDown size={15} />{' '}
            {result.size === null
              ? result.name
              : result.files !== undefined
                ? t('features.site.saved', { name: result.name, size: formatBytes(result.size, lang), files: countOf(t, 'file', result.files) })
                : t('features.io.export.saved', { name: result.name, size: formatBytes(result.size, lang) })}
          </p>
        )}
        {error && <p className="io-inline-error">{t('features.io.err.generic', { msg: error })}</p>}
      </div>
    </Modal>
  )
}
