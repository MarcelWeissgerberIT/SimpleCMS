/**
 * PDF viewer: a PDF file block (or an embed of a .pdf link) shown inline in the browser's own
 * PDF viewer — no pdf.js. A local file ("onefile:") is handed to the frame as a blob URL typed
 * application/pdf (only when its bytes start with "%PDF-", so nothing else ever renders in this
 * origin); a web PDF loads from its https URL. Chrome refuses its viewer inside sandboxed frames,
 * so this frame has no sandbox — which is why it only ever shows a PDF.
 */
import { useEffect, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react'
import { Download, ExternalLink, FileText, PanelTop, Rows2 } from 'lucide-react'
import { FILE_PREFIX, getFile } from '../../lib/files'
import { useT } from '../../i18n'
import { safeHref } from '../lib/embeds'
import './blocks.css'

/** File name / link that reads as a PDF. */
export function isPdfName(name: string | null | undefined): boolean {
  return /\.pdf$/i.test((name ?? '').trim())
}

type Source = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'none' }

/** The URL the frame shows: a blob URL typed as PDF for local files, the https link otherwise. */
function usePdfSource(src: string): Source {
  const [source, setSource] = useState<Source>(() => (src.startsWith(FILE_PREFIX) ? { state: 'loading' } : pdfLink(src)))
  useEffect(() => {
    if (!src.startsWith(FILE_PREFIX)) {
      setSource(pdfLink(src))
      return
    }
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

function pdfLink(src: string): Source {
  const href = safeHref(src)
  return href && /^https:\/\//i.test(href) ? { state: 'ready', url: href } : { state: 'none' }
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
  /** "onefile:<id>" or an https link to a PDF. */
  src: string
  name: string
  /** Size line (e.g. "1.2 MB"), when known. */
  meta?: string
  selected: boolean
  editable: boolean
  /** Toggle to the compact file card (absent: no toggle). */
  onShowAsFile?: () => void
  /** Escape inside the toolbar: back to the block. */
  onEscape?: () => void
  /** Extra toolbar buttons (e.g. the embed's "show as bookmark"). */
  extra?: ReactNode
  /** data-type of the wrapper element (file | embed). */
  dataType: string
}

export function PdfViewer({ src, name, meta, selected, editable, onShowAsFile, onEscape, extra, dataType }: PdfViewerProps) {
  const t = useT()
  const source = usePdfSource(src)
  const url = source.state === 'ready' ? source.url : null
  const blocked = useFrameBlocked(url)
  const local = src.startsWith(FILE_PREFIX)
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key !== 'Escape' || !onEscape) return
    e.preventDefault()
    e.stopPropagation()
    onEscape()
  }
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
        <span className="pdf-view__tools" role="toolbar" aria-label={t('editor.pdf.tools')} data-block-tools="" onKeyDown={onKeyDown}>
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
            {...(local ? { download: name } : { target: '_blank', rel: 'noopener noreferrer' })}
            aria-disabled={!url}
            onClick={(e) => !url && e.preventDefault()}
            title={local ? t('editor.file.download') : t('common.open')}
            aria-label={local ? t('editor.file.download') : t('common.open')}
          >
            {local ? <Download size={13} /> : <ExternalLink size={13} />}
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

/** The "show as viewer" key on a PDF's compact file card. */
export function ShowViewerButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button type="button" className="btn btn--sm" onClick={onClick} title={t('editor.pdf.asViewer')} aria-label={t('editor.pdf.asViewer')}>
      <PanelTop size={13} /> <span className="pdf-view__btnText">{t('editor.pdf.asViewerShort')}</span>
    </button>
  )
}
