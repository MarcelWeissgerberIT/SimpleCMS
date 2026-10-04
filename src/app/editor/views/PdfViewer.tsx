/**
 * PDF viewer: a PDF file block shown inline in the browser's own PDF viewer — no pdf.js. Only a
 * LOCAL file ("onefile:") is framed: handed over as a blob URL typed application/pdf, and only when
 * its bytes start with "%PDF-", so nothing else ever renders in this origin. Chrome refuses its
 * viewer inside sandboxed frames, so this frame has no sandbox — which is why it only ever shows
 * bytes that were checked here.
 * A web PDF (an embed of a .pdf link, a file block pointing at one) is never framed: its server could
 * answer with a page instead of a PDF, and that page would run unsandboxed next to One. It shows as
 * a link card instead — name, host, "Open" in a new tab, "Download".
 */
import { useEffect, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react'
import { Download, ExternalLink, FileText, PanelTop, Rows2 } from 'lucide-react'
import { FILE_PREFIX, getFile } from '../../lib/files'
import { useT } from '../../i18n'
import { domainOf, webUrl } from '../lib/embeds'
import './blocks.css'

/** File name / link that reads as a PDF. */
export function isPdfName(name: string | null | undefined): boolean {
  return /\.pdf$/i.test((name ?? '').trim())
}

type Source = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'none' }

/** The blob URL the frame shows: the local file re-typed as PDF, after its first bytes said it is one. */
function usePdfSource(src: string): Source {
  const [source, setSource] = useState<Source>({ state: 'loading' })
  useEffect(() => {
    let alive = true
    let url = ''
    setSource({ state: 'loading' })
    getFile(src)
      .then(async (f) => {
        if (!alive) return
        const head = f ? new Uint8Array(await f.blob.slice(0, 5).arrayBuffer()) : null
        const pdf = !!head && String.fromCharCode(...head) === '%PDF-'
        if (!alive) return
        if (!f || !pdf) return setSource({ state: 'none' })
        url = URL.createObjectURL(new Blob([f.blob], { type: 'application/pdf' }))
        setSource({ state: 'ready', url })
      })
      .catch(() => alive && setSource({ state: 'none' }))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])
  return source
}

/** A web link to the PDF (an explicit http(s) URL), or null. */
function webHref(src: string): string | null {
  return /^https?:\/\//i.test(src.trim()) ? (webUrl(src)?.toString() ?? null) : null
}

/**
 * A page whose security policy blocks such frames (a self-hosted server allowing only https frames)
 * reports it here: the block then says so instead of showing an empty box.
 */
function useFrameBlocked(url: string | null): boolean {
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    setBlocked(false)
    if (!url) return
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (!/^(frame|child|object)-src/.test(e.effectiveDirective || e.violatedDirective)) return
      const blockedUri = e.blockedURI
      if (blockedUri === url || (url.startsWith('blob:') && blockedUri.startsWith('blob')) || url.startsWith(blockedUri)) setBlocked(true)
    }
    document.addEventListener('securitypolicyviolation', onViolation)
    return () => document.removeEventListener('securitypolicyviolation', onViolation)
  }, [url])
  return blocked
}

export interface PdfViewerProps {
  /** "onefile:<id>" (the inline viewer) or a link to a PDF (a link card, never framed). */
  src: string
  name: string
  /** Size line (e.g. "1.2 MB"), when known. */
  meta?: string
  selected: boolean
  editable: boolean
  /** Toggle to the compact file card (absent: no toggle; a web PDF is a card already and has none). */
  onShowAsFile?: () => void
  /** Escape inside the toolbar: back to the block. */
  onEscape?: () => void
  /** Extra toolbar buttons (e.g. the embed's "show as bookmark"). */
  extra?: ReactNode
  /** data-type of the wrapper element (file | embed). */
  dataType: string
}

/** A PDF block: the inline viewer for a local file, a link card for a web PDF (never framed). */
export function PdfViewer(props: PdfViewerProps) {
  return props.src.startsWith(FILE_PREFIX) ? <LocalPdf {...props} /> : <PdfLinkCard {...props} />
}

/** Escape inside a block's toolbar: back to the block. */
function escapeKey(onEscape?: () => void) {
  return (e: RKeyboardEvent) => {
    if (e.key !== 'Escape' || !onEscape) return
    e.preventDefault()
    e.stopPropagation()
    onEscape()
  }
}

