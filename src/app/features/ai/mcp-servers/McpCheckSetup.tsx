import { MODELS } from '@/shared/ai/models'
import { routeKey } from '@/shared/ai/route'
import { PROVIDERS } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import { setDeviceAI, setDeviceRule } from '../../../store/aiRules'
import { hasAIKey } from '../../../store/secrets'
import { useT } from '../../../i18n'
import { Switch } from '../../../ui/controls'
import { listedWorkerModelRows, useWorkerModels } from '../core/workerModels'
import { routeFor } from '../core/gate'
import { labelFor } from '../core/registry'

/** Put the two personal setup choices beside the test, rather than hiding them in distant settings.
 * Choosing a model grants no data access; the separate, explicit switch grants MCP only. */
export function McpCheckSetup({ disabled = false }: { disabled?: boolean }) {
  const t = useT()
  useWorkerModels()
  const ai = useWorkspace(s => s.ai)
  const device = useWorkspace(s => s.settings.ai)
  useWorkspace(s => s.settings.aiApiKey)
  const current = routeFor('mcp-setup.inspect').route
  const saved = device?.routes?.['mcp-setup']?.[0]
  const models = [...(hasAIKey('anthropic') ? MODELS.filter(m => m.route.p === 'anthropic' && m.selectable && m.caps.mcp) : []), ...listedWorkerModelRows(saved ?? current).filter(m => m.caps.mcp && m.caps.mcpListing)]
  const value = saved ? routeKey(saved) : ''
  const provider = current.p
  const personal = provider === 'local' || provider === 'copilot'
  const forbidden = ai?.policy?.providers?.[provider]?.forbid?.includes('mcp') ?? false
  const enabled = device?.allow?.[provider]?.includes('mcp') ?? false
  return <section className="mcps-check-setup" data-testid="mcp-check-setup">
    <label className="mcps-field__label">
      {t('features.ai.mcp.check.model')}
      <select className="input" value={value} disabled={disabled} data-testid="mcp-check-model" onChange={e => {
        const route = models.find(m => routeKey(m.route) === e.target.value)?.route
        if (!e.target.value || route) setDeviceRule('mcp-setup', route ? [route] : null)
      }}>
        <option value="">{t('features.ai.mcp.check.default', { model: labelFor(current) })}</option>
        {saved && !models.some(m => routeKey(m.route) === value) && <option value={value} disabled>{labelFor(saved)}</option>}
        {models.map(m => <option key={routeKey(m.route)} value={routeKey(m.route)}>{labelFor(m.route)}</option>)}
      </select>
    </label>
    <p className="mcps-hint">{t('features.ai.mcp.check.scope')}</p>
    {personal && <>
      <div className="mcps-check-setup__permission">
        <span>{t('features.ai.mcp.check.allow', { provider: PROVIDERS[provider].name })}</span>
        <Switch seed={`mcp-check-${provider}`} checked={enabled && !forbidden} disabled={disabled || forbidden}
          label={t('features.ai.mcp.check.allow', { provider: PROVIDERS[provider].name })}
          onChange={on => {
            const latest = useWorkspace.getState().settings.ai?.allow ?? {}
            const mine = latest[provider] ?? []
            setDeviceAI({ allow: { ...latest, [provider]: on ? [...new Set([...mine, 'mcp' as const])] : mine.filter(c => c !== 'mcp') } })
          }} />
      </div>
      <p className="mcps-hint">{t(forbidden ? 'features.ai.mcp.check.forbidden' : 'features.ai.mcp.check.privacy')}</p>
    </>}
  </section>
}
