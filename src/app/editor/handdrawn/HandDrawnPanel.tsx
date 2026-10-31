import { useEffect, useRef, useState } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import type { SelectionBookmark } from '@tiptap/pm/state'
import type { Route } from '@/shared/ai/types'
import { Download, ImagePlus, PenLine, Play, Square, X } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { toast } from '../../store/ui'
import { withWriter } from '../../store/writer'
import { saveFile, useFileUrl } from '../../lib/files'
import { openAISettings } from '../../features/ai/setup/openAISetup'
import { RouteChip } from '../../features/ai/routing/RouteChip'
import { generateServers, rememberedServer } from '../../features/ai/media/generate'
import { MediaCards } from '../../features/ai/media/MediaCards'
import type { MediaItem } from '../../features/ai/media/types'
import { pagePrivate } from '../../features/ai/media/blocks'
import { mermaidError } from '../../features/ai/transform/mermaid'
import { MermaidDiagram } from '../views/MermaidView'
import { renderMermaid } from '../lib/mermaid'
import { pickFiles } from '../lib/upload'
import { dispatchAs, flushEditor } from '../lib/editAs'
import { drawingSpec, DRAWING_PROMPT_MAX, plainDrawingCode, SAMPLE_DRAWING, sketchCode, type DrawingMode, type DrawingSpec } from './model'
import { generateDrawing, generateIllustration } from './run'
import './drawing.css'

export interface DrawingOpen { blockId?: string; mode?: DrawingMode }
const findBlock = (editor: Editor, id?: string) => {
  let found: { pos: number; node: typeof editor.state.doc } | null = null
  if (id) editor.state.doc.descendants((node, pos) => {
    if (node.attrs.id === id && ['image', 'mermaid'].includes(node.type.name)) found = { pos, node }
    return !found
  })
  return found as { pos: number; node: typeof editor.state.doc } | null
}

