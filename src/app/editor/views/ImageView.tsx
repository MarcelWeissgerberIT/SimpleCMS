import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { AlignCenter, AlignLeft, AlignRight, Captions, Download, ExternalLink, ImagePlus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { FILE_PREFIX, getFile, saveFile, useFileUrl } from '../../lib/files'
import { useT } from '../../i18n'
import { pickFiles } from '../lib/upload'
import { isUrl } from '../lib/embeds'
import { caretAfterNode, leaveNodeView } from '../lib/blocks'
import { ImageAIKey } from './ImageAIKey'

const MIN_W = 80
/** Stored types that are safe to open in a tab: a blob: URL is same-origin, so an opened SVG/HTML could run script. */
const VIEWABLE = /^image\/(png|jpeg|gif|webp|avif)$/i

/**
 * How "original" may be shown: local files open in a tab only when they are raster images,
 * everything else (SVG, unknown or missing type, inline data:) is downloaded, never navigated to.
 */
function useOriginal(src: string | null): { open: boolean; name: string } {
  const local = !!src && (src.startsWith(FILE_PREFIX) || /^data:/i.test(src))
  const [stored, setStored] = useState<{ src: string; open: boolean; name: string } | null>(null)
  useEffect(() => {
    if (!src?.startsWith(FILE_PREFIX)) return
    let alive = true
    getFile(src)
      .then((f) => alive && setStored({ src, open: !!f && VIEWABLE.test(f.blob.type), name: f?.name || 'image' }))
      .catch(() => alive && setStored({ src, open: false, name: 'image' }))
    return () => {
      alive = false
    }
  }, [src])
  if (!local) return { open: true, name: '' }
  if (stored && stored.src === src) return { open: stored.open, name: stored.name }
  const ext = src.match(/^data:image\/([a-z]+)/i)?.[1]?.toLowerCase()
  return { open: false, name: ext ? `image.${ext}` : 'image' }
}

export function ImageView({ node, updateAttributes, deleteNode, selected, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const { src, alt, caption, width, align } = node.attrs as { src: string | null; alt: string | null; caption: string; width: number | null; align: string }
  const url = useFileUrl(src)
  const original = useOriginal(src)
  const figRef = useRef<HTMLElement>(null)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [showCaption, setShowCaption] = useState(!!caption)
  const [linkValue, setLinkValue] = useState('')
  const [error, setError] = useState(false)
  const captionRef = useRef<HTMLInputElement>(null)
  const editable = editor.isEditable

  useEffect(() => setShowCaption(!!caption || showCaption), [caption]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    const [file] = await pickFiles('image/*')
    if (!file) return
    const ref = await saveFile(file, file.name)
    const fresh = !src
    updateAttributes({ src: ref, alt: alt || file.name.replace(/\.[a-z0-9]+$/i, '') })
    // a fresh upload: back to the document (a free line below, else the image block-selected)
    if (fresh) leaveNodeView(editor, getPos(), 'escape')
  }

  if (!src) {
    return (
      <NodeViewWrapper className={`media-empty${selected ? ' is-selected' : ''}`} data-type="image" contentEditable={false}>
        <div className="media-empty__head">
          <ImagePlus size={16} strokeWidth={1.7} />
          <span className="label">{t('editor.image.empty')}</span>
        </div>
        {editable && (
          <div className="media-empty__body">
            <button type="button" className="btn btn--sm" onClick={upload}>
              <Upload size={13} /> {t('editor.image.upload')}
            </button>
            <span className="media-empty__or label">{t('editor.or')}</span>
            <form
              className="media-empty__form"
              onSubmit={(e) => {
                e.preventDefault()
                if (isUrl(linkValue) || /^data:image\//.test(linkValue)) {
                  updateAttributes({ src: linkValue.trim() })
                  caretAfterNode(editor, getPos(), { newLine: true })
                }
              }}
            >
              <input
                className="input"
                placeholder={t('editor.image.linkPlaceholder')}
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                autoFocus={selected}
              />
              <button type="submit" className="btn btn--sm btn--ink" disabled={!linkValue.trim()}>
                {t('editor.media.add')}
              </button>
            </form>
          </div>
        )}
      </NodeViewWrapper>
    )
  }

  const startResize = (side: 'left' | 'right') => (e: RPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const fig = figRef.current
    if (!fig) return
    const container = fig.parentElement?.parentElement ?? fig.parentElement
    const maxW = container?.clientWidth ?? 9999
    const startX = e.clientX
    const startW = fig.getBoundingClientRect().width
    const factor = align === 'center' || !align ? 2 : 1
    let w = startW
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * (side === 'right' ? 1 : -1) * factor
      w = Math.round(Math.max(MIN_W, Math.min(maxW, startW + dx)))
      setLiveWidth(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLiveWidth(null)
      updateAttributes({ width: w >= maxW - 2 ? null : w })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const w = liveWidth ?? width
  const hasCaption = !!caption || showCaption
  return (
    <NodeViewWrapper
      as="figure"
      ref={figRef}
      className={`image image-view${hasCaption && caption ? ' has-caption' : ''}${selected ? ' is-selected' : ''}`}
      data-type="image"
      data-align={align || 'center'}
      data-sized={w ? '' : undefined}
      style={{ width: w ? `${w}px` : undefined }}
      contentEditable={false}
    >
      <div className="image-view__frame" data-drag-handle="">
        {error ? (
          <div className="image-view__error label">{t('editor.image.broken')}</div>
        ) : (
          <img src={url || undefined} alt={alt ?? ''} draggable={false} onError={() => setError(true)} onLoad={() => setError(false)} />
        )}
        {editable && (
          <>
            <span className="image-view__handle image-view__handle--left" onPointerDown={startResize('left')} aria-hidden />
            <span className="image-view__handle image-view__handle--right" onPointerDown={startResize('right')} aria-hidden />
            <div className="image-view__tools" role="toolbar" aria-label={t('editor.image.tools')}>
              {/* Claude for images: describe, read out the text, image → table, ask */}
              <ImageAIKey editor={editor} getPos={getPos} />
              <span className="image-view__sep" />
              {(['left', 'center', 'right'] as const).map((a) => {
                const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
                return (
                  <button key={a} type="button" className="icon-btn icon-btn--sm" aria-pressed={(align || 'center') === a} title={t(`editor.align.${a}`)} onClick={() => updateAttributes({ align: a })}>
                    <Icon size={13} />
                  </button>
                )
              })}
              <span className="image-view__sep" />
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-pressed={hasCaption}
                title={t('editor.image.caption')}
                onClick={() => {
                  setShowCaption(true)
                  requestAnimationFrame(() => captionRef.current?.focus())
                }}
              >
                <Captions size={13} />
              </button>
              <button type="button" className="icon-btn icon-btn--sm" title={t('editor.image.replace')} onClick={upload}>
                <RefreshCw size={13} />
              </button>
              {url &&
                (original.open ? (
                  <a className="icon-btn icon-btn--sm" href={url} target="_blank" rel="noreferrer" title={t('editor.image.original')}>
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <a className="icon-btn icon-btn--sm" href={url} download={original.name} title={t('editor.image.download')}>
                    <Download size={13} />
                  </a>
                ))}
              <button type="button" className="icon-btn icon-btn--sm" title={t('common.delete')} onClick={() => deleteNode()}>
                <Trash2 size={13} />
              </button>
            </div>
          </>
        )}
      </div>
      {hasCaption && (editable || caption) && (
        <figcaption>
          {editable ? (
            <input
              ref={captionRef}
              className="image-view__caption"
              value={caption ?? ''}
              placeholder={t('editor.image.captionPlaceholder')}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              onBlur={() => !caption && setShowCaption(false)}
              onKeyDown={(e) => {
                // leave the caption with a text caret below the image — never with the image
                // selected, where the next keystroke would act on the image
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  leaveNodeView(editor, getPos(), e.key === 'Enter' ? 'enter' : 'escape')
                }
              }}
            />
          ) : (
            caption
          )}
        </figcaption>
      )}
    </NodeViewWrapper>
  )
}