function LocalPdf({ src, name, meta, selected, editable, onShowAsFile, onEscape, extra, dataType }: PdfViewerProps) {
  const t = useT()
  const source = usePdfSource(src)
  const url = source.state === 'ready' ? source.url : null
  const blocked = useFrameBlocked(url)
  return (
    <div className={`pdf-view${selected ? ' is-selected' : ''}`} data-type={dataType} data-pdf="">
      <div className="pdf-view__bar">
        <span className={`led${url && !blocked ? ' led--on' : ''}`} aria-hidden />
        <span className="label pdf-view__kind">PDF</span>
        <span className="pdf-view__name" title={name}>
          {name}
        </span>
        {meta && <span className="pdf-view__meta">{meta}</span>}
        <span className="pdf-view__spacer" />
        <span className="pdf-view__tools" role="toolbar" aria-label={t('editor.pdf.tools')} data-block-tools="" onKeyDown={escapeKey(onEscape)}>
          {extra}
          {editable && onShowAsFile && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onShowAsFile} title={t('editor.pdf.asFile')} aria-label={t('editor.pdf.asFile')}>
              <Rows2 size={13} />
              <span className="pdf-view__btnText">{t('editor.pdf.asFileShort')}</span>
            </button>
          )}
          <a
            className="btn btn--ghost btn--sm"
            href={url ?? undefined}
            download={name}
            aria-disabled={!url}
            onClick={(e) => !url && e.preventDefault()}
            title={t('editor.file.download')}
            aria-label={t('editor.file.download')}
          >
            <Download size={13} />
          </a>
        </span>
      </div>
      <div className="pdf-view__frame">
        {url && !blocked ? (
          <iframe src={`${url}#view=FitH&navpanes=0`} title={t('editor.pdf.frameTitle', { name })} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="pdf-view__note">
            <FileText size={22} strokeWidth={1.5} aria-hidden />
            <span className="label">{source.state === 'loading' ? t('common.loading') : blocked ? t('editor.pdf.blocked') : t('editor.pdf.unavailable')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A web PDF as a file card: never framed, never fetched by One. "Open" and "Download" go to a new tab
 * without opener or referrer — whatever the server answers stays in that tab.
 */
function PdfLinkCard({ src, name, meta, selected, onEscape, extra, dataType }: PdfViewerProps) {
  const t = useT()
  const href = webHref(src)
  const host = href ? domainOf(href) : ''
  const off = { 'aria-disabled': true, onClick: (e: { preventDefault: () => void }) => e.preventDefault() }
  const link = href ? { href, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' as const } : off
  return (
    <div className={`file-view pdf-link${selected ? ' is-selected' : ''}`} data-type={dataType} data-pdf="link">
      <span className="file-view__tile" aria-hidden>
        <span>PDF</span>
      </span>
      <span className="file-view__meta">
        <span className="file-view__name" title={name}>
          {name}
        </span>
        <span className="file-view__size">{href ? [host, meta && meta !== host ? meta : null, t('editor.pdf.web')].filter(Boolean).join(' · ') : t('editor.pdf.unavailable')}</span>
      </span>
      <span className="file-view__tools" role="toolbar" aria-label={t('editor.pdf.tools')} data-block-tools="" onKeyDown={escapeKey(onEscape)}>
        {extra}
        <a className="btn btn--sm" {...link} title={t('editor.pdf.openTab')} aria-label={t('editor.pdf.openTab')}>
          <ExternalLink size={13} /> <span className="pdf-view__btnText">{t('common.open')}</span>
        </a>
        <a className="btn btn--ghost btn--sm" {...link} download={name} title={t('editor.file.download')} aria-label={t('editor.file.download')}>
          <Download size={13} />
        </a>
      </span>
    </div>
  )
}

/** The "show as viewer" key on a PDF's compact file card. */
export function ShowViewerButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button type="button" className="btn btn--sm" onClick={onClick} title={t('editor.pdf.asViewer')} aria-label={t('editor.pdf.asViewer')}>
      <PanelTop size={13} /> <span className="pdf-view__btnText">{t('editor.pdf.asViewerShort')}</span>
    </button>
  )
}
