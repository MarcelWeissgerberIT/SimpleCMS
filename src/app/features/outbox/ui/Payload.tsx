/**
 * The slip's text exactly as it goes out: raw (never HTML, no image loads), hidden characters drawn as ⟦U+202E⟧,
 * flagged addresses marked inline with a tick box each, Markdown link targets listed in full below. Longer than
 * ~6 lines / 600 characters: clipped until "Show full text" (which counts as seen). E edits it in place (prose, not
 * code); after an edit the word diff shows Claude's draft against the person's text.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../../i18n'
import { wordRuns } from '../../history/docDiff'
import { markSeen, replaceDraft, tickAddress } from '../actions'
import { hiddenParts, linkTargets, scanAddresses } from '../seal'
import { ownOrigin } from '../provenance'
import { textMax } from '../template'
import { shortTextOf, slipText } from '../text'
import { unsent } from '../machine'
import type { SealAddress, Slip } from '../types'

/** The text cut into plain runs, hidden code points and flagged addresses. */
function Segments({ text, flags, slip }: { text: string; flags: SealAddress[]; slip: Slip }) {
  const t = useT()
  const found = scanAddresses(text, ownOrigin())
  const marks: Array<{ at: number; end: number; flag: SealAddress }> = []
  for (const a of found) {
    const flag = flags.find((f) => f.norm === a.norm)
    if (flag) marks.push({ at: a.at, end: a.at + a.text.length, flag })
  }
  const out: ReactNode[] = []
  let at = 0
  let k = 0
  const plain = (s: string) => {
    for (const p of hiddenParts(s))
      out.push(
        'hidden' in p ? (
          <span key={k++} className="obx-hidden" title={t('features.outbox.text.hiddenTitle', { code: p.hidden })}>
            ⟦{p.hidden}⟧
          </span>
        ) : (
          <span key={k++}>{p.text}</span>
        ),
      )
  }
  const shown = new Set<string>()
  for (const m of marks) {
    if (m.at < at) continue
    plain(text.slice(at, m.at))
    const reason = m.flag.only === 'foreign' ? t('features.outbox.addr.foreign', { source: m.flag.source ?? '' }) : m.flag.only === 'internal' ? t('features.outbox.addr.internal') : t('features.outbox.addr.nowhere')
    const first = !shown.has(m.flag.norm)
    shown.add(m.flag.norm)
    out.push(
      <span key={k++} className="obx-addr" data-only={m.flag.only} data-ticked={m.flag.ticked || undefined} title={reason}>
        {text.slice(m.at, m.end)}
        {first && <Tick slip={slip} flag={m.flag} label={`${t('features.outbox.addr.tick', { address: m.flag.text })} — ${reason}`} />}
      </span>,
    )
    at = m.end
  }
  plain(text.slice(at))
  return <>{out}</>
}

/** The tick of a flagged address: shown at once, stored right after (one compare-and-set). */
function Tick({ slip, flag, label }: { slip: Slip; flag: SealAddress; label: string }) {
  const [on, setOn] = useState(flag.ticked)
  useEffect(() => setOn(flag.ticked), [flag.ticked])
  return (
    <label className="obx-addr__tick">
      <input
        type="checkbox"
        checked={on}
        disabled={!unsent(slip.state)}
        aria-label={label}
        onChange={(e) => {
          setOn(e.target.checked)
          void tickAddress(slip.id, flag.norm, e.target.checked)
        }}
      />
    </label>
  )
}

export function Payload({ slip, editing, onEditing }: { slip: Slip; editing: boolean; onEditing: (on: boolean) => void }) {
  const t = useT()
  const text = slipText(slip)
  const rev = slip.draft?.rev ?? 0
  const seen = !!slip.draft && slip.draft.seenRev === slip.draft.rev
  const short = shortTextOf(text)
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [rev])
  const clipped = !short && !open && !seen

  if (!slip.draft) return null
  if (editing || slip.state === 'missing') return <Editor slip={slip} text={text} onDone={() => onEditing(false)} autoFocus={editing} />
  const links = linkTargets(text)
  const diff = slip.draft.by === 'person' && slip.draft.claudeText !== undefined && slip.draft.claudeText !== text
  return (
    <div className="obx-payload">
      <div className="obx-payload__text" data-clipped={clipped || undefined} aria-label={t('features.outbox.text.label')} data-testid="outbox-text">
        <Segments text={text} flags={slip.seal.addresses} slip={slip} />
      </div>
      {clipped && (
        <button
          type="button"
          className="btn btn--sm obx-payload__more"
          data-testid="outbox-show-full"
          onClick={() => {
            setOpen(true)
            void markSeen(slip.id, rev)
          }}
        >
          {t('features.outbox.text.show', { n: [...text].length })}
        </button>
      )}
      {links.length > 0 && (
        <div className="obx-payload__links">
          <span className="label">{t('features.outbox.text.links')}</span>
          {links.map((l) => (
            <code key={l} className="obx-payload__link">
              {l}
            </code>
          ))}
        </div>
      )}
      {diff && (
        <div className="obx-payload__diff" aria-label={t('features.outbox.text.diff')}>
          <span className="label">{t('features.outbox.text.diff')}</span>
          <p className="obx-diff">
            {wordRuns(slip.draft.claudeText ?? '', text).map((r, i) =>
              r.op === 'same' ? (
                <span key={i}>{r.text}</span>
              ) : r.op === 'del' ? (
                <del key={i} className="obx-diff__del">
                  {r.text}
                </del>
              ) : (
                <ins key={i} className="obx-diff__add">
                  {r.text}
                </ins>
              ),
            )}
          </p>
        </div>
      )}
    </div>
  )
}

function Editor({ slip, text, onDone, autoFocus }: { slip: Slip; text: string; onDone: () => void; autoFocus: boolean }) {
  const t = useT()
  const [value, setValue] = useState(text)
  const ref = useRef<HTMLTextAreaElement>(null)
  const max = textMax(slip.route.snapshot.params?.find((p) => p.type === 'text') ?? null)
  const over = [...value].length > max
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  const save = async () => {
    if (over || !value.trim()) return
    if (await replaceDraft(slip.id, value, 'person')) onDone()
  }
  return (
    <div className="obx-payload obx-payload--edit">
      <label className="label" htmlFor={`obx-ed-${slip.id}`}>
        {slip.state === 'missing' ? t('features.outbox.text.missing') : t('features.outbox.text.editLabel')}
      </label>
      <textarea
        id={`obx-ed-${slip.id}`}
        ref={ref}
        className="input obx-payload__ta"
        rows={Math.min(12, Math.max(4, value.split('\n').length + 1))}
        value={value}
        aria-invalid={over || undefined}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape' && slip.state !== 'missing') {
            e.preventDefault()
            e.stopPropagation()
            onDone()
          }
        }}
      />
      <div className="obx-payload__edkeys">
        {over && (
          <span className="obx-payload__over" role="alert">
            {t('features.outbox.text.tooLong', { n: max })}
          </span>
        )}
        <span className="obx-sp" />
        {slip.state !== 'missing' && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onDone}>
            {t('features.outbox.text.cancel')}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ink" disabled={over || !value.trim()} onClick={() => void save()} data-testid="outbox-save-text">
          {t('features.outbox.text.save')}
        </button>
      </div>
    </div>
  )
}
