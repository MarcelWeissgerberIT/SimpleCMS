/**
 * "Save to Inbox?" — shown for a web clip that did not come with this device's clip token
 * (share target, older bookmarklets, links from other sites). It shows what would be saved
 * (title, source host, a preview of the selection) and saves only on "Save to Inbox".
 * Mounted on demand in its own root (the #/clip route is already replaced by then).
 */
import { useId } from 'react'
import { createRoot } from 'react-dom/client'
import { Globe, Inbox } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import type { Clip } from './inbox'
import './capture.css'

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

export function ClipConfirm({ clip, onSave, onDiscard }: { clip: Clip; onSave: () => void; onDiscard: () => void }) {
  const t = useT()
  const id = useId()
  const host = hostOf(clip.url)
  const quote = clip.text ? preview(clip.text) : ''
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
            <span className="led led--on" aria-hidden /> {t('shell.capture.ask.label')}
          </span>
          <span className="label clipq__dest">
            <Inbox size={12} strokeWidth={1.75} aria-hidden /> {t('shell.capture.inbox')}
          </span>
        </div>
        <h2 className="clipq__title">{t('shell.capture.ask.title')}</h2>
        <p className="clipq__why" id={`${id}-why`}>
          {t('shell.capture.ask.why')}
        </p>
        <dl className="clipq__spec">
          <div className="clipq__row">
            <dt className="label">{t('shell.capture.ask.page')}</dt>
            <dd className="clipq__page">{clip.title}</dd>
          </div>
          <div className="clipq__row">
            <dt className="label">{t('shell.capture.ask.source')}</dt>
            <dd className="clipq__host mono" title={clip.url || undefined}>
              <Globe size={13} strokeWidth={1.75} aria-hidden />
              <span>{host || t('shell.capture.ask.noSource')}</span>
            </dd>
          </div>
          {quote && (
            <div className="clipq__row">
              <dt className="label">{t('shell.capture.ask.text')}</dt>
              <dd>
                <blockquote className="clipq__quote">{quote}</blockquote>
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

/** Ask about one clip; `onSave` runs only when the user saves it. A newer clip replaces an open question. */
export function openClipConfirm(clip: Clip, onSave: () => void): void {
  closeOpen?.()
  const host = document.createElement('div')
  host.setAttribute('data-clip-confirm-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  let done = false
  const close = () => {
    if (done) return
    done = true
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
      onSave={() => {
        if (done) return
        close()
        onSave()
      }}
      onDiscard={close}
    />,
  )
}
