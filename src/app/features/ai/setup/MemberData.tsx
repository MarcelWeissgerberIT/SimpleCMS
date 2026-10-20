import { useId } from 'react'
/**
 * "Your own data" (design § 10.2, OWNER.memberClassesOwnedByMember): private pages · mail · memory · MCP results, per
 * provider — this device only, starting off; a workspace rule never opens one (it may forbid one: read-only with the
 * reason). Claude receives them as before. Controlled (the step / Settings writes through setDeviceAI).
 */
import type { MemberClass, ProviderId } from '@/shared/ai/types'
import { MEMBER_CLASSES } from '@/shared/ai/policy'
import { providerInfo } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import { useT } from '../../../i18n'
import { Switch } from '../../../ui/controls'
import { CodePlate } from './ProviderPlate'
import './plates.css'

export interface MemberDataProps {
  providers: readonly ProviderId[]
  allow: Partial<Record<ProviderId, readonly MemberClass[]>>
  onChange: (p: ProviderId, allow: MemberClass[]) => void
}

export function MemberData({ providers, allow, onChange }: MemberDataProps) {
  const t = useT()
  const titleId = useId()
  const forbid = useWorkspace((s) => s.ai?.policy?.providers)
  const others = providers.filter((p) => p !== 'anthropic')
  if (!others.length) return null
  return (
    <section className="ownd" aria-labelledby={titleId} data-testid="member-data">
      <div className="ownd__head">
        <span id={titleId} className="label">
          {t('features.ai.prov.own.title')}
        </span>
        <span className="ownd__sub">{t('features.ai.prov.own.sub')}</span>
      </div>
      {others.map((p) => {
        const banned = forbid?.[p]?.forbid ?? []
        const mine = allow[p] ?? []
        const open = MEMBER_CLASSES.filter((c) => !banned.includes(c))
        return (
          <div key={p} className="ownd__prov" data-provider={p}>
            <div className="ownd__who">
              <CodePlate p={p} />
              <b>{providerInfo(p).name}</b>
              <span className="ownd__sp" />
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(p, [...open])} data-testid={`own-all-${p}`}>
                {t('features.ai.prov.own.allOn')}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(p, [])}>
                {t('features.ai.prov.own.allOff')}
              </button>
            </div>
            <ul className="ownd__list">
              {MEMBER_CLASSES.map((c) => {
                const no = banned.includes(c)
                return (
                  <li key={c} className="ownd__row" data-member={`${p}:${c}`}>
                    <span className="ownd__cls">
                      <b>{t(`features.ai.cls.${c}`)}</b>
                      <small>{t(`features.ai.prov.clsHint.${c}`)}</small>
                    </span>
                    <Switch
                      seed={`own-${p}-${c}`}
                      size="sm"
                      checked={!no && mine.includes(c)}
                      disabled={no}
                      label={t('features.ai.prov.rules.cell', { class: t(`features.ai.cls.${c}`), p: providerInfo(p).name })}
                      onChange={(v) => onChange(p, v ? [...new Set([...mine, c])] : mine.filter((x) => x !== c))}
                    />
                  </li>
                )
              })}
            </ul>
            {banned.length > 0 && <p className="ownd__note">{t('features.ai.prov.own.forbidden', { list: banned.map((c) => t(`features.ai.cls.${c}`)).join(', ') })}</p>}
          </div>
        )
      })}
    </section>
  )
}
