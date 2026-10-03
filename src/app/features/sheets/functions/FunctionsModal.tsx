/**
 * "Functions": the workspace's own functions, built by clicking. Left the list (search, new),
 * right the editor of the selected one. Edits are drafts until saved (⌘S); every function keeps
 * its own undo history while the dialog is open. Phones: list, then editor (with a back key).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Copy, Plus, Search, Trash2 } from 'lucide-react'
import { Modal } from '../../../ui/Modal'
import { Kbd, MOD } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { useCloud } from '../../../cloud'
import { newId } from '../../../lib/ids'
import type { CustomFunction, ID } from '../../../store/types'
import { makeCatalog } from './catalog'
import { useBuiltins } from './engine'
import { FunctionEditor } from './FunctionEditor'
import { checkDraft, fromDraft, HOLE, isBlocking, sameDraft, signature, toDraft, uniqueFnName, type Draft } from './model'
import { findUsage, renameInDoc, renameInFunctions, renameInFormula, formulaCalls } from './usage'
import './functions.css'

const EMPTY: Record<ID, CustomFunction> = {}
/** Test-bench inputs survive closing the dialog (per function, this tab only). */
const SAMPLES = new Map<ID, Record<string, string>>()

type Ask = { kind: 'close' } | { kind: 'delete'; id: ID } | null

