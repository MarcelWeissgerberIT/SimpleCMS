/** Settings → Data: the "Clip to One" bookmarklet (drag to the bookmarks bar) + share-target hint. */
import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import { ArrowRight, Copy, GripVertical, Scissors, Smartphone } from 'lucide-react'
import { toast } from '../../store/ui'
import { useT } from '../../i18n'
import { bookmarkletHref } from './inbox'
import './capture.css'

export function WebClipper() {
  const t = useT()
  const titleId = useId()
  const keyRef = useRef<HTMLAnchorElement>(null)
  const href = useMemo(() => bookmarkletHref(), [])
  // React refuses to render javascript: URLs, so the bookmarklet is set on the element directly
  useLayoutEffect(() => {
    keyRef.current?.setAttribute('href', href)
  }, [href])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href)
      toast({ message: t('shell.clipper.copied'), kind: 'success' })
    } catch {
      toast({ message: t('shell.clipper.copyFailed'), kind: 'error' })
    }
  }

  return (
    <section className="clipper" aria-labelledby={titleId}>
      <div className="clipper__head">
        <h4 className="clipper__title" id={titleId}>
          {t('shell.clipper.title')}
        </h4>
        <span className="clipper__rule" aria-hidden />
        <span className="label">{t('shell.clipper.spec')}</span>
      </div>
      <p className="clipper__body">{t('shell.clipper.body')}</p>
      <div className="clipper__rig">
        <a
          ref={keyRef}
          className="clipper__key"
          data-bookmarklet=""
          title={t('shell.clipper.drag')}
          onClick={(e) => {
            // here it would clip One itself — the key is meant for the bookmarks bar
            e.preventDefault()
            toast(t('shell.clipper.dragHint'))
          }}
        >
          <GripVertical size={14} strokeWidth={1.75} className="clipper__grip" aria-hidden />
          <Scissors size={14} strokeWidth={1.75} aria-hidden />
          {t('shell.clipper.button')}
        </a>
        <ArrowRight size={16} strokeWidth={1.6} className="clipper__arrow" aria-hidden />
        <span className="clipper__bar" aria-hidden>
          <span className="clipper__dot" />
          <span className="clipper__dot" />
          <span className="clipper__slot">{t('shell.clipper.drag')}</span>
        </span>
      </div>
      <div className="clipper__foot">
        <button type="button" className="btn btn--sm" onClick={() => void copy()}>
          <Copy size={13} strokeWidth={1.75} aria-hidden />
          {t('shell.clipper.copy')}
        </button>
        <span className="clipper__hint">
          <Smartphone size={13} strokeWidth={1.75} aria-hidden />
          {t('shell.clipper.android')}
        </span>
      </div>
    </section>
  )
}
