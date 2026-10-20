/** The Patchbay's real manual deliveries. These rows describe runs, not permanent access wiring. */
import { useEffect } from 'react'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { useCloud } from '../../cloud'
import { loadReportLinks, useAgentReportLinks } from './reportLinks'
import { statusKey } from './format'
import { loadRuns, useAgentRuns } from './runs'
import { loadServerRuns, useServerAgents } from './server'
import type { AgentRun } from './types'
import './invocation.css'

export function AgentInvocationRuns() {
  const t = useT()
  const locale = useLang() === 'de' ? 'de-DE' : 'en-US'
  const reports = useAgentReportLinks(s => s.links)
  const agents = useWorkspace(s => s.agents)
  const pages = useWorkspace(s => s.pages)
  const browser = useAgentRuns(s => s.byAgent)
  const server = useServerAgents(s => s.runs)
  const workspace = useCloud(s => s.active)
  useEffect(() => {
    void loadReportLinks()
    for (const a of Object.values(agents ?? {})) void (a.runner === 'server' ? loadServerRuns(a.id) : loadRuns(a.id)).catch(() => undefined)
  }, [agents, workspace])
  const runs: AgentRun[] = Object.values(agents ?? {}).flatMap(a => (a.runner === 'server' ? server[a.id] : browser[a.id]) ?? [])
    .filter(r => !!r.invocation || !!reports[r.id]).sort((a, b) => b.startedAt - a.startedAt).slice(0, 10)
  if (!runs.length) return null
  return <section className="agx-invocation-runs" data-testid="agent-invocation-runs" aria-label={t('features.agents.invoke.history')}>
    <h2 className="label">{t('features.agents.invoke.history')}</h2>
    {runs.map(run => <article className="agx-invocation-flow" key={run.id} data-status={run.status}>
      <div className="agx-invocation-flow__route">
        {run.invocation?.pageId && pages[run.invocation.pageId] && !pages[run.invocation.pageId].trashed
          ? <a href={`#/p/${run.invocation.pageId}`}>{pages[run.invocation.pageId].title || t('common.untitled')}</a>
          : <span>{run.invocation?.pageTitle || t('features.agents.invoke.defaultTarget')}</span>}
        <span aria-hidden>→</span><a href={`#/agents/${run.agentId}`}>{agents?.[run.agentId]?.name}</a>
        <span aria-hidden>→</span><a href={reports[run.id] ? `#/p/${reports[run.id].pageId}` : `#/agents/${run.agentId}?run=${encodeURIComponent(run.id)}`}>{reports[run.id] ? pages[reports[run.id].pageId]?.title || t('features.agents.report.saved') : t('features.agents.invoke.result')}</a>
        <span className="label">{t(statusKey(run.status))}</span>
      </div>
      {run.invocation?.objective && <p>{run.invocation.objective}</p>}
      <p className="label">{new Date(run.startedAt).toLocaleString(locale)} · {run.steps.filter(s => s.kind === 'mcp' || s.kind === 'tool').map(s => s.label).slice(-6).join(' · ')}</p>
    </article>)}
  </section>
}
