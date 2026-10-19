import { useState } from 'react'
import type { Database, Page } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { useTaskLocal } from './local'
import { useCoding } from './state'
import { agentProperty, codingAgentOf, codingAgentProperty } from './agent'
import { CODING_AGENTS, type CodingAgent } from './protocol'

export function CodingAgentPick({ row, db, readOnly }: { row: Page; db: Database; readOnly: boolean }) {
  const t = useT()
  const local = useTaskLocal(row.id)
  const busy = useCoding(s => s.busy.some(b => b.taskId === row.id)) || local.state === 'running'
  const [error, setError] = useState(false)
  const agent = codingAgentOf(db, row)
  const change = (value: CodingAgent) => {
    if (readOnly || busy) return
    const store = useWorkspace.getState()
    const current = store.databases[db.id]
    if (!current) return
    let prop = codingAgentProperty(current)
    if (!prop) {
      if (current.locked) { setError(true); return }
      const id = store.addProperty(db.id, agentProperty())
      prop = useWorkspace.getState().databases[db.id]?.properties.find(p => p.id === id)
    }
    const option = prop?.options?.find(o => o.id === `coding_agent_${value}`)
    if (!prop || !option) { setError(true); return }
    store.setRowProperty(row.id, prop.id, option.id)
    setError(false)
  }
  return <div className="rtype-row" data-testid="coding-agent-type">
    <label className="label rtype-row__label" htmlFor={`coding-agent-${row.id}`}>{t('database.rtype.column')}</label>
    <select id={`coding-agent-${row.id}`} className="input" aria-label={t('features.coding.agent.label')} value={agent ?? 'unknown'} disabled={readOnly || busy} onChange={e => change(e.target.value as CodingAgent)} data-testid="coding-agent-select">
      {!agent && <option value="unknown">{t('features.coding.agent.unknown')}</option>}
      {CODING_AGENTS.map(id => <option key={id} value={id}>{t(`features.coding.agent.${id}`)}</option>)}
    </select>
    {error && <span role="alert">{t('features.coding.agent.locked')}</span>}
  </div>
}
