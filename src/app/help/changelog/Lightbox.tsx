/**
 * A changelog picture, large: the image on the workspace's own paper (Carbon in dark), a mono plate with
 * the figure number and size, a close key. No blur, no zoom animation beyond a short fade. Esc, Enter on
 * the close key or a click anywhere closes it; focus goes back to the picture that opened it.
 * Keys pressed here stay here — the help sheet underneath neither closes nor scrolls.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '../../i18n'

export interface LightboxProps {
  src: string
  alt: string
  /** "Fig. 10 — The AI terminal" */
  caption: string
  onClose: () => void
}

export function Lightbox({ src, alt, caption, onClose }: LightboxProps) {
  const t = useT()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onClose()
      return
    }
    // one control: Tab stays on it
    if (e.key === 'Tab') {
      e.preventDefault()
      closeRef.current?.focus()
    }
  }

  return createPortal(
    <div className="cl-lightbox" role="dialog" aria-modal="true" aria-label={caption} onKeyDown={onKeyDown} onClick={onClose} data-testid="help-lightbox">
      <div className="cl-lightbox__bar">
        <span className="label cl-lightbox__cap">
          {caption}
          {size && <span className="cl-lightbox__size"> · {size[0]} × {size[1]}</span>}
        </span>
        <button ref={closeRef} type="button" className="cl-lightbox__close" onClick={onClose} aria-label={t('help.news.close')}>
          <X size={14} strokeWidth={1.75} aria-hidden />
          <kbd className="kbd" aria-hidden>
            Esc
          </kbd>
        </button>
      </div>
      <div className="cl-lightbox__stage">
        <img className="cl-lightbox__img" src={src} alt={alt} decoding="async" draggable={false} onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
      </div>
    </div>,
    document.body,
  )
}
