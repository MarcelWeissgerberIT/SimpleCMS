/**
 * "Save to Inbox?" — shown for a web clip that did not come with this device's clip token
 * (share target, older bookmarklets, links from other sites). It shows what would be saved
 * (title, source host, a preview of the selection, shared files) and saves only on "Save to Inbox".
 * Mounted on demand in its own root (the #/clip route is already replaced by then).
 */
import { useId } from 'react'
import { createRoot } from 'react-dom/client'
import { File, FileText, Globe, Image, Inbox, Music, Video, type LucideIcon } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import type { FileBlockKind } from '../../features'
import type { Clip } from './inbox'
import type { ShareFileInfo, SkippedFile } from './share'
import './capture.css'

/** What came with a share (files shared into the installed app). */
export interface ShareInfo {
  files: ShareFileInfo[]
  skipped: SkippedFile[]
}

const KIND_ICON: Record<FileBlockKind, LucideIcon> = { image: Image, pdf: FileText, audio: Music, video: Video, file: File }

/** "2.4 MB", "830 KB" */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const PREVIEW = 280

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > PREVIEW ? `${chars.slice(0, PREVIEW).join('').replace(/\s\S*$/, '')}…` : flat
}

export function ClipConfirm({ clip, share, onSave, onDiscard }: { clip: Clip; share?: ShareInfo; onSave: () => void; onDiscard: () => void }) {
  const t = useT()
  const id = useId()
  const host = hostOf(clip.url)
  const quote = clip.text ? preview(clip.text) : ''
  const files = share?.files ?? []
  const skipped = share?.skipped ?? []
  return (
    <Modal open onClose={onDiscard} width={480} bare className="clipq" ariaLabel={t('shell.capture.ask.title')}>
      <form
        className="clipq__body"
        aria-describedby={`${id}-why`}
        onSubmit={(e) => {
          e.preventDefault()
          onSave()
        }}
        data-clip-confirm=""
      >
        <div className="clipq__head">
          <span className="label clipq__code">
            <span className="led led--on" aria-hidden /> {t(share ? 'shell.capture.share.label' : 'shell.capture.ask.label')}
          </span>
          <span className="label clipq__dest">
            <Inbox size={12} strokeWidth={1.75} aria-hidden /> {t('shell.capture.inbox')}
          </span>
        </div>
        <h2 className="clipq__title">{t('shell.capture.ask.title')}</h2>
        <p className="clipq__why" id={`${id}-why`}>
          {t(share ? 'shell.capture.share.why' : 'shell.capture.ask.why')}
        </p>
        <dl className="clipq__spec">
          <div className="clipq__row">
            <dt className="label">{t('shell.capture.ask.page')}</dt>
            <dd className="clipq__page">{clip.title}</dd>
          </div>
          {(!share || host) && (
            <div className="clipq__row">
              <dt className="label">{t('shell.capture.ask.source')}</dt>
              <dd className="clipq__host mono" title={clip.url || undefined}>
                <Globe size={13} strokeWidth={1.75} aria-hidden />
                <span>{host || t('shell.capture.ask.noSource')}</span>
              </dd>
            </div>
          )}
          {quote && (
            <div className="clipq__row">
              <dt className="label">{t('shell.capture.ask.text')}</dt>
              <dd>
                <blockquote className="clipq__quote">{quote}</blockquote>
              </dd>
            </div>
          )}
          {(files.length > 0 || skipped.length > 0) && (
            <div className="clipq__row">
              <dt className="label">{t('shell.capture.share.files', { n: files.length })}</dt>
              <dd>
                <ul className="clipq__files" data-testid="clip-files">
                  {files.map((f, i) => {
                    const Icon = KIND_ICON[f.kind]
                    return (
                      <li key={i} className="clipq__file" data-kind={f.kind}>
                        <Icon size={13} strokeWidth={1.75} aria-hidden />
                        <span className="clipq__fname">{f.name}</span>
                        <span className="clipq__fsize mono">{sizeLabel(f.size)}</span>
                      </li>
                    )
                  })}
                  {skipped.map((f, i) => (
                    <li key={`s${i}`} className="clipq__file" data-skipped="">
                      <File size={13} strokeWidth={1.75} aria-hidden />
                      <span className="clipq__fname">{f.name}</span>
                      <span className="clipq__fsize mono">{t(f.reason === 'size' ? 'shell.capture.share.tooBig' : 'shell.capture.share.overTotal')}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
        <div className="clipq__actions">
          <button type="submit" className="btn btn--primary" data-autofocus="">
            {t('shell.capture.ask.save')}
            <span className="kbd clipq__kbd">↵</span>
          </button>
          <button type="button" className="btn btn--ghost" onClick={onDiscard}>
            {t('shell.capture.ask.discard')}
            <span className="kbd clipq__kbd">Esc</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}

let closeOpen: (() => void) | null = null

/**
 * Ask about one clip; `onSave` runs only when the user saves it, `onDiscard` when it is dismissed (or replaced).
 * A newer clip replaces an open question.
 */
export function openClipConfirm(clip: Clip, onSave: () => void, opts: { share?: ShareInfo; onDiscard?: () => void } = {}): void {
  closeOpen?.()
  const host = document.createElement('div')
  host.setAttribute('data-clip-confirm-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  let done = false
  const close = (saved = false) => {
    if (done) return
    done = true
    if (!saved) opts.onDiscard?.()
    if (closeOpen === close) closeOpen = null
    // never unmount a root from inside its own event handler
    window.setTimeout(() => {
      root.unmount()
      host.remove()
    }, 0)
  }
  closeOpen = close
  root.render(
    <ClipConfirm
      clip={clip}
      share={opts.share}
      onSave={() => {
        if (done) return
        close(true)
        onSave()
      }}
      onDiscard={() => close()}
    />,
  )
}
