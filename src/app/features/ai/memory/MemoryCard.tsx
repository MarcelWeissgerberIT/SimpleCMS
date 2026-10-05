/**
 * One memory — a proposal as a card (the AI terminal's "REMEMBER? · 2" list and the AI menu's card):
 * the type tag, the sentence, topics, a Procedure's template, a near-identical memory it would repeat.
 * MemoryEdit: the inline form behind "e / Edit" (type, sentence, topics, template).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import type { Memory, MemoryProposal, MemoryType } from './types'
import { MEMORY_TYPES } from './types'
import './memory.css'

export function TypeTag({ type }: { type: MemoryType }) {
  const t = useT()
  return (
    <span className="mem-type" data-type={type}>
      {t(`features.memory.type.${type}`)}
    </span>
  )
}

export function MemoryBodyView({ p, dup }: { p: MemoryProposal; dup?: Pick<Memory, 'text'> | null }) {
  const t = useT()
  return (
    <>
      <div className="mem-line">
        <TypeTag type={p.type} />
        <span className="mem-text">{p.text}</span>
        {p.topics.length > 0 && <span className="mem-topics">{p.topics.join(' · ')}</span>}
      </div>
      {p.type === 'procedure' && p.body.trim() && (
        <div className="mem-tpl">
          <span className="mem-tpl__k">{t('features.memory.card.template')}</span>
          <pre className="mem-tpl__body">{p.body.trim()}</pre>
        </div>
      )}
      {dup && (
        <p className="mem-dup" data-testid="memory-dup">
          ≈ {t('features.memory.card.dup', { text: dup.text })}
        </p>
      )}
    </>
  )
}

/** "CNSX, Atlas" ↔ ['CNSX', 'Atlas'] */
const topicsText = (list: string[]) => list.join(', ')
const topicsOf = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 5)

/** Edit a proposal in place. Enter in the sentence saves, Esc cancels. */
export function MemoryEdit({ p, onSave, onCancel, saveLabel }: { p: MemoryProposal; onSave: (next: MemoryProposal) => void; onCancel: () => void; saveLabel?: string }) {
  const t = useT()
  const id = useId()
  const [type, setType] = useState<MemoryType>(p.type)
  const [text, setText] = useState(p.text)
  const [topics, setTopics] = useState(topicsText(p.topics))
  const [body, setBody] = useState(p.body)
  const textRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const save = () => {
    const sentence = text.replace(/\s+/g, ' ').trim()
    if (!sentence) return
    onSave({ ...p, type, text: sentence.slice(0, 300), topics: topicsOf(topics), body: type === 'procedure' ? body.trim() : '' })
  }
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && (!(e.target instanceof HTMLTextAreaElement) || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    }
  }
  return (
    <div className="mem-edit" onKeyDown={keys} data-testid="memory-edit">
      <div className="mem-edit__types" role="radiogroup" aria-label={t('features.memory.edit.type')}>
        {MEMORY_TYPES.map((x) => (
          <button key={x} type="button" role="radio" aria-checked={type === x} className="mem-edit__type" data-type={x} onClick={() => setType(x)}>
            {t(`features.memory.type.${x}`)}
          </button>
        ))}
      </div>
      <label className="mem-edit__field" htmlFor={`${id}-text`}>
        <span className="mem-edit__k">{t('features.memory.edit.text')}</span>
        <input ref={textRef} id={`${id}-text`} className="input mem-edit__input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} spellCheck />
      </label>
      <label className="mem-edit__field" htmlFor={`${id}-topics`}>
        <span className="mem-edit__k">{t('features.memory.edit.topics')}</span>
        <input id={`${id}-topics`} className="input mem-edit__input" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="CNSX, Atlas" />
      </label>
      {type === 'procedure' && (
        <label className="mem-edit__field" htmlFor={`${id}-body`}>
          <span className="mem-edit__k">{t('features.memory.edit.body')}</span>
          <textarea id={`${id}-body`} className="input mem-edit__body" value={body} rows={4} onChange={(e) => setBody(e.target.value)} />
        </label>
      )}
      <div className="mem-edit__keys">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          {t('features.memory.edit.cancel')}
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={!text.trim()}>
          {saveLabel ?? t('features.memory.edit.save')}
        </button>
      </div>
    </div>
  )
}
