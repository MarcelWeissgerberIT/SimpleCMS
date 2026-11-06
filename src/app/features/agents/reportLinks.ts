/** This device's report exports; report content itself is saved through the workspace store. */
import { create } from 'zustand'
import { createStore, get, set } from 'idb-keyval'
import { activeWorkspace } from '../../cloud'

export interface SavedAgentReport { pageId: string; destination: string; mode: 'new' | 'append' | 'database'; at: number }
interface State { scope: string; links: Record<string, SavedAgentReport> }
export const useAgentReportLinks = create<State>(() => ({ scope: '', links: {} }))
const kv = createStore('one-agents', 'runs')
let writing = Promise.resolve()
export const agentReportScope = () => { const a = activeWorkspace(); return `${a.kind}:${a.id}` }
let loading: { scope: string; promise: Promise<void> } | null = null
export function loadReportLinks(): Promise<void> {
  const scope = agentReportScope()
  if (loading?.scope === scope) return loading.promise
  if (useAgentReportLinks.getState().scope === scope) return Promise.resolve()
  useAgentReportLinks.setState({ scope, links: {} })
  const promise = writing.then(() => get<Record<string, SavedAgentReport>>(`report-links:${scope}`, kv)).catch(() => ({})).then(links => {
    if (agentReportScope() === scope) useAgentReportLinks.setState({ links: links ?? {} })
  }).finally(() => { if (loading?.scope === scope) loading = null })
  loading = { scope, promise }
  return promise
}
export function linkAgentReport(runId: string, report: SavedAgentReport) {
  const scope = agentReportScope()
  const state = useAgentReportLinks.getState()
  const links = { ...(state.scope === scope ? state.links : {}), [runId]: report }
  const bounded = Object.fromEntries(Object.entries(links).sort((a, b) => b[1].at - a[1].at).slice(0, 1000))
  useAgentReportLinks.setState({ scope, links: bounded })
  writing = writing.then(() => set(`report-links:${scope}`, bounded, kv)).catch(e => console.warn('[one] report export link could not be saved', e))
}
