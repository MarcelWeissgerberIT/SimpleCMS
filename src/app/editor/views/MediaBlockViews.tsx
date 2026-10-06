/**
 * Video + audio blocks (schema: ../schema/media.ts). One instrument-style frame for both:
 * a bar with LED, kind, file name, duration · size and the block's tools, then the player —
 * the native <video controls> for video, a keycap transport for audio. Never autoplays.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { AlignCenter, AlignLeft, AlignRight, AudioLines, Captions, Download, Film, Link2, Pause, Play, RefreshCw, Trash2, Upload, type LucideIcon } from 'lucide-react'
import { FILE_PREFIX, getFile, useFileUrl } from '../../lib/files'
import { useT } from '../../i18n'
import { detectProvider, domainOf, parseUrl } from '../lib/embeds'
import { caretAfterNode, leaveNodeView } from '../lib/blocks'
import { copyMediaLink, pickMediaFile, usePendingSave, type PendingSave } from '../lib/mediaSave'
import { mediaNameFromUrl, safeMediaSrc, type MediaKind } from '../schema/media'
import { formatBytes } from './MediaViews'
import './media.css'
import { useFocusWhenShown } from '../../ui/focus'

const MIN_W = 200
const ICON: Record<MediaKind, LucideIcon> = { video: Film, audio: AudioLines }
/** Links that play in an embed, not in a media element. */
const EMBED_PROVIDERS = new Set(['youtube', 'vimeo', 'loom'])
const RATES = [1, 1.5, 2, 0.75]

