import { useEffect, useMemo } from 'react'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { useCloud, activeWorkspace } from '../../cloud'
import { loadRuns, useAgentRuns } from './runs'
import { loadServerRuns, useServerAgents } from './server'
import { loadReportLinks, useAgentReportLinks } from './reportLinks'
import { openAgentReport } from './dialogs'
import { statusKey } from './format'
import type { AgentRun } from './types'
import './invocation.css'

/** Run state stays outside page content. Merely opening a page never starts an agent or writes a report. */
export default function PageActivity({pageId}:{pageId:string}) {
  const t = useT()
  const agents = useWorkspace(s => s.agents)
  const page = useWorkspace(s => s.pages[pageId])
  const browser = useAgentRuns(s => s.byAgent)
  const server = useServerAgents(s => s.runs)
  const reports = useAgentReportLinks(s => s.links)
  const readOnly = useCloud(s => s.readOnly)
  const workspace = useCloud(s => s.active)
  const ids = Object.values(agents ?? {}).map(a => `${a.id}:${a.runner}`).sort().join(',')
  useEffect(() => {
    void loadReportLinks()
    for (const a of Object.values(useWorkspace.getState().agents ?? {})) {
      if (a.runner === 'server') void loadServerRuns(a.id)
      else if (!useAgentRuns.getState().byAgent[a.id]) void loadRuns(a.id)
    }
  }, [ids, workspace])
  const runs:AgentRun[] = useMemo(() => Object.values(agents ?? {}).flatMap(a => (a.runner === 'server' ? server[a.id] : browser[a.id]) ?? [])
    .filter(r => r.invocation?.pageId === pageId || Array.isArray(r.pageIds) && r.pageIds.includes(pageId))
    .sort((a,b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt-a.startedAt), [agents,browser,server,pageId])
  const polling = [...new Set(runs.filter(r => r.runner === 'server' && r.status === 'running').map(r => r.agentId))].sort().join(',')
  useEffect(() => {
    if (!polling) return
    const scope = activeWorkspace().id
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && activeWorkspace().id === scope) for (const id of polling.split(',')) void loadServerRuns(id)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [polling, workspace])
  if (!runs.length || !page || page.trashed) return null
  return <section className="agx-page-activity" data-testid="page-agent-activity" aria-label={t('features.agents.page.title')}>
    <h2 className="label">{t('features.agents.page.title')}</h2>
    {runs.slice(0,5).map(run => {
      const running = run.status === 'running'
      const ready = !running && ['ok','staged'].includes(run.status) && !!run.summary.trim()
      const saved = reports[run.id]
      const here = saved?.pageId === pageId && page.content?.content?.some(b => b.attrs?.id === `agent-report-${run.id}`)
      const canSave = !readOnly && !page.settings.locked
      return <article key={run.id} data-status={run.status} data-testid="page-agent-run">
        <div className="agx-page-activity__line">
          <span className="agx-page-activity__led" data-running={running || undefined} aria-hidden />
          <a href={`#/agents/${run.agentId}?run=${encodeURIComponent(run.id)}`}>{agents?.[run.agentId]?.name}</a>
          <span role="status">{t(running ? 'features.agents.page.running' : statusKey(run.status))}</span>
        </div>
        {run.invocation?.objective && <p>{run.invocation.objective}</p>}
        {typeof run.model === 'string' && run.model && <p className="label">{t('features.agents.model.resolved',{model:run.model})}</p>}
        {running && <p className="agx-page-activity__step">{run.steps.at(-1)?.label || t('features.agents.page.starting')}</p>}
        {ready && !here && <div className="agx-page-activity__line"><span>{t('features.agents.page.ask')}</span><button className="btn btn--sm" type="button" disabled={!canSave} onClick={() => openAgentReport(run, {pageId})}>{t('features.agents.page.save')}</button></div>}
        {here && <p>{t('features.agents.page.saved')}</p>}
        {!running && !ready && run.error && <p role="status">{run.error}</p>}
      </article>
    })}
  </section>
}
