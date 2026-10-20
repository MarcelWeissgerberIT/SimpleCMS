import { useState } from 'react'
import { Modal } from '../../ui/Modal'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { INVOCATION_MAX, readInvocation } from '@/shared/agents/invocation'
import { checkedInvocation } from './invocation'
import { runNow } from './actions'
import { closeAgentDialog, type AgentDialogRequest } from './dialogs'
import { useCloud } from '../../cloud'
import './agents.css'
import './invocation.css'
import { AgentModelHint } from './ModelDefault'

export function AgentRunDialog({ request }: { request: Extract<AgentDialogRequest, { kind: 'agentRun' }> }) {
  const t = useT()
  const readOnly = useCloud(s => s.readOnly)
  const agents = useWorkspace(s => s.agents)
  const pages = useWorkspace(s => s.pages)
  const [agentId, setAgent] = useState(request.req.agentId ?? '')
  const [pageId, setPage] = useState(request.req.pageId ?? '')
  const [objective, setObjective] = useState('')
  const [query, setQuery] = useState('')
  const [starting, setStarting] = useState(false)
  const agent = agents?.[agentId]
  const candidates = Object.values(pages).filter(p => !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id))
    .filter(p => p.id === pageId || !query || p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => a.id === pageId ? -1 : b.id === pageId ? 1 : a.title.localeCompare(b.title)).slice(0, 150)
  let error = ''
  if (agent) {
    try { checkedInvocation(agent, readInvocation({ ...(pageId ? { pageId } : {}), objective })) }
    catch (e) { error = e instanceof Error ? e.message : t('features.agents.invoke.outside') }
    if (agent.runner === 'server' && !useCloud.getState().supports?.includes('agent-invocation')) error = t('features.agents.invoke.serverOld')
  }
  const close = () => closeAgentDialog(request.seq)
  const start = async () => {
    if (!agent || error || starting || useCloud.getState().readOnly) return
    setStarting(true)
    const invocation = readInvocation({ ...(pageId ? { pageId } : {}), objective })
    // Only the run carries these values; upsertAgent is never called here.
    close()
    await runNow(agent, { invocation })
  }
  return <Modal open onClose={close} title={t('features.agents.invoke.title')} width={620} className="agx-invoke" footer={<>
    <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
    <button type="button" className="btn btn--primary" onClick={() => void start()} disabled={!agent || !!error || starting || readOnly}>{t('features.agents.invoke.start')}</button>
  </>}>
    <div className="agx-invoke__body">
      <label className="agx-field"><span className="label">{t('features.agents.invoke.agent')}</span>
        <select className="input" aria-label={t('features.agents.invoke.agent')} value={agentId} onChange={e => setAgent(e.target.value)}>
          <option value="">{t('features.agents.invoke.choose')}</option>
          {Object.values(agents ?? {}).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="agx-field"><span className="label">{t('features.agents.invoke.find')}</span><input className="input" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="agx-field"><span className="label">{t('features.agents.invoke.target')}</span>
        <select className="input" aria-label={t('features.agents.invoke.target')} value={pageId} onChange={e => setPage(e.target.value)}>
          <option value="">{t('features.agents.invoke.defaultTarget')}</option>
          {candidates.map(p => <option key={p.id} value={p.id}>{p.title || t('common.untitled')}</option>)}
        </select>
      </label>
      <label className="agx-field"><span className="label">{t('features.agents.invoke.objective')}</span>
        <textarea className="input" rows={5} maxLength={INVOCATION_MAX} value={objective} onChange={e => setObjective(e.target.value)} placeholder={t('features.agents.invoke.placeholder')} />
      </label>
      <p className="agx-field__hint">{t('features.agents.invoke.hint')}</p>
      {agent && <AgentModelHint agent={agent} />}
      {pageId && <p className="agx-field__hint">{t('features.agents.page.deliveryHint')}</p>}
      {agent && <details><summary>{t('features.agents.invoke.saved')}</summary><pre className="agx-invoke__saved">{agent.instructions}</pre></details>}
      {error && <p className="agx-field__error" role="alert">{error}</p>}
      {!Object.keys(agents ?? {}).length && <p>{t('features.agents.invoke.noAgents')}</p>}
    </div>
  </Modal>
}
