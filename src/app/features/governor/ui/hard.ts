/**
 * The hard limits per provider in use (Regler § 10.1 / G-D12) — #/regler's plate and Workspace › AI § 06 say them the
 * same way: from PROVIDERS[p].hardLimit / limitUrl (S2), one line per provider with a key here or a response today;
 * OpenRouter's key limit read live once per tab through the free key check (no text sent) — only with its key here.
 */
import { useEffect, useState } from 'react'
import type { ProviderId } from '@/shared/ai/types'
import { PROVIDERS, PROVIDER_ORDER } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { keyLimitUrl } from '../../../store/secrets'
import { hasKeyIn, setCheck, useChecks } from '../../ai/setup/facts'
import { verifyProvider } from '../../ai/core/verify'
import type { HardLine } from './ConsumptionPlate'

/** OpenRouter's key limit is read once per tab (the check's result is shared with Settings › AI). */
let askedKey = false

export function useHardLines(seen: readonly ProviderId[] = []): HardLine[] {
  const t = useT()
  const lang = useLang()
  const settings = useWorkspace((s) => s.settings)
  const checks = useChecks()
  const [orHref, setOrHref] = useState<string>(PROVIDERS.openrouter.limitUrl)
  const orKey = hasKeyIn(settings, 'openrouter')
  useEffect(() => {
    if (!orKey) return
    let alive = true
    void keyLimitUrl('openrouter').then((u) => alive && u && setOrHref(u))
    if (!askedKey && !useChecks.getState().openrouter?.credit) {
      askedKey = true
      setCheck('openrouter', { state: 'checking', at: Date.now() })
      void verifyProvider('openrouter')
        .catch(() => ({ ok: false as const, code: 'offline' as const }))
        .then((r) => setCheck('openrouter', r.ok ? { state: 'valid', ...(r.credit ? { credit: r.credit } : {}), at: Date.now() } : { state: 'error', code: r.code, at: Date.now() }))
    }
    return () => {
      alive = false
    }
  }, [orKey])
  // the providers in use: a key here, or a response today (registry order); none at all → Claude's line
  const inUse = PROVIDER_ORDER.filter((p) => (PROVIDERS[p].shipped && hasKeyIn(settings, p)) || seen.includes(p))
  return (inUse.length ? inUse : (['anthropic'] as ProviderId[])).map((p) => {
    const info = PROVIDERS[p]
    if (p === 'openrouter') {
      const c = checks.openrouter?.credit
      const text = !c ? info.hardLimit[lang] : c.limit !== null ? t('features.governor.hard.live', { limit: fmtUsd(c.limit, lang), left: fmtUsd(Math.max(0, c.remaining ?? c.limit - c.used), lang) }) : t('features.governor.hard.liveNone', { used: fmtUsd(c.used, lang) })
      return { code: info.code, name: info.name, text, href: orHref }
    }
    return { code: info.code, name: info.name, text: p === 'openai' ? `${info.hardLimit[lang]} ${t('features.governor.hard.unread')}` : info.hardLimit[lang], href: info.limitUrl }
  })
}
