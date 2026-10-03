/** Small pieces of the meeting deck: keys, title field, transcript list, paste panel, notices. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatOffset, transcriptWords, type TranscriptSegment } from '../../../editor'
import { useLang, useT } from '../../../i18n'
import { parseTranscript } from './transcript'

/* ------------------------------------------------------------------ */
/* Transport key                                                       */
/* ------------------------------------------------------------------ */

export function Key({
  variant,
  big,
  latched,
  led,
  icon,
  label,
  title,
  disabled,
  onClick,
  testId,
}: {
  variant: 'rec' | 'ink' | 'ghost'
  /** the large standby REC key */
  big?: boolean
  /** pressed-in state (a latching tape-deck key) */
  latched?: boolean
  /** LED in the cap: 'pulse' only while recording */
  led?: 'off' | 'on' | 'pulse' | 'blink'
  icon?: ReactNode
  label: string
  title?: string
  disabled?: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      className={`mtg-key mtg-key--${variant}${big ? ' mtg-key--big' : ''}`}
      aria-pressed={latched === undefined ? undefined : latched}
      data-latched={latched ? '' : undefined}
      title={title}
      disabled={disabled}
      data-meeting-key={testId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {led && <span className={`mtg-key__led is-${led}`} aria-hidden />}
      {icon}
      <span className="mtg-key__label">{label}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

export function TitleField({ value, editable, onCommit }: { value: string; editable: boolean; onCommit: (v: string) => void }) {
  const t = useT()
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  if (!editable) return value ? <div className="mtg__title">{value}</div> : null
  const commit = () => {
    const v = draft.replace(/\s+/g, ' ').trim()
    if (v !== value) onCommit(v)
  }
  return (
    <input
      className="mtg__title mtg__title--input"
      value={draft}
      placeholder={t('features.meeting.titlePlaceholder')}
      aria-label={t('features.meeting.titleLabel')}
      spellCheck={false}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Transcript                                                          */
/* ------------------------------------------------------------------ */

export function wordsLabel(t: ReturnType<typeof useT>, n: number, lang: string): string {
  return n === 1 ? t('features.meeting.oneWord') : t('features.meeting.words', { n: n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US') })
}

export function TranscriptPanel({
  segments,
  interim,
  live,
  open,
  onToggle,
  liveAt,
}: {
  segments: TranscriptSegment[]
  interim: string
  /** listening right now: an empty list shows the "listening" hint */
  live: boolean
  open: boolean
  onToggle: () => void
  /** offset of the phrase being spoken */
  liveAt: number
}) {
  const t = useT()
  const lang = useLang()
  const list = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
  const words = transcriptWords(segments)
  // follow the newest line while the reader is at the bottom
  useLayoutEffect(() => {
    const el = list.current
    if (el && open && stick.current) el.scrollTop = el.scrollHeight
  }, [segments.length, interim, open])
  if (!segments.length && !live && !interim) return null
  return (
    <section className={`mtg__tx${open ? ' is-open' : ''}`} aria-label={t('features.meeting.transcript')}>
      <button type="button" className="mtg__tx-toggle" aria-expanded={open} title={t('features.meeting.transcriptToggle')} onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
        <ChevronRight className="mtg__tx-chev" size={13} strokeWidth={2} aria-hidden />
        <span className="label">
          {t('features.meeting.transcript')} · {wordsLabel(t, words, lang)}
        </span>
      </button>
      {open && (
        <ol
          ref={list}
          className="mtg__tx-list"
          aria-live={live ? 'polite' : undefined}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
        >
          {segments.map((s, i) => (
            <li key={i} className="mtg__line">
              <time className="mtg__time">{formatOffset(s.t)}</time>
              <span className="mtg__text">{s.text}</span>
            </li>
          ))}
          {(interim || (live && !segments.length)) && (
            <li className="mtg__line is-interim" aria-hidden>
              <time className="mtg__time">{formatOffset(liveAt)}</time>
              <span className="mtg__text">
                {interim || t('features.meeting.transcriptEmpty')}
                {live && <span className="mtg__caret" aria-hidden />}
              </span>
            </li>
          )}
        </ol>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Paste a transcript                                                  */
/* ------------------------------------------------------------------ */

export function PastePanel({ onUse, onCancel }: { onUse: (segments: TranscriptSegment[]) => void; onCancel?: () => void }) {
  const t = useT()
  const [text, setText] = useState('')
  const [empty, setEmpty] = useState(false)
  const use = () => {
    const segs = parseTranscript(text)
    if (!segs.length) return setEmpty(true)
    onUse(segs)
    setText('')
  }
  return (
    <div className="mtg__paste">
      <textarea
        className="input mtg__paste-text"
        rows={5}
        value={text}
        spellCheck={false}
        aria-label={t('features.meeting.pasteLabel')}
        placeholder={t('features.meeting.pastePlaceholder')}
        aria-invalid={empty || undefined}
        onChange={(e) => {
          setText(e.target.value)
          setEmpty(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            use()
          }
        }}
      />
      {empty && (
        <p className="mtg__paste-err" role="alert">
          {t('features.meeting.pasteEmpty')}
        </p>
      )}
      <div className="mtg__paste-keys">
        <button type="button" className="btn btn--sm btn--ink" disabled={!text.trim()} onClick={use}>
          {t('features.meeting.pasteUse')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
            {t('features.meeting.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Notices (speech / Claude errors)                                    */
/* ------------------------------------------------------------------ */

export function Notice({ code, title, children, actions }: { code: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mtg__notice" role="alert" data-code={code}>
      <span className="mtg__notice-code label">ERR · {code.toUpperCase()}</span>
      <div className="mtg__notice-body">
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
      {actions && <div className="mtg__notice-keys">{actions}</div>}
    </div>
  )
}