/** "00:42", "12:05", "1:02:03" — positions count down to the second, lengths round to the nearest one. */
export function formatTime(s: number, round = false): string {
  if (!Number.isFinite(s) || s < 0) return '--:--'
  const total = round ? Math.round(s) : Math.floor(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

/** Size of a local file (null for links / while loading); missing: the file isn't on this device. */
function useLocalFile(src: string | null): { size: number | null; missing: boolean } {
  const [info, setInfo] = useState<{ src: string; size: number | null; missing: boolean } | null>(null)
  useEffect(() => {
    if (!src?.startsWith(FILE_PREFIX)) return
    let alive = true
    getFile(src)
      .then((f) => alive && setInfo({ src, size: f ? f.size : null, missing: !f }))
      .catch(() => alive && setInfo({ src, size: null, missing: true }))
    return () => {
      alive = false
    }
  }, [src])
  return info && info.src === src ? info : { size: null, missing: false }
}

interface MediaState {
  duration: number
  current: number
  playing: boolean
  error: boolean
}

/** Live state of a media element (duration, position, playing, load error). */
function useMediaState(el: HTMLMediaElement | null, url: string): MediaState {
  const [st, setSt] = useState<MediaState>({ duration: NaN, current: 0, playing: false, error: false })
  useEffect(() => {
    setSt({ duration: NaN, current: 0, playing: false, error: false })
    if (!el) return
    const read = () => setSt({ duration: el.duration, current: el.currentTime, playing: !el.paused && !el.ended, error: !!el.error })
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'error', 'emptied', 'seeked']
    events.forEach((e) => el.addEventListener(e, read))
    read()
    return () => events.forEach((e) => el.removeEventListener(e, read))
  }, [el, url])
  return st
}

/** Leave the toolbar for the block itself (selected, keyboard back in the editor). */
function selectBlock(editor: Editor, pos: number | undefined) {
  if (typeof pos !== 'number' || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
  editor.view.focus()
}

/* ------------------------------------------------------------------ */
/* Empty block: upload or link                                         */
/* ------------------------------------------------------------------ */

function SavingPlate({ save }: { save: PendingSave }) {
  const t = useT()
  return (
    <div className="media-saving" role="status" aria-live="polite">
      <span className="led led--on" aria-hidden />
      <span className="label">{t('editor.media.saving')}</span>
      <span className="media-saving__name">{save.name}</span>
      <span className="label">{formatBytes(save.size)}</span>
      <span className="media-saving__bar" aria-hidden />
    </div>
  )
}

function EmptyMedia({ kind, props, busy, upload }: { kind: MediaKind; props: ReactNodeViewProps; busy: PendingSave | null; upload: () => void }) {
  const t = useT()
  const { node, updateAttributes, selected, editor, getPos } = props
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const Icon = ICON[kind]

  const submit = () => {
    const u = parseUrl(value)
    const provider = detectProvider(value)
    const pos = getPos()
    // YouTube, Vimeo, Loom … keep going to the embed block
    if (u && provider && EMBED_PROVIDERS.has(provider) && typeof pos === 'number') {
      editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'embed', attrs: { url: u.toString(), provider } }).run()
      return
    }
    const src = safeMediaSrc(u?.toString())
    if (!src) return setError(t('editor.media.invalid'))
    updateAttributes({ src, name: mediaNameFromUrl(src) })
    caretAfterNode(editor, getPos(), { newLine: true })
  }

  return (
    <NodeViewWrapper className={`media-empty${selected ? ' is-selected' : ''}`} data-type={kind} contentEditable={false}>
      <div className="media-empty__head">
        <Icon size={16} strokeWidth={1.7} />
        <span className="label">{busy ? t(`editor.block.${kind}`) : t(`editor.${kind}.empty`)}</span>
      </div>
      {busy ? (
        <SavingPlate save={busy} />
      ) : (
        editor.isEditable && (
          <>
            <div className="media-empty__body">
              <button type="button" className="btn btn--sm" onClick={upload}>
                <Upload size={13} /> {t('editor.media.upload')}
              </button>
              <span className="media-empty__or label">{t('editor.or')}</span>
              <form
                className="media-empty__form"
                onSubmit={(e) => {
                  e.preventDefault()
                  submit()
                }}
              >
                <input
                  className="input"
                  value={value}
                  placeholder={t(`editor.${kind}.linkPlaceholder`)}
                  aria-label={t(`editor.${kind}.linkPlaceholder`)}
                  aria-invalid={!!error}
                  autoFocus={selected}
                  onChange={(e) => {
                    setValue(e.target.value)
                    setError(null)
                  }}
                />
                <button type="submit" className="btn btn--sm btn--ink" disabled={!value.trim()}>
                  {t('editor.media.add')}
                </button>
              </form>
            </div>
            <div className={`media-empty__hint${error ? ' is-error' : ''}`}>{error ?? t(`editor.${kind}.hint`, { max: 200 })}</div>
          </>
        )
      )}
    </NodeViewWrapper>
  )
}

/* ------------------------------------------------------------------ */
/* The bar: LED · KIND · name · meta · tools                           */
/* ------------------------------------------------------------------ */

