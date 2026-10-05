/**
 * Kind "agent": run one custom agent now — the same as "Run now" on its page (features/agents), so its
 * rules hold: a team browser agent changed by someone else waits for its creator, server agents start
 * on the team server.
 */
import { Bot } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../../store/store'
import { PageIcon } from '../../../ui/PageIcon'
import { useT, t } from '../../../i18n'
import { runAgentNow } from '../../agents'
import { CommandFailure } from '../failure'
import { FieldPicker } from '../parts'
import type { CommandKindDef, CommandPickerProps } from '../types'

export interface AgentConfig {
  agentId: string | null
}

const SAFE = /^[\w-]{1,64}$/

function AgentPicker({ config, onChange }: CommandPickerProps<AgentConfig>) {
  const t = useT()
  const agents = useWorkspace(useShallow((s) => Object.values(s.agents ?? {}).sort((a, b) => a.name.localeCompare(b.name))))
  const cur = agents.find((a) => a.id === config.agentId)
  if (!agents.length) return <p className="dbc-note">{t('features.cmd.agent.empty')}</p>
  return (
    <>
      <FieldPicker
        label={t('features.cmd.agent.pick')}
        placeholder={t('features.cmd.agent.placeholder')}
        searchable={agents.length > 6}
        searchPlaceholder={t('features.cmd.agent.search')}
        value={
          cur ? (
            <>
              <PageIcon icon={cur.icon ?? null} size={15} /> {cur.name}
            </>
          ) : config.agentId ? (
            <span className="faint">{t('features.cmd.agent.gone')}</span>
          ) : null
        }
        entries={agents.map((a) => ({ label: a.name, icon: <PageIcon icon={a.icon ?? null} size={15} />, checked: a.id === config.agentId, onSelect: () => onChange((c) => ({ ...c, agentId: a.id })) }))}
      />
      <p className="dbc-note">{t('features.cmd.agent.hint')}</p>
    </>
  )
}

export const agentKind: CommandKindDef<AgentConfig> = {
  kind: 'agent',
  label: () => t('features.cmd.kind.agent'),
  icon: Bot,
  Picker: AgentPicker,
  create: () => ({ agentId: null }),
  sanitize: (raw) => {
    const id = raw && typeof raw === 'object' ? (raw as { agentId?: unknown }).agentId : null
    return { agentId: typeof id === 'string' && SAFE.test(id) ? id : null }
  },
  writes: true,
  unavailable: ({ config }) => {
    if (!config.agentId) return t('features.cmd.agent.none')
    return useWorkspace.getState().agents?.[config.agentId] ? null : t('features.cmd.agent.gone')
  },
  run: async ({ config }) => {
    const agent = config.agentId ? useWorkspace.getState().agents?.[config.agentId] : undefined
    if (!agent) throw new CommandFailure(t('features.cmd.err.agentGone'), null)
    // the agent's own toasts tell how it went (done, busy, waiting for its creator)
    await runAgentNow(agent)
  },
}
