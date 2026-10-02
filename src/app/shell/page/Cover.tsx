import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Move } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useFileUrl } from '../../lib/files'
import { colorBg } from '../../lib/colors'
import { useT } from '../../i18n'
import type { Page, PageCover } from '../../store/types'
import { CoverPicker } from './CoverPicker'
import { useIsTouch } from '../lib/hooks'

export function Cover({ page, editable }: { page: Page; editable: boolean }) {
  const t = useT()
  const cover = page.cover
  const src = useFileUrl(cover?.type === 'image' ? cover.value : null)
  const [pickerAnchor, setPickerAnchor] = useState<Element | null>(null)
  const [repos, setRepos] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // touch: the controls stay out of the picture until the cover is tapped
  const touch = useIsTouch()
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed || pickerAnchor || repos !== null) return
    const id = window.setTimeout(() => setArmed(false), 5000)
    return () => window.clearTimeout(id)
  }, [armed, pickerAnchor, repos])
  if (!cover) return null

  const pick = (c: PageCover) => useWorkspace.getState().updatePage(page.id, { cover: c })
  const posY = repos ?? cover.positionY ?? 50

  const onPointerDown = (e: React.PointerEvent) => {
    if (repos === null || !boxRef.current || !imgRef.current) return
    e.preventDefault()
    const box = boxRef.current.getBoundingClientRect()
    const img = imgRef.current
    const rendered = img.naturalWidth ? (img.naturalHeight * box.width) / img.naturalWidth : box.height
    const range = Math.max(1, rendered - box.height)
    const startY = e.clientY
    const start = repos
    const move = (ev: PointerEvent) => setRepos(Math.min(100, Math.max(0, start - ((ev.clientY - startY) / range) * 100)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  let bg: React.CSSProperties | undefined
  if (cover.type === 'gradient') bg = { background: cover.value }
  if (cover.type === 'color') bg = { background: colorBg(cover.value) }

  return (
    <div
      ref={boxRef}
      className="pv-cover"
      data-repos={repos !== null || undefined}
      data-armed={(touch && armed) || undefined}
      style={bg}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        if (!touch || !editable || repos !== null) return
        if ((e.target as Element).closest('button')) return
        setArmed((a) => !a)
      }}
    >
      {cover.type === 'image' && src && (
        <img ref={imgRef} src={src} alt="" draggable={false} style={{ objectPosition: `center ${posY}%` }} />
      )}
      {repos !== null && <div className="pv-cover__hint label">{t('shell.cover.dragHint')}</div>}
      {editable && touch && !armed && repos === null && (
        <button type="button" className="pv-cover__arm" aria-label={t('shell.cover.edit')} onClick={() => setArmed(true)}>
          <ImageIcon size={14} />
        </button>
      )}
      {editable && (
        <div className="pv-cover__ctrls">
          {repos !== null ? (
            <>
              <button
                type="button"
                className="pv-cover__btn pv-cover__btn--primary"
                onClick={() => {
                  useWorkspace.getState().updatePage(page.id, { cover: { ...cover, positionY: Math.round(repos) } as PageCover })
                  setRepos(null)
                  setArmed(false)
                }}
              >
                {t('shell.cover.savePosition')}
              </button>
              <button type="button" className="pv-cover__btn" onClick={() => (setRepos(null), setArmed(false))}>
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="pv-cover__btn" onClick={(e) => setPickerAnchor(pickerAnchor ? null : e.currentTarget)}>
                <ImageIcon size={13} />
                {t('shell.cover.change')}
              </button>
              {cover.type === 'image' && (
                <button type="button" className="pv-cover__btn" onClick={() => setRepos(cover.positionY ?? 50)}>
                  <Move size={13} />
                  {t('shell.cover.reposition')}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <CoverPicker
        anchor={pickerAnchor}
        hasCover
        onClose={() => setPickerAnchor(null)}
        onPick={(c) => {
          pick(c)
        }}
        onRemove={() => {
          setPickerAnchor(null)
          useWorkspace.getState().updatePage(page.id, { cover: null })
        }}
      />
    </div>
  )
}
