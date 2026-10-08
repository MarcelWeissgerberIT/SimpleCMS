/**
 * Workspace page § 06 — Integrations: the workspace's integration profiles (Workspace.integrations) — which agent
 * features an active MCP server unlocks, and the recipes they bring. The body is the features area's
 * IntegrationsPanel (list, New, Import, Export, the JSON editor); team workspaces: owners and admins edit.
 */
import { IntegrationsPanel } from '../../features'
import { useT } from '../../i18n'
import { SectionHead } from './parts'

export function IntegrationsSection() {
  const t = useT()
  return (
    <>
      <SectionHead n="06" title={t('shell.ws.sec.integrations')} lead={t('shell.ws.integrations.lead')} help="integrations" />
      <IntegrationsPanel />
    </>
  )
}
