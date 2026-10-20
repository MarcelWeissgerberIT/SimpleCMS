import { useEffect, useState } from 'react'
import { withWriter } from '../../store/writer'
import { Modal } from '../../ui/Modal'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { useCloud } from '../../cloud'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { claudeBlocks } from '../ai/claudeDoc'
import { snapshotNow } from '../history/snapshots'
import { withoutWebImages } from './images'
import { closeAgentDialog, type AgentDialogRequest } from './dialogs'
import { agentReportScope, loadReportLinks, linkAgentReport, useAgentReportLinks } from './reportLinks'
import './agents.css'
import './invocation.css'

export function AgentReportDialog({ request }: { request: Extract<AgentDialogRequest, { kind: 'agentReport' }> }) {
  const t = useT()
  const locale = useLang() === 'de' ? 'de-DE' : 'en-US'
  const pages = useWorkspace(s => s.pages)
  const databases = useWorkspace(s => s.databases)
  const agents = useWorkspace(s => s.agents)
  const readOnly = useCloud(s => s.readOnly)
  const run = request.run
  const [mode, setMode] = useState<'new' | 'append' | 'database'>('new')
  const [target, setTarget] = useState('')
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState(`${agents?.[run.agentId]?.name || t('features.agents.invoke.agent')} · ${new Date(run.startedAt).toLocaleDateString(locale)}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void loadReportLinks() }, [])
  const list = Object.values(pages).filter(p => !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && !p.settings.locked)
    .filter(p => mode === 'database' ? p.kind === 'database' && !databases[p.id]?.system && !databases[p.id]?.pipeline?.length : p.kind !== 'database')
    .filter(p => p.id === target || !query || p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => a.id === target ? -1 : b.id === target ? 1 : a.title.localeCompare(b.title)).slice(0, 150)
  const close = () => closeAgentDialog(request.seq)
  const save = async () => {
    if (readOnly || busy || !run.summary.trim() || (mode !== 'new' && !target)) return
    setBusy(true); setError('')
    try {
      const scope = agentReportScope()
      await loadReportLinks()
      const cloud = useCloud.getState()
      if (agentReportScope() !== scope || cloud.readOnly) throw new Error(t('features.agents.report.unavailable'))
      const s = useWorkspace.getState()
      const p = target ? s.pages[target] : null
      if (target && (!p || isEffectivelyTrashed(s.pages, target) || inTemplate(s.pages, target) || p.settings.locked)) throw new Error(t('features.agents.report.unavailable'))
      if (mode === 'database' && (!s.databases[target] || s.databases[target].system || s.databases[target].pipeline?.length)) throw new Error(t('features.agents.report.unavailable'))
      const saved = useAgentReportLinks.getState().links[run.id]
      if (saved && saved.mode === mode && saved.destination === target && s.pages[saved.pageId] && !isEffectivelyTrashed(s.pages, saved.pageId)) return close()
      const body = claudeBlocks(withoutWebImages(run.summary))
      const provenance = { type: 'paragraph', attrs: { id: `agent-report-${run.id}` }, content: [
        { type: 'text', text: `${agents?.[run.agentId]?.name || t('features.agents.invoke.agent')} · ${new Date(run.startedAt).toLocaleString(locale)} · ` },
        { type: 'text', text: t('features.agents.report.source'), marks: [{ type: 'link', attrs: { href: `#/agents/${run.agentId}?run=${encodeURIComponent(run.id)}` } }] },
        ...(run.invocation?.pageId ? [{ type: 'text', text: ' · ' }, { type: 'text', text: run.invocation.pageTitle || t('features.agents.invoke.target'), marks: [{ type: 'link', attrs: { href: `#/p/${run.invocation.pageId}` } }] }] : []),
      ] }
      const content = { type: 'doc', content: [provenance, ...body] }
      let id: string
      if (mode === 'append') {
        if (!p || p.kind === 'database') throw new Error(t('features.agents.report.unavailable'))
        await snapshotNow(target, 'ai')
        // Read current content after the snapshot; never replace the page with the run's stale copy.
        if (agentReportScope() !== scope) throw new Error(t('features.agents.report.unavailable'))
        const latest = useWorkspace.getState().pages[target]
        if (!latest || latest.kind === 'database' || latest.settings.locked || inTemplate(useWorkspace.getState().pages, target) || isEffectivelyTrashed(useWorkspace.getState().pages, target)) throw new Error(t('features.agents.report.unavailable'))
        if (useCloud.getState().readOnly) throw new Error(t('features.agents.report.unavailable'))
        if (latest.content?.content?.some(b => b.attrs?.id === `agent-report-${run.id}`)) {
          linkAgentReport(run.id, { pageId: target, destination: target, mode, at: Date.now() }); return close()
        }
        withWriter({ kind: 'you', via: 'button', ref: run.id }, () => useWorkspace.getState().setContent(target, { type: 'doc', content: [...(latest.content?.content ?? []), ...content.content] }, 'agent-report-export'))
        id = target
      } else if (mode === 'database') id = withWriter({ kind: 'you', via: 'button', ref: run.id }, () => s.createRow(target, { title: title.trim() || t('features.agents.runs.report'), content, contentOrigin: 'agent-report-export' }))
      else id = withWriter({ kind: 'you', via: 'button', ref: run.id }, () => s.createPage({ title: title.trim() || t('features.agents.runs.report'), parentId: target || null, content }))
      linkAgentReport(run.id, { pageId: id, destination: target, mode, at: Date.now() })
      close()
    } catch (e) { setError(e instanceof Error ? e.message : t('features.agents.report.unavailable')); setBusy(false) }
  }
  return <Modal open onClose={close} title={t('features.agents.report.open')} width={620} footer={<>
    <button className="btn" onClick={close}>{t('common.cancel')}</button>
    <button className="btn btn--primary" onClick={() => void save()} disabled={readOnly || busy || (mode !== 'new' && !target)}>{t('features.agents.report.save')}</button>
  </>}><div className="agx-invoke__body">
    <label className="agx-field"><span className="label">{t('features.agents.report.mode')}</span><select className="input" aria-label={t('features.agents.report.mode')} value={mode} onChange={e => { setMode(e.target.value as typeof mode); setTarget('') }}>
      {(['new', 'append', 'database'] as const).map(m => <option value={m} key={m}>{t(`features.agents.report.${m}`)}</option>)}
    </select></label>
    {mode !== 'append' && <label className="agx-field"><span className="label">{t('features.agents.report.title')}</span><input className="input" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>}
    <label className="agx-field"><span className="label">{t('features.agents.invoke.find')}</span><input className="input" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <label className="agx-field"><span className="label">{t('features.agents.report.destination')}</span><select className="input" aria-label={t('features.agents.report.destination')} value={target} onChange={e => setTarget(e.target.value)}>
      <option value="">{t(mode === 'new' ? 'features.agents.report.top' : 'features.agents.report.choose')}</option>
      {list.map(p => <option value={p.id} key={p.id}>{p.title || t('common.untitled')}</option>)}
    </select></label>
    <p className="agx-field__hint">{t('features.agents.report.hint')}</p>
    {error && <p role="alert">{error}</p>}
  </div></Modal>
}
