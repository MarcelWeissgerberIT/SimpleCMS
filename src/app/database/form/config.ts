/**
 * Writing form settings (always through the store's updateView) + a draft-text hook for the
 * builder's text fields (local while typing, committed after a pause and on blur).
 */
import { useEffect, useRef, useState } from 'react'
import type { FormConfig, FormLogic, FormPageBreak, FormQuestion, ID } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { newId } from '../../lib/ids'
import { formConfig, pageBreaksOf, questionOf } from './fields'
import { isDbLocked } from '../model/lock'

export function patchForm(dbId: ID, viewId: ID, fn: (cfg: FormConfig) => FormConfig): void {
  if (isDbLocked(dbId)) return
  const s = useWorkspace.getState()
  const v = s.databases[dbId]?.views.find((x) => x.id === viewId)
  if (!v) return
  s.updateView(dbId, viewId, { form: fn(formConfig(v)) })
}

export function patchQuestion(dbId: ID, viewId: ID, propId: ID, patch: Partial<FormQuestion>): void {
  patchForm(dbId, viewId, (cfg) => ({ ...cfg, questions: { ...(cfg.questions ?? {}), [propId]: { ...questionOf(cfg, propId), ...patch } } }))
}

/** Set or clear (null / no conditions) a question's "show only if". */
export function setLogic(dbId: ID, viewId: ID, propId: ID, logic: FormLogic | null): void {
  patchForm(dbId, viewId, (cfg) => {
    const { showIf: _old, ...q } = questionOf(cfg, propId)
    void _old
    const next: FormQuestion = logic && logic.conditions.length ? { ...q, showIf: logic } : q
    return { ...cfg, questions: { ...(cfg.questions ?? {}), [propId]: next } }
  })
}

/** Replace the page breaks (breaks without a question to start are dropped). */
export function setBreaks(dbId: ID, viewId: ID, fn: (breaks: FormPageBreak[]) => FormPageBreak[]): void {
  patchForm(dbId, viewId, (cfg) => {
    const pages = fn(pageBreaksOf(cfg)).filter((b) => !!b.before)
    const { pages: _old, ...rest } = cfg
    void _old
    return pages.length ? { ...rest, pages } : rest
  })
}

/** A page break before a question; returns its id. */
export function addBreak(dbId: ID, viewId: ID, before: ID): ID {
  const id = newId()
  setBreaks(dbId, viewId, (bs) => (bs.some((b) => b.before === before) ? bs : [...bs, { id, before }]))
  return id
}

export function patchBreak(dbId: ID, viewId: ID, id: ID, patch: Partial<Omit<FormPageBreak, 'id'>>): void {
  setBreaks(dbId, viewId, (bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)))
}

export function removeBreak(dbId: ID, viewId: ID, id: ID): void {
  setBreaks(dbId, viewId, (bs) => bs.filter((b) => b.id !== id))
}

/** Input props for a text field bound to a stored value. */
export function useDraft(value: string, commit: (v: string) => void, delay = 450) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const commitRef = useRef(commit)
  commitRef.current = commit
  const last = useRef(value)
  // follow outside changes while the field is not being edited
  useEffect(() => {
    last.current = value
    if (!focused.current) setDraft(value)
  }, [value])
  useEffect(() => {
    if (draft === last.current) return
    const id = window.setTimeout(() => {
      last.current = draft
      commitRef.current(draft)
    }, delay)
    return () => window.clearTimeout(id)
  }, [draft, delay])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const flush = () => {
    if (draftRef.current !== last.current) {
      last.current = draftRef.current
      commitRef.current(draftRef.current)
    }
  }
  // leaving the builder (mode switch, other view) right after typing must not drop the last edit
  useEffect(
    () => () => {
      if (draftRef.current !== last.current) commitRef.current(draftRef.current)
    },
    [],
  )
  return {
    value: draft,
    flush,
    props: {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onFocus: () => {
        focused.current = true
      },
      onBlur: () => {
        focused.current = false
        flush()
      },
    },
  }
}
