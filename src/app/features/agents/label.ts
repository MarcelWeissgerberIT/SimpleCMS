/** "Agent · <name>" for the createdBy / updatedBy of changes an agent made (`agent:<agentId>`). */
import { useWorkspace } from '../../store/store'
import { t } from '../../i18n'

export function agentLabel(actor: string | null | undefined): string | null {
  if (typeof actor !== 'string' || !actor.startsWith('agent:')) return null
  const agent = useWorkspace.getState().agents?.[actor.slice(6)]
  return agent ? t('features.agents.actor', { name: agent.name }) : t('features.agents.actorPrefix')
}
