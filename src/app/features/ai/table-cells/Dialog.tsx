import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import type { Route } from '@/shared/ai/types'
import { cellText, snapshotTable, resolveCellPatch, TableCellError } from '@/shared/ai/tableCells'
import { ReceiptLine } from '../Receipt'
import type { Receipt } from '../core/meter'
import { Modal } from '../../../ui/Modal'
import { useT } from '../../../i18n'
import { RouteChip } from '../routing/RouteChip'
import { selectionRef, pageRef } from '../core/refs'
import { assertTableAccess, proposeTableCells, tableWorkspaceKey } from './run'
import { applyChanges } from '../agent/apply'
import type { StagedChange } from '../agent/types'
import { newId } from '../../../lib/ids'
import { noteRun, endRun, type Writer } from '../../../store/writer'
import './table-cells.css'

export default function TableCellsDialog({ editor, tableId, initial, onClose }: { editor: Editor; tableId: string; initial: string[]; onClose: () => void }) {
  const t = useT()
  const [workspace] = useState(tableWorkspaceKey)
  const [pageId] = useState(() => editor.view.dom.getAttribute('data-page-id') ?? '')
  const [snap] = useState(() => { try { return snapshotTable(editor.getJSON(), tableId) } catch { return null } })
  const [selected, setSelected] = useState<string[]>(initial)
  const [instruction, setInstruction] = useState(''), [includePage, setIncludePage] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [changes, setChanges] = useState<StagedChange[] | null>(null), [checked, setChecked] = useState<string[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const applying = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort() } }, [])
  // Live collaboration invalidates only affected proposals, never somebody else's values.
  const doc = useEditorState({ editor, selector: ({ editor: e }) => e.state.doc })
  const explain = (e: unknown) => e instanceof TableCellError ? t(`editor.table.ai.${e.code}`) : e instanceof Error ? e.message : String(e)
  const conflict = (c: StagedChange) => { try { resolveCellPatch(doc.toJSON(), c.edit!.cell!); return false } catch { return true } }
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(x => x !== id) : [...values, id]
  const close = () => { if (applying.current) return; abort.current?.abort(); onClose() }
  async function propose() {
    if (!snap || busy) return
    setError(''); setBusy(true); abort.current = new AbortController()
    try {
      const result = await proposeTableCells({ editor, pageId, workspace, snapshot: snap, selected, instruction, includePage, route, signal: abort.current.signal, onRun: r => { if (alive.current) setReceipt(r) } })
      if (alive.current) { setChanges(result); setChecked(result.map(c => c.id)) }
    } catch (e) { if (alive.current && !abort.current.signal.aborted) setError(explain(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  async function apply() {
    if (busy || !changes) return
    setError(''); setBusy(true); applying.current = true
    const writer: Writer = { kind: 'ai', run: newId(), action: 'table-cells' }
    try {
      assertTableAccess(editor, pageId, tableId, workspace)
      const picked = changes.filter(c => c.status === 'pending' && checked.includes(c.id))
      // One conflicting choice refuses this explicit batch before anything is written.
      for (const c of picked) resolveCellPatch(editor.getJSON(), c.edit!.cell!)
      noteRun(writer, { action: 'table-cells', ...(receipt ? { ai: `${receipt.served.p}:${receipt.served.model}` } : {}) })
      const result = await applyChanges(picked, changes, id => id, { writer, terminal: true, items: { creates: false }, editGuard: () => assertTableAccess(editor, pageId, tableId, workspace) })
      if (alive.current) {
        setChanges(changes.map(c => result.applied.includes(c.id) ? { ...c, status: 'applied' } : c))
        setChecked(checked.filter(id => !result.applied.includes(id)))
        if (result.failed.length) setError(result.failed.map(f => f.error).join('\n'))
      }
    } catch (e) { if (alive.current) setError(explain(e)) }
    finally { applying.current = false; endRun(writer); if (alive.current) setBusy(false) }
  }
  return <Modal open onClose={close} title={t(changes ? 'editor.table.ai.review' : 'editor.table.ai')} label="§ AI · CELLS" width={960} className="table-cells" footer={<>
    <button className="btn" disabled={busy && !!changes} onClick={close}>{t('editor.table.ai.cancel')}</button>
    {changes ? <button className="btn btn--primary" disabled={busy || !checked.length || changes.some(c => c.status === 'pending' && checked.includes(c.id) && conflict(c))} onClick={apply}>{t('editor.table.ai.apply')}</button>
      : <button className="btn btn--primary" disabled={busy || !snap || !instruction.trim() || !selected.length || selected.length > 30} onClick={propose}>{t(busy ? 'editor.table.ai.busy' : 'editor.table.ai.send')}</button>}
  </>}>
    <p>{t('editor.table.ai.intro')}</p>
    {receipt && <ReceiptLine receipt={receipt} />}
    {error && <p role="alert" className="table-cells__error">{error}</p>}
    {!snap && <p role="alert">{t('editor.table.ai.unsupported')}</p>}
    {!changes && snap && <>
      <div className="table-cells__controls"><RouteChip purpose="table.cells" chip={route} onChip={setRoute} sources={includePage ? pageRef(pageId) : selectionRef(pageId)} carries={includePage ? ['page'] : []} reads={t('editor.table.ai.reads')} text={instruction} disabled={busy} /><span>{selected.length} / 30</span></div>
      <div className="table-cells__controls"><button className="btn" disabled={busy} onClick={() => setSelected(snap.cells.filter(c => c.editable && !c.header && !c.text.trim()).map(c => c.id).slice(0, 30))}>{t('editor.table.ai.empty')}</button><button className="btn" disabled={busy} onClick={() => setSelected([])}>{t('editor.table.ai.clear')}</button></div>
      <div className="table-cells__scroll"><table className="table-cells__grid"><tbody>{Array.from({ length: snap.rows }, (_, i) => <tr key={i}>{snap.cells.filter(c => c.row === i + 1).map(c => <td key={c.address} colSpan={c.node.attrs?.colspan ?? 1} rowSpan={c.node.attrs?.rowspan ?? 1} className={selected.includes(c.id) ? 'is-picked' : ''}><label><span><input type="checkbox" aria-label={c.address} checked={selected.includes(c.id)} disabled={busy || !c.editable || (!selected.includes(c.id) && selected.length >= 30)} onChange={() => setSelected(toggle(selected, c.id))} /> <b>{c.address}</b></span><span className="table-cells__value">{c.text || '—'}</span>{!c.editable && <small>{t('editor.table.ai.unsupported')}</small>}</label></td>)}</tr>)}</tbody></table></div>
      <label className="table-cells__task">{t('editor.table.ai.task')}<textarea rows={5} maxLength={12000} value={instruction} placeholder={t('editor.table.ai.placeholder')} disabled={busy} onChange={e => setInstruction(e.target.value)} /></label>
      <label><input type="checkbox" checked={includePage} disabled={busy} onChange={e => setIncludePage(e.target.checked)} /> {t('editor.table.ai.context')}</label>
    </>}
    {changes && <div className="table-cells__review">{!changes.length && <p role="status">{t('editor.table.ai.none')}</p>}{changes.map(c => <section key={c.id} className="table-cells__plate">
      <label><input type="checkbox" checked={checked.includes(c.id)} disabled={busy || c.status === 'applied' || conflict(c)} onChange={() => setChecked(toggle(checked, c.id))} /> <b>{c.edit!.cell!.address}</b> {c.status === 'applied' && t('editor.table.ai.done')}</label>
      {c.status === 'pending' && conflict(c) && <p role="alert">{t('editor.table.ai.changed')}</p>}
      <div className="table-cells__diff"><div><small>{t('editor.table.ai.before')}</small><pre>{cellText(c.edit!.cell!.before) || '—'}</pre></div><div><small>{t('editor.table.ai.after')}</small><pre>{c.edit!.cell!.value || '—'}</pre></div></div>
    </section>)}</div>}
  </Modal>
}
