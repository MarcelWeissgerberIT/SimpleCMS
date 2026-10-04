/**
 * Formula editor: mono source field, live preview against real rows, error marker,
 * clickable reference of properties and functions.
 */
import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, SquareFunction } from 'lucide-react'
import type { Database, Page, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import { Kbd, MOD } from '../../ui/controls'
import { compile, customFormulaFunctions, FORMULA_CATALOG, FormulaError, fvalueKind, toText, type FValue } from '../formula'
import { useUI } from '../../store/ui'
import { Resolver } from '../model/resolve'
import { Menu, TypeIcon } from '../parts'
import { useCreateProperty } from '../create/entry'
import { HelpLink } from '../../help'

export function FormulaEditor({ db: initialDb, prop, rows, resolver, onClose }: { db: Database; prop: PropertyDef; rows: Page[]; resolver: Resolver; onClose: () => void }) {
  const t = useT()
  // live: a property created from here (prop("…") of a name that isn't there yet) counts right away
  const db = useWorkspace((s) => s.databases[initialDb.id]) ?? initialDb
  const creator = useCreateProperty(db)
  const [typeMenu, setTypeMenu] = useState<{ el: HTMLElement; name: string; insert: boolean } | null>(null)
  const [src, setSrc] = useState(prop.formula ?? '')
  const [rowIdx, setRowIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const row = rows[Math.min(rowIdx, rows.length - 1)]

  const compiled = useMemo(() => compile(src), [src])
  const result: FValue | FormulaError | undefined = useMemo(() => {
    if (!src.trim()) return undefined
    if (compiled.error) return compiled.error
    if (!row) return undefined
    const r = new Resolver(resolver.ctx)
    return r.formula(db, { ...prop, formula: src }, row)
  }, [src, compiled, row, resolver, db, prop])

  const err = result instanceof FormulaError ? result : null
  const kind = fvalueKind(result)

  const insert = (text: string, caretBack = 0) => {
    const el = areaRef.current
    if (!el) return setSrc((s) => s + text)
    const a = el.selectionStart
    const b = el.selectionEnd
    const next = src.slice(0, a) + text + src.slice(b)
    setSrc(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = a + text.length - caretBack
      el.setSelectionRange(pos, pos)
    })
  }

  const save = () => {
    useWorkspace.getState().updateProperty(db.id, prop.id, { formula: src })
    onClose()
  }

  // Esc, the scrim and × keep a formula that compiles; one with an error asks before throwing it away
  const [askDiscard, setAskDiscard] = useState(false)
  const dirty = src !== (prop.formula ?? '')
  const dismiss = () => {
    if (!dirty) return onClose()
    if (!compiled.error || !src.trim()) return save()
    setAskDiscard(true)
  }

  const q = query.trim().toLowerCase()
  const propList = db.properties.filter((p) => p.id !== prop.id && (!q || p.name.toLowerCase().includes(q)))
  const fnList = FORMULA_CATALOG.filter((f) => f.name !== 'prop' && (!q || f.name.toLowerCase().includes(q)))
  // "Create property “X”": a searched name that is neither a property nor a function
  const canCreate = !creator.blocked && creator.isNew(query) && ![...FORMULA_CATALOG, ...customFormulaFunctions()].some((f) => f.name.toLowerCase() === q)
  const missing = err?.code === 'unknownProperty' && typeof err.vars?.name === 'string' && !creator.blocked && creator.isNew(err.vars.name) ? err.vars.name : null
  const groups = ['logic', 'text', 'math', 'date'] as const
  // the workspace's custom functions (built by clicking — features/sheets/functions); re-read when they change
  const customFns = useWorkspace((st) => st.functions)
  const customList = useMemo(() => customFormulaFunctions().filter((f) => !q || f.name.toLowerCase().includes(q)), [customFns, q])

  // the error is marked in place by a mirror of the source that wraps exactly like the textarea
  const errPos = err?.pos !== undefined ? Math.min(err.pos, src.length) : undefined
  const mirrorRef = useRef<HTMLDivElement>(null)

  return (
    <Modal
      open
      onClose={dismiss}
      label={t('database.formula.label')}
      title={prop.name}
      width={860}
      className="db-fx"
      footer={
        askDiscard ? (
          <>
            <span className="db-fx__discard" role="alert">
              {t('database.formula.discardAsk')}
            </span>
            <button type="button" className="btn" data-autofocus="" onClick={() => (setAskDiscard(false), areaRef.current?.focus())}>
              {t('database.formula.keepEditing')}
            </button>
            <button type="button" className="btn btn--danger" onClick={onClose}>
              {t('database.formula.discard')}
            </button>
          </>
        ) : (
          <>
            <span className="label db-fx__foothint">
              <Kbd>{MOD}</Kbd>
              <Kbd>⏎</Kbd> {t('database.formula.saveHint')}
            </span>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={!!compiled.error && !!src.trim()}>
              {t('common.done')}
            </button>
          </>
        )
      }
    >
      <div className="db-fx__grid">
        <div className="db-fx__main">
          <div className="db-fx__src">
            <textarea
              ref={areaRef}
              className="db-fx__area"
              value={src}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={'prop("Price") * 1.19'}
              data-autofocus=""
              onChange={(e) => {
                setSrc(e.target.value)
                if (askDiscard) setAskDiscard(false)
              }}
              onScroll={(e) => {
                if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  if (!compiled.error || !src.trim()) save()
                }
              }}
            />
            {err && errPos !== undefined && (
              <div className="db-fx__mirror" ref={mirrorRef} aria-hidden>
                {src.slice(0, errPos)}
                <mark className="db-fx__errmark">{src[errPos] && src[errPos] !== '\n' ? src[errPos] : ' '}</mark>
                {src[errPos] && src[errPos] !== '\n' ? src.slice(errPos + 1) : src.slice(errPos)}
                {'\u200b'}
              </div>
            )}
          </div>
          <div className="db-fx__preview" data-state={err ? 'error' : result === undefined ? 'idle' : 'ok'}>
            <div className="db-fx__previewhead">
              <span className="label">{t('database.formula.preview')}</span>
              {rows.length > 0 && (
                <span className="db-fx__rownav">
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.date.prev')} onClick={() => setRowIdx((i) => Math.max(0, i - 1))}>
                    <ChevronLeft size={13} />
                  </button>
                  <span className="db-fx__rowname">{row?.title || t('common.untitled')}</span>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.date.next')} onClick={() => setRowIdx((i) => Math.min(rows.length - 1, i + 1))}>
                    <ChevronRight size={13} />
                  </button>
                </span>
              )}
              <span style={{ flex: 1 }} />
              {!err && result !== undefined && <span className="db-fx__kind">{t(`database.formula.kind.${kind}`)}</span>}
            </div>
            <div className="db-fx__result">
              {err ? (
                <span className="db-fx__error">
                  {t(`database.formula.err.${err.code}`, err.vars)}
                  {err.pos !== undefined && <span className="label"> · {t('database.formula.atPos', { pos: err.pos + 1 })}</span>}
                  {missing && (
                    <button type="button" className="btn btn--sm db-fx__create" aria-haspopup="menu" onClick={(e) => setTypeMenu({ el: e.currentTarget, name: missing, insert: false })}>
                      <Plus size={12} className="dbc-plus" /> {t('database.create.entry', { name: missing })}
                    </button>
                  )}
                </span>
              ) : result === undefined ? (
                <span className="faint">{rows.length ? t('database.formula.typeToPreview') : t('database.formula.noRows')}</span>
              ) : (
                <span className="db-fx__value">{toText(result as FValue, resolver.ctx.lang) || <span className="faint">{t('database.formula.emptyResult')}</span>}</span>
              )}
            </div>
          </div>
          <div className="db-fx__help faint">
            {hint ?? t('database.formula.help')}
            <HelpLink id="formulas" />
          </div>
        </div>
        <aside className="db-fx__ref">
          <input className="input" value={query} placeholder={t('database.formula.searchRef')} onChange={(e) => setQuery(e.target.value)} />
          <div className="db-fx__reflist">
            {canCreate && (
              <button
                type="button"
                className="db-fx__refitem db-fx__refitem--create"
                aria-haspopup="menu"
                onClick={(e) => setTypeMenu({ el: e.currentTarget, name: query.trim(), insert: true })}
              >
                <Plus size={13} className="dbc-plus" />
                <span>{t('database.create.entry', { name: query.trim() })}</span>
              </button>
            )}
            {propList.length > 0 && <div className="label db-fx__refhead">{t('database.formula.properties')}</div>}
            {propList.map((p) => (
              <button
                key={p.id}
                type="button"
                className="db-fx__refitem"
                onMouseEnter={() => setHint(`prop("${p.name}") — ${t(`database.type.${p.type}`)}`)}
                onClick={() => insert(`prop("${p.name}")`)}
              >
                <TypeIcon type={p.type} size={13} />
                <span>{p.name}</span>
              </button>
            ))}
            {groups.map((g) => {
              const list = fnList.filter((f) => f.group === g)
              if (!list.length) return null
              return (
                <div key={g}>
                  <div className="label db-fx__refhead">{t(`database.formula.group.${g}`)}</div>
                  {list.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      className="db-fx__refitem db-fx__refitem--fn"
                      onMouseEnter={() => setHint(`${f.sig} — ${t(`database.formula.fn.${f.name}`)}`)}
                      onFocus={() => setHint(`${f.sig} — ${t(`database.formula.fn.${f.name}`)}`)}
                      onClick={() => {
                        const caret = f.insert.length - f.insert.indexOf('(') - 1
                        insert(f.insert, caret)
                      }}
                    >
                      <span className="mono">{f.name}</span>
                    </button>
                  ))}
                </div>
              )
            })}
            <div>
              <div className="label db-fx__refhead">{t('database.formula.group.custom')}</div>
              {customList.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  className="db-fx__refitem db-fx__refitem--fn"
                  onMouseEnter={() => setHint(`${f.sig}${f.description ? ` — ${f.description}` : ''}`)}
                  onFocus={() => setHint(`${f.sig}${f.description ? ` — ${f.description}` : ''}`)}
                  onClick={() => insert(`${f.name}()`, 1)}
                >
                  <span className="mono">{f.name}</span>
                </button>
              ))}
              <button type="button" className="db-fx__refitem" data-edit-functions="" onClick={() => useUI.getState().openModal({ type: 'functions' })}>
                <SquareFunction size={13} />
                <span>{t('database.formula.editFunctions')}</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
      <Menu
        open={!!typeMenu}
        anchor={typeMenu?.el ?? null}
        onClose={() => setTypeMenu(null)}
        placement="bottom-start"
        entries={
          typeMenu
            ? creator.typeMenu(typeMenu.name, (p) => {
                if (typeMenu.insert) {
                  insert(`prop("${p.name}")`)
                  setQuery('')
                }
              })
            : []
        }
      />
    </Modal>
  )
}