function MediaBar({
  kind,
  props,
  src,
  url,
  state,
  size,
  showCaption,
  onCaption,
  onReplace,
}: {
  kind: MediaKind
  props: ReactNodeViewProps
  src: string
  url: string
  state: MediaState
  size: number | null
  showCaption: boolean
  onCaption: () => void
  onReplace: () => void
}) {
  const t = useT()
  const { node, updateAttributes, deleteNode, editor, getPos } = props
  const name = String(node.attrs.name || '') || (src.startsWith(FILE_PREFIX) ? t(`editor.block.${kind}`) : mediaNameFromUrl(src))
  const local = src.startsWith(FILE_PREFIX)
  const align = String(node.attrs.align || 'center')
  const length = Number.isFinite(state.duration) ? formatTime(state.duration, true) : null
  // local files: their size; links: where they come from (left out on a phone-width bar)
  const origin = local ? (size !== null ? formatBytes(size) : null) : domainOf(src)

  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    selectBlock(editor, getPos())
  }

  return (
    <div className="media-view__bar">
      <span className={`led${state.playing ? ' led--on' : ''}`} aria-hidden />
      <span className="label media-view__kind">{t(`editor.block.${kind}`)}</span>
      <span className="media-view__name" title={name}>
        {name}
      </span>
      {(length || origin) && (
        <span className="media-view__meta">
          {length}
          {origin && (
            <span className={local ? undefined : 'media-view__origin'}>
              {length ? ' · ' : ''}
              {origin}
            </span>
          )}
        </span>
      )}
      {editor.isEditable && (
        <div className="media-view__tools" role="toolbar" aria-label={t('editor.media.tools')} data-media-tools="" onKeyDown={onKeyDown}>
          {kind === 'video' && (
            <span className="media-view__group">
              {(['left', 'center', 'right'] as const).map((a) => {
                const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
                return (
                  <button key={a} type="button" className="icon-btn icon-btn--sm" aria-pressed={align === a} title={t(`editor.align.${a}`)} aria-label={t(`editor.align.${a}`)} onClick={() => updateAttributes({ align: a })}>
                    <Icon size={13} />
                  </button>
                )
              })}
              <span className="media-view__sep" />
            </span>
          )}
          <button type="button" className="icon-btn icon-btn--sm" aria-pressed={showCaption} title={t('editor.image.caption')} aria-label={t('editor.image.caption')} onClick={onCaption}>
            <Captions size={13} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" title={t('editor.media.replace')} aria-label={t('editor.media.replace')} onClick={onReplace}>
            <RefreshCw size={13} />
          </button>
          {url && (
            <a
              className="icon-btn icon-btn--sm"
              href={url}
              download={local ? name : undefined}
              {...(local ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              title={t('editor.media.download')}
              aria-label={t('editor.media.download')}
            >
              <Download size={13} />
            </a>
          )}
          {!local && (
            <button type="button" className="icon-btn icon-btn--sm" title={t('editor.media.copyLink')} aria-label={t('editor.media.copyLink')} onClick={() => void copyMediaLink(src)}>
              <Link2 size={13} />
            </button>
          )}
          <button type="button" className="icon-btn icon-btn--sm" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => deleteNode()}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Audio transport: keycap play, time, scrub line, speed               */
/* ------------------------------------------------------------------ */

function Transport({ el, state, disabled }: { el: HTMLMediaElement | null; state: MediaState; disabled: boolean }) {
  const t = useT()
  const [rate, setRate] = useState(1)
  const duration = Number.isFinite(state.duration) ? state.duration : 0
  const pct = duration ? Math.min(100, (state.current / duration) * 100) : 0
  const toggle = () => {
    if (!el) return
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  }
  const nextRate = () => {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    setRate(r)
    if (el) el.playbackRate = r
  }
  return (
    <div className="media-transport">
      <button type="button" className={`media-transport__play${state.playing ? ' is-on' : ''}`} onClick={toggle} disabled={disabled} aria-label={t(state.playing ? 'editor.media.pause' : 'editor.media.play')}>
        {state.playing ? <Pause size={14} strokeWidth={2} /> : <Play size={14} strokeWidth={2} />}
      </button>
      <span className="media-transport__time">{formatTime(state.current)}</span>
      <input
        type="range"
        className="media-transport__scrub"
        min={0}
        max={duration || 1}
        step="any"
        value={Math.min(state.current, duration || 1)}
        disabled={disabled || !duration}
        aria-label={t('editor.media.seek')}
        aria-valuetext={`${formatTime(state.current)} / ${formatTime(duration, true)}`}
        style={{ '--p': `${pct}%` } as CSSProperties}
        onChange={(e) => {
          if (el) el.currentTime = Number(e.target.value)
        }}
      />
      <span className="media-transport__time media-transport__time--total">{formatTime(duration, true)}</span>
      <button type="button" className="media-transport__rate" onClick={nextRate} disabled={disabled} aria-label={t('editor.media.speed', { rate })}>
        {rate}×
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The block                                                           */
/* ------------------------------------------------------------------ */

function MediaBlock({ kind, props }: { kind: MediaKind; props: ReactNodeViewProps }) {
  const t = useT()
  const { node, updateAttributes, selected, editor, getPos } = props
  const src = safeMediaSrc(node.attrs.src)
  const url = useFileUrl(src)
  const local = useLocalFile(src)
  const busy = usePendingSave(node.attrs.id as string | null)
  const [el, setEl] = useState<HTMLMediaElement | null>(null)
  const state = useMediaState(el, url)
  const figRef = useRef<HTMLElement>(null)
  const captionRef = useRef<HTMLInputElement>(null)
  const focusCaption = useFocusWhenShown(captionRef)
  const caption = String(node.attrs.caption ?? '')
  const [showCaption, setShowCaption] = useState(!!caption)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const editable = editor.isEditable

  useEffect(() => setShowCaption(!!caption || showCaption), [caption]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const fresh = !src
    const at = await pickMediaFile(editor, pos)
    // a fresh upload: back to the document (a free line below, else the block selected)
    if (fresh && at !== null) leaveNodeView(editor, at, 'escape')
  }

  if (!src || busy) return <EmptyMedia kind={kind} props={props} busy={busy} upload={upload} />

  const startResize = (side: 'left' | 'right') => (e: RPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const fig = figRef.current
    if (!fig) return
    const container = fig.parentElement?.parentElement ?? fig.parentElement
    const maxW = container?.clientWidth ?? 9999
    const startX = e.clientX
    const startW = fig.getBoundingClientRect().width
    const align = String(node.attrs.align || 'center')
    const factor = align === 'center' ? 2 : 1
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

  const width = kind === 'video' ? (liveWidth ?? (node.attrs.width as number | null)) : null
  const hasCaption = !!caption || showCaption
  const failed = local.missing || state.error
  return (
    <NodeViewWrapper
      as="figure"
      ref={figRef}
      className={`media-view media-view--${kind}${selected ? ' is-selected' : ''}${state.playing ? ' is-playing' : ''}`}
      data-type={kind}
      data-align={kind === 'video' ? String(node.attrs.align || 'center') : undefined}
      data-sized={width ? '' : undefined}
      style={{ width: width ? `${width}px` : undefined }}
      contentEditable={false}
    >
      <div className="media-view__frame">
        <MediaBar
          kind={kind}
          props={props}
          src={src}
          url={url}
          state={state}
          size={local.size}
          showCaption={hasCaption}
          onCaption={() => {
            setShowCaption(true)
            focusCaption()
          }}
          onReplace={upload}
        />
        {kind === 'video' ? (
          <div className="media-view__stage">
            {/* stays mounted when it fails: a remount would reset the error and retry forever */}
            <video ref={setEl} src={url || undefined} controls preload="metadata" playsInline hidden={failed} aria-label={String(node.attrs.name || '') || t('editor.block.video')} />
            {failed && <div className="media-view__error label">{t(local.missing ? 'editor.media.missing' : 'editor.media.broken')}</div>}
            {editable && (
              <>
                <span className="media-view__handle media-view__handle--left" onPointerDown={startResize('left')} aria-hidden />
                <span className="media-view__handle media-view__handle--right" onPointerDown={startResize('right')} aria-hidden />
              </>
            )}
          </div>
        ) : (
          <>
            {failed ? <div className="media-view__error media-view__error--audio label">{t(local.missing ? 'editor.media.missing' : 'editor.media.broken')}</div> : <Transport el={el} state={state} disabled={!url} />}
            <audio ref={setEl} src={url || undefined} preload="metadata" />
          </>
        )}
      </div>
      {hasCaption && (editable || caption) && (
        <figcaption>
          {editable ? (
            <input
              ref={captionRef}
              className="media-view__caption"
              value={caption}
              placeholder={t('editor.image.captionPlaceholder')}
              aria-label={t('editor.image.caption')}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              onBlur={() => !caption && setShowCaption(false)}
              onKeyDown={(e) => {
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

export function VideoView(props: ReactNodeViewProps) {
  return <MediaBlock kind="video" props={props} />
}

export function AudioView(props: ReactNodeViewProps) {
  return <MediaBlock kind="audio" props={props} />
}
