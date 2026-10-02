/**
 * Formula editor: mono source field, live preview against real rows, error marker,
 * clickable reference of properties and functions.
 */
import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Database, Page, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import { Kbd, MOD } from '../../ui/controls'
import { compile, FORMULA_CATALOG, FormulaError, fvalueKind, toText, type FValue } from '../formula'
import { Resolver } from '../model/resolve'
import { TypeIcon } from '../parts'

export function FormulaEditor({ db, prop, rows, resolver, onClose }: { db: Database; prop: PropertyDef; rows: Page[]; resolver: Resolver; onClose: () => void }) {
  const t = useT()
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

  const q = query.trim().toLowerCase()
  const propList = db.properties.filter((p) => p.id !== prop.id && (!q || p.name.toLowerCase().includes(q)))
  const fnList = FORMULA_CATALOG.filter((f) => f.name !== 'prop' && (!q || f.name.toLowerCase().includes(q)))
  const groups = ['logic', 'text', 'math', 'date'] as const

  // caret marker under the error position (first line only)
  const errPos = err?.pos
  const lineStart = errPos !== undefined ? src.lastIndexOf('\n', errPos - 1) + 1 : 0

  return (
    <Modal
      open
      onClose={onClose}
      label={t('database.formula.label')}
      title={prop.name}
      width={860}
      className="db-fx"
      footer={
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
              onChange={(e) => setSrc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  if (!compiled.error || !src.trim()) save()
                }
              }}
            />
            {err && errPos !== undefined && !src.slice(lineStart, errPos).includes('\n') && (
              <div className="db-fx__marker" aria-hidden>
                <span>{src.slice(lineStart, errPos).replace(/[^\t]/g, ' ')}</span>
                <b>^</b>
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
                </span>
              ) : result === undefined ? (
                <span className="faint">{rows.length ? t('database.formula.typeToPreview') : t('database.formula.noRows')}</span>
              ) : (
                <span className="db-fx__value">{toText(result as FValue, resolver.ctx.lang) || <span className="faint">{t('database.formula.emptyResult')}</span>}</span>
              )}
            </div>
          </div>
          <div className="db-fx__help faint">{hint ?? t('database.formula.help')}</div>
        </div>
        <aside className="db-fx__ref">
          <input className="input" value={query} placeholder={t('database.formula.searchRef')} onChange={(e) => setQuery(e.target.value)} />
          <div className="db-fx__reflist">
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
          </div>
        </aside>
      </div>
    </Modal>
  )
}