export default function HandDrawnPanel({ editor, pageId, request, onClose }: { editor: Editor; pageId: string; request: DrawingOpen; onClose: () => void }) {
  const t = useT()
  const [initial] = useState(() => findBlock(editor, request.blockId)?.node)
  const [mode, setMode] = useState<DrawingMode>(initial?.type.name === 'image' ? 'image' : request.mode ?? 'diagram')
  const [spec, setSpec] = useState<DrawingSpec>(() => drawingSpec(initial?.attrs.drawing) ?? { version: 1, style: 'one-sketch', prompt: '', context: false, aspect: '16:9', serverId: rememberedServer('image'), reference: null })
  const [code, setCode] = useState(() => plainDrawingCode(String(initial?.attrs.code ?? SAMPLE_DRAWING)))
  const [src, setSrc] = useState<string>(initial?.type.name === 'image' ? String(initial.attrs.src ?? '') : '')
  const [resultSpec, setResultSpec] = useState(() => drawingSpec(initial?.attrs.drawing))
  const [pending, setPending] = useState<{ items: MediaItem[]; spec: DrawingSpec } | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const task = useRef<AbortController | null>(null)
  const saving = useRef(false)
  const bookmark = useRef<SelectionBookmark>(editor.state.selection.getBookmark())
  const rawServers = useWorkspace(s => s.ai?.onboarding ? s.settings.workspaceMcpServers : s.settings.mcpServers)
  const servers = generateServers('image', rawServers)
  const chosen = servers.find(s => s.server.id === spec.serverId) ?? servers[0]
  const url = useFileUrl(src || null)
  const refUrl = useFileUrl(spec.reference)
  const sources = [{ page: pageId, ...(spec.context ? {} : { as: 'selection' as const }) }]
  const update = (patch: Partial<DrawingSpec>) => setSpec(s => ({ ...s, ...patch }))

  useEffect(() => {
    const map = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => { bookmark.current = bookmark.current.map(transaction.mapping) }
    editor.on('transaction', map)
    return () => { task.current?.abort(); editor.off('transaction', map) }
  }, [editor])

  const close = () => { task.current?.abort(); onClose() }
  const check = () => {
    if (editor.isDestroyed || !editor.isEditable || !useWorkspace.getState().pages[pageId] || useWorkspace.getState().pages[pageId].trashed) throw new Error(t('editor.drawing.changed'))
    if (request.blockId) {
      const now = findBlock(editor, request.blockId)?.node
      if (!now || now.type.name !== initial?.type.name || now.attrs.src !== initial.attrs.src || now.attrs.code !== initial.attrs.code || JSON.stringify(now.attrs.drawing) !== JSON.stringify(initial.attrs.drawing)) throw new Error(t('editor.drawing.changed'))
    }
  }
  const run = async () => {
    if (busy || !spec.prompt.trim()) return
    const ac = new AbortController()
    task.current = ac
    setBusy(true); setError('')
    flushEditor(editor)
    try {
      const input = { ...spec, serverId: chosen?.server.id ?? null }
      if (mode === 'diagram') {
        const result = await generateDrawing(pageId, input, code, route, ac.signal)
        if (!ac.signal.aborted) setCode(result)
      } else {
        const result = await generateIllustration(pageId, input, route, ac.signal)
        if (!ac.signal.aborted) { setPending({ items: result, spec: input }); setSrc(''); update({ serverId: input.serverId }) }
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : t('editor.drawing.failed'))
    } finally {
      if (!ac.signal.aborted) { setBusy(false); task.current = null }
    }
  }
  const addReference = async () => {
    const [file] = await pickFiles('image/png,image/jpeg,image/webp')
    if (!file) return
    if (file.size > 10 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) { setError(t('editor.drawing.referenceTooLarge')); return }
    try { update({ reference: await saveFile(file, file.name) }) } catch { setError(t('editor.drawing.saveFailed')) }
  }
  const apply = async (cover: boolean) => {
    if (saving.current) return
    saving.current = true
    setBusy(true); setError('')
    try {
      check()
      if (mode === 'diagram' && await mermaidError(code)) throw new Error(t('editor.drawing.invalid'))
      if (mode === 'image' && !src) return
      const image = cover && mode === 'diagram' ? await saveFile(new Blob([await renderMermaid(sketchCode(code))], { type: 'image/svg+xml' }), 'one-hand-drawn.svg') : src
      check()
      if (cover) {
        withWriter({ kind: 'you', via: 'ui' }, () => useWorkspace.getState().updatePage(pageId, { cover: { type: 'image', value: image, positionY: 50 } }))
        toast({ message: t('editor.drawing.coverDone') })
      } else {
        const node: JSONContent = mode === 'diagram' ? { type: 'mermaid', attrs: { code: sketchCode(code), drawing: spec } } : { type: 'image', attrs: { src, alt: t('editor.drawing.image'), drawing: resultSpec } }
        const existing = findBlock(editor, request.blockId)
        // Locate edits by stable block id; new insertions follow intervening collaborative transactions.
        const tr = editor.state.tr
        if (existing) tr.setNodeMarkup(existing.pos, undefined, { ...existing.node.attrs, ...node.attrs })
        else {
          tr.setSelection(bookmark.current.resolve(tr.doc))
          tr.replaceSelectionWith(editor.schema.nodeFromJSON(node))
        }
        dispatchAs(editor, { kind: 'you', via: 'ui' }, tr.scrollIntoView())
      }
      close()
    } catch (e) { setError(e instanceof Error ? e.message : t('editor.drawing.failed')) }
    finally { saving.current = false; setBusy(false) }
  }

  return <Modal open onClose={close} title={<><PenLine size={19} /> {t('editor.drawing.title')}</>} label="§ DRAW" width={960} className="drawing-modal" footer={<>
    <button type="button" className="btn btn--ghost" onClick={close}>{t('common.cancel')}</button>
    <button type="button" className="btn" disabled={busy || (mode === 'image' && !src)} onClick={() => void apply(true)} data-testid="drawing-cover">{t('editor.drawing.cover')}</button>
    <button type="button" className="btn btn--primary" disabled={busy || (mode === 'image' && !src)} onClick={() => void apply(false)} data-testid="drawing-apply">{t(request.blockId ? 'editor.drawing.update' : 'editor.drawing.insert')}</button>
  </>}>
    <div className="drawing" data-testid="drawing-panel">
      <div className="drawing__head">
        <div className="drawing__modes" role="group" aria-label={t('editor.drawing.title')}>
          {(['diagram', 'image'] as const).map(m => <button key={m} type="button" className="btn" aria-pressed={mode === m} disabled={busy || !!request.blockId} onClick={() => { setMode(m); setError(''); setRoute(null) }} data-testid={`drawing-mode-${m}`}>{t(`editor.drawing.${m}`)}</button>)}
        </div>
        <RouteChip purpose={mode === 'diagram' ? 'drawing.diagram' : 'generate.media'} chip={route} onChip={setRoute} sources={sources} carries={[...(spec.context ? ['page' as const] : []), ...(mode === 'image' && spec.reference ? ['files' as const] : [])]} needs={mode === 'image' && spec.reference ? ['vision'] : []} reads={t(spec.context ? 'editor.drawing.reads' : 'editor.drawing.promptOnly')} disabled={busy} />
      </div>
      <p className="label drawing__style">{t('editor.drawing.style')}</p>
      <div className="drawing__columns">
        <div className="drawing__controls">
          <label className="drawing__field">{t('editor.drawing.prompt')}<textarea className="input" value={spec.prompt} maxLength={DRAWING_PROMPT_MAX} rows={4} placeholder={t('editor.drawing.placeholder')} onChange={e => update({ prompt: e.target.value })} disabled={busy} data-testid="drawing-prompt" /></label>
          <label className="drawing__check"><input type="checkbox" checked={spec.context} disabled={busy} onChange={e => update({ context: e.target.checked })} />{t('editor.drawing.context')}</label>
          <p className="drawing__hint">{t('editor.drawing.contextHint')}</p>
          {mode === 'image' && <>
            <label className="drawing__field">{t('editor.drawing.service')}<select className="input" value={chosen?.server.id ?? ''} disabled={busy} onChange={e => update({ serverId: e.target.value })} data-testid="drawing-server">{servers.map(s => <option key={s.server.id} value={s.server.id}>{s.server.name}</option>)}</select></label>
            {!servers.length && <div role="note"><p className="drawing__hint">{t('editor.drawing.noService')}</p><button type="button" className="btn btn--sm" onClick={() => { close(); openAISettings({ section: 'mcp' }) }}>{t('editor.drawing.settings')}</button></div>}
            <label className="drawing__field">{t('editor.drawing.aspect')}<select className="input" value={spec.aspect} disabled={busy} onChange={e => update({ aspect: e.target.value })}>{['1:1', '16:9', '3:1'].map(a => <option key={a} value={a}>{a === '3:1' ? t('editor.drawing.coverFormat') : a}</option>)}</select></label>
            {spec.reference ? <div className="drawing__reference"><img src={refUrl} alt="" /><button type="button" className="btn btn--sm" disabled={busy} onClick={() => update({ reference: null })}><X size={13} />{t('editor.drawing.removeReference')}</button></div> : <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void addReference()}><ImagePlus size={13} />{t('editor.drawing.reference')}</button>}
            {spec.reference && <p className="drawing__hint">{t('editor.drawing.referenceHint')}</p>}
          </>}
          <div className="drawing__actions"><button type="button" className="btn btn--ink" disabled={busy || !spec.prompt.trim() || (mode === 'image' && !chosen)} onClick={() => void run()} data-testid="drawing-generate"><Play size={13} />{t(busy ? 'editor.drawing.working' : 'editor.drawing.generate')}</button>
            {busy && !saving.current && <button type="button" className="btn btn--sm" onClick={() => { task.current?.abort(); task.current = null; setBusy(false) }}><Square size={12} />{t('editor.drawing.stop')}</button>}</div>
          <p className="drawing__hint">{t(mode === 'diagram' ? 'editor.drawing.diagramCost' : 'editor.drawing.cost')}</p>
          {error && <p className="drawing__error" role="alert">{error}</p>}
        </div>
        <div className="drawing__result" aria-busy={busy}>
          <p className="label">{t('editor.drawing.preview')}</p>
          {mode === 'diagram' ? <><MermaidDiagram code={sketchCode(code)} /><details><summary>{t('editor.drawing.code')}</summary><textarea className="input drawing__code" value={code} rows={9} spellCheck={false} disabled={busy} onChange={e => setCode(e.target.value)} data-testid="drawing-code" /></details></> : src && url ? <><img className="drawing__preview" src={url} alt={resultSpec?.prompt || t('editor.drawing.image')} /><a className="btn btn--sm" href={url} download="one-hand-drawn.png"><Download size={13} />{t('editor.drawing.download')}</a></> : pending ? <MediaCards items={pending.items} disabled={busy} privateTarget={pagePrivate(pageId)} onSaved={saved => {
            const image = saved.find(s => s.kind === 'image')
            if (image) { setSrc(image.src); setResultSpec(pending.spec); setPending(null) }
            else setError(t('editor.drawing.saveFailed'))
          }} /> : <div className="drawing__empty"><PenLine size={48} strokeWidth={1} /><span>{t('editor.drawing.image')}</span></div>}
        </div>
      </div>
    </div>
  </Modal>
}
