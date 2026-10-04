/** Custom agents — what the UI does: run now, switch on / off, delete. */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { CustomAgent, ID } from '../../store/types'
import { navigate } from '../../lib/router'
import { CloudError } from '../../cloud'
import { t } from '../../i18n'
import { executeRun } from './exec'
import { dropRuns } from './runs'
import { loadServerRuns, runOnServer } from './server'

/** Start a run now: in this tab (browser runner) or on the team server. */
export async function runNow(agent: CustomAgent): Promise<void> {
  if (agent.runner === 'server') {
    try {
      await runOnServer(agent.id)
      useUI.getState().toast({ message: t('features.agents.toast.serverStarted', { name: agent.name }), kind: 'success' })
      window.setTimeout(() => void loadServerRuns(agent.id), 1200)
    } catch (e) {
      const unsupported = e instanceof CloudError && (e.status === 404 || e.code === 'not_found')
      useUI.getState().toast({ message: unsupported ? t('features.agents.server.unsupported') : t('features.agents.toast.serverFailed', { msg: e instanceof Error ? e.message : String(e) }), kind: 'error' })
    }
    return
  }
  await executeRun(agent, { trigger: { type: 'manual' }, manual: true })
}

export function setEnabled(agent: CustomAgent, enabled: boolean): void {
  useWorkspace.getState().upsertAgent({ ...agent, enabled })
}

/** Delete an agent (asks first); its runs on this device go too. */
export function deleteAgent(id: ID): void {
  const agent = useWorkspace.getState().agents?.[id]
  if (!agent) return
  useUI.getState().openModal({
    type: 'confirm',
    title: t('features.agents.del.title', { name: agent.name }),
    body: t('features.agents.del.body'),
    danger: true,
    confirmLabel: t('features.agents.del.confirm'),
    onConfirm: () => {
      useWorkspace.getState().deleteAgent(id)
      void dropRuns(id)
      navigate('#/agents')
    },
  })
}
