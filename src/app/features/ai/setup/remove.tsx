/**
 * Removing a provider from this device (UX § 4.8): an inline panel (role alertdialog — the assistant and Settings are
 * dialogs themselves) with the impact list computed BEFORE anything changes: the key marker, the rules / default / roles
 * of this device that name the provider (router rules included), the agents naming it. Keys: "Delete only the key" ·
 * "Also clear the rules" (this device's layer, with Undo) · "Cancel". OpenRouter's Disconnect is the key-only removal
 * plus the reminder that the key "One" lives on at OpenRouter.
 */
import { useEffect, useRef, useState } from 'react'
import type { DeviceAI, ProviderId, RouteRule } from '@/shared/ai/types'
import { providerInfo } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import { setDeviceAI } from '../../../store/aiRules'
import { readAgentRoute } from '@/shared/ai/route'
import { useT } from '../../../i18n'
import { keyHint, setCheck } from './facts'

export interface Impact {
  last4: string
  /** device rules (per kind of work) + the default that name it */
  rules: number
  roles: boolean
  agents: string[]
}

const names = (rule: RouteRule | undefined, p: ProviderId) => !!rule?.some((r) => r.p === p)

/** What removing `p` from this device touches (read before anything changes). */
export function impactOf(p: ProviderId): Impact {
  const s = useWorkspace.getState()
  const dev = s.settings.ai
  const rules = Object.values(dev?.routes ?? {}).filter((r) => names(r, p)).length + (names(dev?.default, p) ? 1 : 0)
  const agents = Object.values(s.agents ?? {})
    .filter((a) => {
      const own = readAgentRoute(a.route)
      const rev = a.review && typeof a.review === 'object' && 'route' in a.review ? (a.review as { route: RouteRule }).route : undefined
      return (Array.isArray(own) && names(own, p)) || names(rev, p)
    })
    .map((a) => a.name)
  return { last4: keyHint(s.settings, p), rules, roles: !!dev?.roles?.[p], agents }
}

/** This device's layer without `p`: its pins dropped from every rule and the default, its roles gone. */
function without(dev: DeviceAI | undefined, p: ProviderId): Partial<DeviceAI> {
  const routes: NonNullable<DeviceAI['routes']> = {}
  for (const [cls, rule] of Object.entries(dev?.routes ?? {}) as Array<[keyof NonNullable<DeviceAI['routes']>, RouteRule]>) {
    const left = rule.filter((r) => r.p !== p)
    if (left.length) routes[cls] = left
  }
  const def = dev?.default?.filter((r) => r.p !== p)
  const roles = { ...(dev?.roles ?? {}) }
  delete roles[p]
  return { routes: Object.keys(routes).length ? routes : undefined, default: def?.length ? def : undefined, roles: Object.keys(roles).length ? roles : undefined }
}

/** Delete a provider's key on this device ('' removes the sealed secret too). */
export function dropKey(p: ProviderId): void {
  const set = useWorkspace.getState().updateSettings
  if (p === 'anthropic') set({ aiApiKey: '' })
  else set({ aiKeys: { [p]: '' } })
  setCheck(p, null)
}

export function RemovePanel({ p, onDone, onCancel }: { p: ProviderId; onDone: (msg: string, undo?: () => void) => void; onCancel: () => void }) {
  const t = useT()
  const info = providerInfo(p)
  const [impact] = useState(() => impactOf(p))
  const ref = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // focus on Cancel: deleting the key cannot be undone — a second ↵ or a key repeat must never do it
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  const keyOnly = () => {
    dropKey(p)
    onDone(t('features.ai.prov.remove.done', { p: info.name }))
  }
  const all = () => {
    const before = useWorkspace.getState().settings.ai
    const prior: Partial<DeviceAI> = { routes: before?.routes, default: before?.default, roles: before?.roles }
    dropKey(p)
    setDeviceAI(without(before, p))
    onDone(t('features.ai.prov.remove.done', { p: info.name }), () => setDeviceAI(prior))
  }
  const touchesRules = impact.rules > 0 || impact.roles
  return (
    <div
      className="aip-remove"
      role="alertdialog"
      aria-labelledby={`aip-remove-${p}`}
      ref={ref}
      data-testid={`remove-${p}`}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onCancel()
      }}
    >
      <strong id={`aip-remove-${p}`}>{t('features.ai.prov.remove.title', { p: info.name })}</strong>
      <ul>
        {impact.last4 && <li>{t('features.ai.prov.remove.key', { last4: impact.last4, company: info.company })}</li>}
        {impact.rules > 0 && <li>{t('features.ai.prov.remove.rules', { n: impact.rules, p: info.name })}</li>}
        {impact.roles && <li>{t('features.ai.prov.remove.roles', { p: info.name })}</li>}
        {impact.agents.length > 0 && <li>{t('features.ai.prov.remove.agents', { n: impact.agents.length, p: info.name, names: impact.agents.join(', ') })}</li>}
      </ul>
      <div className="aip-remove__keys">
        <button type="button" className="btn btn--sm btn--danger" onClick={keyOnly} data-testid="remove-key-only">
          {t('features.ai.prov.remove.keyOnly')}
        </button>
        {touchesRules && (
          <button type="button" className="btn btn--sm" onClick={all} data-testid="remove-all">
            {t('features.ai.prov.remove.all')}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel} ref={cancelRef} data-testid="remove-cancel">
          {t('features.ai.prov.remove.cancel')}
        </button>
      </div>
    </div>
  )
}