export default function FunctionsModal({ initialId, onClose }: { initialId?: ID; onClose: () => void }) {
  const t = useT()
  const functions = useWorkspace((s) => s.functions) ?? EMPTY
  const readOnly = useCloud((c) => c.readOnly)
  const builtins = useBuiltins()
  const [drafts, setDrafts] = useState<Record<ID, Draft>>({})
  const [selected, setSelected] = useState<ID | null>(() => (initialId && functions[initialId] ? initialId : (sortedIds(functions)[0] ?? null)))
  const [pane, setPane] = useState<'list' | 'editor'>(initialId ? 'editor' : 'list')
  const [query, setQuery] = useState('')
  const [ask, setAsk] = useState<Ask>(null)
  const [, setTick] = useState(0)
  const history = useRef(new Map<ID, { past: Draft[]; future: Draft[] }>())
  const nameRef = useRef<HTMLInputElement>(null)

  const storedDraft = useMemo(() => (selected && functions[selected] ? toDraft(functions[selected]) : null), [selected, functions])
  const draft = selected ? (drafts[selected] ?? storedDraft) : null
  const stored = selected ? functions[selected] : undefined
  const catalog = useMemo(() => makeCatalog(builtins, functions, selected ?? undefined), [builtins, functions, selected])
  const issues = useMemo(() => (draft ? checkDraft(draft, catalog.lookup, catalog.isBuiltin, functions) : []), [draft, catalog, functions])
  const blocking = issues.filter(isBlocking)
  const isDirty = (id: ID) => {
    const d = drafts[id]
    if (!d) return false
    const s = functions[id]
    return !s || !sameDraft(d, toDraft(s))
  }
  const dirtyIds = Object.keys(drafts).filter(isDirty)
  const dirty = !!selected && isDirty(selected)
  const usage = useMemo(() => {
    if (!stored) return null
    const s = useWorkspace.getState()
    return findUsage(stored.name, s.pages, s.databases, functions, stored.id)
  }, [stored, functions])

  // the selected function was deleted elsewhere (another tab, a team member): show the next one
  useEffect(() => {
    if (selected && !functions[selected] && !drafts[selected]) setSelected(sortedIds(functions)[0] ?? null)
  }, [functions, drafts, selected])

  /* -------------------------------------------------------------- edits */

  const change = (next: Draft) => {
    if (!draft || readOnly) return
    const h = history.current.get(next.id) ?? { past: [], future: [] }
    h.past.push(draft)
    if (h.past.length > 200) h.past.shift()
    h.future = []
    history.current.set(next.id, h)
    setDrafts((d) => ({ ...d, [next.id]: next }))
  }
  const step = (dir: 'undo' | 'redo') => {
    if (!draft) return
    const h = history.current.get(draft.id)
    const from = dir === 'undo' ? h?.past : h?.future
    const to = dir === 'undo' ? h?.future : h?.past
    const prev = from?.pop()
    if (!prev || !to) return
    to.push(draft)
    setDrafts((d) => ({ ...d, [draft.id]: prev }))
  }
  const h = draft ? history.current.get(draft.id) : undefined

  const names = () => [...Object.values(functions).map((f) => f.name), ...Object.values(drafts).map((d) => d.name)]

  const create = () => {
    const id = newId()
    const d: Draft = {
      id,
      name: uniqueFnName('NEW_FUNCTION', names()),
      description: '',
      params: [],
      body: HOLE,
      createdAt: Date.now(),
    }
    setDrafts((all) => ({ ...all, [id]: d }))
    setSelected(id)
    setPane('editor')
    setQuery('')
    requestAnimationFrame(() => nameRef.current?.select())
  }

  const duplicate = () => {
    if (!draft) return
    const fn = fromDraft(draft)
    if (!fn) return
    const id = newId()
    const copy: CustomFunction = {
      ...fn,
      id,
      name: uniqueFnName(`${draft.name.slice(0, 26)}_COPY`, names()),
      createdAt: Date.now(),
    }
    useWorkspace.getState().upsertFunction(copy)
    setSelected(id)
    useUI.getState().toast({
      message: t('features.fn.duplicated', { name: copy.name }),
      kind: 'success',
    })
  }

  const save = () => {
    if (!draft || readOnly || blocking.length) return
    const fn = fromDraft(draft)
    if (!fn) return
    const ws = useWorkspace.getState()
    const before = functions[fn.id]
    ws.upsertFunction(fn)
    // a rename: call sites follow (spreadsheet cells, database formulas, other functions)
    if (before && before.name !== fn.name) {
      const n = renameEverywhere(before.name, fn.name, fn.id)
      if (n)
        useUI.getState().toast({
          message: t('features.fn.renamed', { name: fn.name, n }),
          kind: 'success',
        })
    }
    setDrafts((d) => {
      const next = { ...d }
      delete next[fn.id]
      return next
    })
    if (!before)
      useUI.getState().toast({
        message: t('features.fn.saved', { name: fn.name }),
        kind: 'success',
      })
  }

  const revert = () => {
    if (!selected) return
    setDrafts((d) => {
      const next = { ...d }
      delete next[selected]
      return next
    })
    if (!functions[selected]) setSelected(sortedIds(functions)[0] ?? null)
  }

  const remove = (id: ID) => {
    if (functions[id]) useWorkspace.getState().deleteFunction(id)
    setDrafts((d) => {
      const next = { ...d }
      delete next[id]
      return next
    })
    history.current.delete(id)
    setAsk(null)
    const rest = sortedIds(functions).filter((x) => x !== id)
    setSelected(rest[0] ?? null)
    setPane('list')
  }

  const dismiss = () => {
    if (dirtyIds.length && !readOnly) return setAsk({ kind: 'close' })
    onClose()
  }

  // ⌘S / Ctrl+S saves, ⌘Z / ⌘⇧Z undo and redo (outside text fields, which keep their own undo)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    if (k === 's' || k === 'enter') {
      e.preventDefault()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      requestAnimationFrame(() => saveRef.current())
      return
    }
    const field = (e.target as HTMLElement | null)?.closest?.('input, textarea, select')
    if (k === 'z' && !field) {
      e.preventDefault()
      step(e.shiftKey ? 'redo' : 'undo')
      setTick((n) => n + 1)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e)
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [])

  /* -------------------------------------------------------------- list */

  const q = query.trim().toUpperCase()
  const listIds = useMemo(() => {
    const ids = [
      ...Object.keys(drafts)
        .filter((id) => !functions[id])
        .sort((a, b) => drafts[b].createdAt - drafts[a].createdAt),
      ...sortedIds(functions),
    ]
    return ids.filter((id) => {
      if (!q) return true
      const f = drafts[id] ?? functions[id]
      return f.name.includes(q) || (f.description ?? '').toUpperCase().includes(q)
    })
  }, [drafts, functions, q])

  const selectFn = (id: ID) => {
    setSelected(id)
    setPane('editor')
    setAsk(null)
  }

  const askDelete = ask?.kind === 'delete' ? ask : null
  const delUsage = useMemo(() => {
    if (!askDelete || !functions[askDelete.id]) return null
    const s = useWorkspace.getState()
    return findUsage(functions[askDelete.id].name, s.pages, s.databases, functions, askDelete.id)
  }, [askDelete, functions])

  const footer =
    ask?.kind === 'close' ? (
      <>
        <span className="fx-foot__ask" role="alert">
          {t(dirtyIds.length === 1 ? 'features.fn.discardAsk.one' : 'features.fn.discardAsk.other', { n: dirtyIds.length })}
        </span>
        <button type="button" className="btn" data-autofocus="" onClick={() => setAsk(null)}>
          {t('features.fn.keepEditing')}
        </button>
        <button type="button" className="btn btn--danger" onClick={onClose}>
          {t('features.fn.discard')}
        </button>
      </>
    ) : askDelete ? (
      <>
        <span className="fx-foot__ask" role="alert">
          {delUsage && delUsage.total > 0
            ? t('features.fn.deleteAskUsed', {
                name: functions[askDelete.id]?.name ?? '',
                n: delUsage.total,
                cells: delUsage.cells,
                db: delUsage.dbFormulas,
                fns: delUsage.functions.length,
              })
            : t('features.fn.deleteAsk', {
                name: (drafts[askDelete.id] ?? functions[askDelete.id])?.name ?? '',
              })}
        </span>
        <button type="button" className="btn" data-autofocus="" onClick={() => setAsk(null)}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--danger" data-confirm-delete="" onClick={() => remove(askDelete.id)}>
          <Trash2 size={13} /> {t('features.fn.delete')}
        </button>
      </>
    ) : draft ? (
      <>
        {!readOnly && (
          <button type="button" className="btn btn--ghost fx-foot__del" aria-label={t('features.fn.delete')} onClick={() => setAsk({ kind: 'delete', id: draft.id })}>
            <Trash2 size={13} /> <span className="fx-foot__txt">{t('features.fn.delete')}</span>
          </button>
        )}
        {!readOnly && stored && (
          <button type="button" className="btn btn--ghost" aria-label={t('features.fn.duplicate')} onClick={duplicate} disabled={!fromDraft(draft)}>
            <Copy size={13} /> <span className="fx-foot__txt">{t('features.fn.duplicate')}</span>
          </button>
        )}
        <span className="fx-foot__state label">
          {readOnly ? (
            t('features.fn.viewOnly')
          ) : blocking.length ? (
            <>
              <span className="led led--on" /> {t('features.fn.notReady', { n: blocking.length })}
            </>
          ) : dirty ? (
            <>
              <Kbd>{MOD}</Kbd>
              <Kbd>S</Kbd>
            </>
          ) : (
            <>
              <span className="led led--ok" /> {t('features.fn.savedState')}
            </>
          )}
        </span>
        {!readOnly && dirty && stored && (
          <button type="button" className="btn" onClick={revert}>
            {t('features.fn.revert')}
          </button>
        )}
        {!readOnly && (
          <button type="button" className="btn btn--primary" onClick={save} disabled={!dirty || blocking.length > 0} data-save="">
            {t('features.fn.save')}
          </button>
        )}
      </>
    ) : null

  return (
    <Modal
      open
      onClose={dismiss}
      label="§ FX"
      title={t('features.fn.title')}
      width={1120}
      className={`fx-modal${pane === 'list' && !ask ? ' fx-modal--list' : ''}`}
      footer={footer}
    >
      <div className="fx-layout" data-pane={pane}>
        <aside className="fx-list" aria-label={t('features.fn.list')}>
          <div className="fx-list__head">
            <div className="fx-list__search">
              <Search size={13} aria-hidden />
              <input
                className="input input--bare"
                value={query}
                placeholder={t('features.fn.search')}
                aria-label={t('features.fn.search')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {!readOnly && (
              <button type="button" className="btn btn--sm btn--ink fx-list__new" onClick={create} data-new-function="">
                <Plus size={13} /> {t('features.fn.new')}
              </button>
            )}
          </div>
          <ul className="fx-list__items" role="listbox" aria-label={t('features.fn.list')}>
            {listIds.map((id) => {
              const f = drafts[id] ?? functions[id]
              return (
                <li key={id} role="option" aria-selected={id === selected}>
                  <button type="button" className="fx-item" data-fn={f.name} aria-current={id === selected || undefined} onClick={() => selectFn(id)}>
                    <span className="fx-item__line">
                      <span className="fx-item__name">{f.name}</span>
                      {isDirty(id) && <span className="led led--on" aria-label={t('features.fn.unsaved')} />}
                    </span>
                    <span className="fx-item__sig">{signature('', f.params)}</span>
                    {f.description && <span className="fx-item__desc">{f.description}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          {!listIds.length && (
            <div className="fx-list__empty">
              {Object.keys(functions).length || Object.keys(drafts).length ? (
                <span className="faint">{t('features.fn.noMatch', { q: query })}</span>
              ) : (
                <>
                  <p className="fx-list__emptyhead">{t('features.fn.empty.title')}</p>
                  <p className="faint">{t('features.fn.empty.body')}</p>
                </>
              )}
            </div>
          )}
          <div className="fx-list__foot label">
            {t('features.fn.count', {
              n: String(Object.keys(functions).length).padStart(2, '0'),
            })}
          </div>
        </aside>
        <div className="fx-main">
          <button type="button" className="btn btn--sm btn--ghost fx-back" onClick={() => setPane('list')}>
            <ArrowLeft size={13} /> {t('features.fn.all')}
          </button>
          {readOnly && <div className="fx-ro label">{t('features.fn.viewOnlyNote')}</div>}
          {draft ? (
            <FunctionEditor
              key={draft.id}
              draft={draft}
              stored={stored}
              catalog={catalog}
              functions={functions}
              issues={issues}
              readOnly={readOnly}
              dirty={dirty}
              usage={usage}
              samples={SAMPLES.get(draft.id) ?? {}}
              nameRef={nameRef}
              canUndo={!!h?.past.length}
              canRedo={!!h?.future.length}
              onChange={change}
              onSample={(name, value) => {
                SAMPLES.set(draft.id, {
                  ...(SAMPLES.get(draft.id) ?? {}),
                  [name]: value,
                })
                setTick((n) => n + 1)
              }}
              onUndo={() => step('undo')}
              onRedo={() => step('redo')}
            />
          ) : (
            <div className="fx-intro">
              <span className="fx-intro__glyph" aria-hidden>
                ƒ
              </span>
              <h3 className="fx-intro__title">{t('features.fn.intro.title')}</h3>
              <p className="faint">{t('features.fn.intro.body')}</p>
              {!readOnly && (
                <button type="button" className="btn btn--primary" onClick={create}>
                  <Plus size={13} /> {t('features.fn.new')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

const sortedIds = (fns: Record<ID, CustomFunction>): ID[] =>
  Object.values(fns)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => f.id)

/**
 * A function was renamed: rewrite its calls in spreadsheet cells, database formulas and other
 * functions. Returns how many places changed.
 */
function renameEverywhere(from: string, to: string, selfId: ID): number {
  const ws = useWorkspace.getState()
  const n = findUsage(from, ws.pages, ws.databases, ws.functions, selfId).total
  for (const p of Object.values(ws.pages)) {
    if (p.trashed || !p.content) continue
    const next = renameInDoc(p.content, from, to)
    if (next !== p.content) ws.setContent(p.id, next, 'functions')
  }
  for (const db of Object.values(ws.databases)) {
    for (const prop of db.properties) {
      if (prop.type !== 'formula' || !prop.formula || !formulaCalls(prop.formula, from)) continue
      ws.updateProperty(db.id, prop.id, { formula: renameInFormula(prop.formula, from, to) })
    }
  }
  for (const f of renameInFunctions(ws.functions, from, to, selfId)) ws.upsertFunction(f)
  return n
}
