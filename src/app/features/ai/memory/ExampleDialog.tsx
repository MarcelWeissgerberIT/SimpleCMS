/**
 * "Save as example in memory" (page ⋯ menu, /example <tag> in the AI terminal, "Remember as example…" on a
 * selection): Tag (from the title, a–z 0–9 -, unique among active examples — a taken one offers to replace
 * it), what it is for, topics. Saving asks Claude for the pattern (example.ts) — Enter saves, Esc cancels.
 */
import { useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { Modal } from '../../../ui/Modal'
import { Switch } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { useContextMarks } from '../../../editor'
import { AIError } from '../client'
import { ExampleError, exampleByTag, saveExample, slugTag, suggestTag, TAG_RE } from './example'
import { openEntry } from './open'
import './memory.css'

/** Light clean-up while typing (the final slug is made on save). */
const typing = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9äöüß-]/g, '')
    .slice(0, 32)

export function ExampleDialog({ pageId, tag: initial, blocks, onClose }: { pageId: ID; tag?: string; blocks?: JSONContent[] | null; onClose: () => void }) {
  const t = useT()
  const page = useWorkspace((s) => s.pages[pageId])
  const marks = useContextMarks(blocks ? null : pageId)
  const [tag, setTag] = useState(() => typing(initial?.trim() ? initial.replace(/^#/, '') : suggestTag(pageId)))
  const [note, setNote] = useState('')
  const [topics, setTopics] = useState('')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const slug = slugTag(tag)
  const valid = TAG_RE.test(slug)
  const taken = useMemo(() => (valid ? exampleByTag(slug) : null), [slug, valid])
  const mode = blocks ? 'selection' : marks ? (marks.mode === 'marked' && !marks.blocks ? 'none' : marks.mode) : 'page'
  const withheld = mode === 'none'
  const what =
    mode === 'selection'
      ? t('features.memory.example.fromSelection', { count: blocks?.length ?? 0 })
      : mode === 'marked'
        ? t(`features.memory.example.fromMarked.${marks?.blocks === 1 ? 'one' : 'other'}`, { count: marks?.blocks ?? 0 })
        : mode === 'none'
          ? t('features.memory.example.withheld')
          : t('features.memory.example.fromPage')

  if (!page) return null

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy || !valid || withheld || (taken && !replace)) return
    setBusy(true)
    setError(null)
    const ac = new AbortController()
    abort.current = ac
    try {
      const res = await saveExample({
        pageId,
        tag: slug,
        note,
        topics: [...new Set(topics.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 5),
        blocks: blocks ?? null,
        replace: taken && replace ? taken.id : null,
        signal: ac.signal,
      })
      if (ac.signal.aborted) return
      onClose()
      useUI.getState().toast({
        message: t(res.how === 'replaced' ? 'features.memory.example.replaced' : 'features.memory.example.saved', { tag: slug }),
        kind: 'success',
        timeout: 8000,
        action: { label: t('features.memory.card.open'), run: () => openEntry(res.id) },
      })
    } catch (err) {
      if (ac.signal.aborted) return
      setBusy(false)
      if (err instanceof ExampleError) setError(t(`features.memory.example.err.${err.code}`))
      else setError(err instanceof AIError ? err.message : t('features.memory.example.err.gone'))
    }
  }

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  return (
    <Modal open onClose={close} label="§ MEM" title={t('features.memory.example.title')} width={500} className="mem-ex">
      <form className="mem-ex__form" onSubmit={(e) => void submit(e)} data-testid="memory-example">
        <p className="mem-ex__what">
          <span className={`led${withheld ? '' : ' led--on'}`} aria-hidden />
          <span className="label">{t('features.memory.example.reads')}</span>
          <span className="mem-ex__what-v">
            {page.title.trim() || t('common.untitled')} · {what}
          </span>
        </p>
        <label className="mem-ex__field">
          <span className="label">{t('features.memory.example.tag')}</span>
          <span className="mem-ex__tag">
            <span className="mem-ex__hash" aria-hidden>
              #
            </span>
            <input
              className="input mem-ex__tag-input"
              value={tag}
              onChange={(e) => {
                setTag(typing(e.target.value))
                setReplace(false)
              }}
              data-autofocus=""
              aria-describedby="mem-ex-tag-hint"
              aria-invalid={!valid || undefined}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </span>
          <span className="mem-ex__hint" id="mem-ex-tag-hint">
            {valid ? t('features.memory.example.tagHint', { tag: slug }) : t('features.memory.example.tagBad')}
          </span>
        </label>
        {taken && (
          <div className="mem-ex__taken" role="status" data-testid="memory-example-taken">
            <span className="mem-ex__taken-text">{t('features.memory.example.taken', { tag: slug, name: taken.text })}</span>
            <Switch checked={replace} onChange={setReplace} label={t('features.memory.example.replace')} disabled={busy} />
            <span className="mem-ex__taken-k">{t('features.memory.example.replace')}</span>
          </div>
        )}
        <label className="mem-ex__field">
          <span className="label">{t('features.memory.example.note')}</span>
          <input className="input" value={note} maxLength={200} placeholder={t('features.memory.example.notePh')} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </label>
        <label className="mem-ex__field">
          <span className="label">{t('features.memory.example.topics')}</span>
          <input className="input" value={topics} placeholder="CNSX, Atlas" onChange={(e) => setTopics(e.target.value)} disabled={busy} />
        </label>
        <p className="mem-ex__note">{t('features.memory.example.explain')}</p>
        {error && (
          <p className="mem-ex__error" role="alert">
            {error}
          </p>
        )}
        <div className="mem-ex__foot">
          {busy && (
            <span className="mem-ex__busy label">
              <span className="led led--on mem-ex__led" aria-hidden /> {t('features.memory.example.busy')}
            </span>
          )}
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !valid || withheld || (!!taken && !replace)}>
            {taken && replace ? t('features.memory.example.submitReplace') : t('features.memory.example.submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
