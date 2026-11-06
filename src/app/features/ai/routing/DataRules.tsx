/**
 * The data-rules matrix (design § 10, UX § 5.4; setup step 04 today, Workspace › AI § 03 in slice 5): rows = the
 * workspace's shared data classes in plain words, columns = providers with a preset select (Everything · Work data ·
 * Selection only · Own; a new provider starts at "Choose …" = nothing). Cells are allow keys (role switch): allowed =
 * an ink key "ALLOWED", blocked = the hatch + a lock "BLOCKED" (on phones the word hides, the key keeps ≥ 34 × 26 px).
 * A column that may not be edited here (a team member; Claude's column until the server reads Claude rules) is read
 * only — a member may still switch an allowed class off for this device ("Device: off"). Controlled: the step holds
 * the draft and writes it on Next.
 */
import { Check, ChevronDown, Lock } from 'lucide-react'
import type { DataClass, ProviderId, SharedClass } from '@/shared/ai/types'
import { PRESETS, SHARED_CLASSES, presetOf, type PresetId } from '@/shared/ai/policy'
import { providerInfo } from '@/shared/ai/providers'
import { useT } from '../../../i18n'
import { CodePlate } from '../setup/ProviderPlate'
import './data-rules.css'

export interface DataRulesProps {
  providers: readonly ProviderId[]
  /** per provider: its allow list (null = no rule: Claude's "everything, as before") */
  allow: Partial<Record<ProviderId, readonly SharedClass[] | null>>
  /** switched off on this device */
  narrow: Partial<Record<ProviderId, readonly DataClass[]>>
  /** may the workspace's column be changed here? (else: why not) */
  lockOf: (p: ProviderId) => string | null
  onAllow: (p: ProviderId, allow: SharedClass[]) => void
  onNarrow: (p: ProviderId, cls: DataClass, off: boolean) => void
}

const PRESET_IDS: readonly PresetId[] = ['all', 'work', 'marked']

export function DataRules({ providers, allow, narrow, lockOf, onAllow, onNarrow }: DataRulesProps) {
  const t = useT()
  return (
    <div className="drules" role="table" aria-label={t('features.ai.prov.rules.q')} data-testid="data-rules" data-single={providers.length === 1 || undefined}>
      <div className="drules__row drules__row--head" role="row" style={{ ['--cols' as string]: providers.length }}>
        <span className="drules__q label" role="columnheader">
          {t('features.ai.prov.rules.q')}
        </span>
        {providers.map((p) => {
          const list = allow[p]
          const lock = lockOf(p)
          const preset = list === null || list === undefined ? (p === 'anthropic' ? 'claude' : 'none') : presetOf(list)
          return (
            <span key={p} className="drules__col" role="columnheader" data-provider={p}>
              <span className="drules__who">
                <CodePlate p={p} />
                <b>{providerInfo(p).name}</b>
                {lock && <Lock size={12} aria-hidden className="drules__lock" />}
              </span>
              <span className="drules__sel">
              <select
                className="input drules__preset"
                aria-label={t('features.ai.prov.rules.preset', { p: providerInfo(p).name })}
                value={preset}
                disabled={!!lock}
                title={lock ?? undefined}
                data-testid={`preset-${p}`}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'all' || v === 'work' || v === 'marked') onAllow(p, [...PRESETS[v]])
                  else if (v === 'none') onAllow(p, [])
                }}
              >
                {preset === 'claude' && <option value="claude">{t('features.ai.prov.preset.allClaude')}</option>}
                {preset === 'none' && <option value="none">{t('features.ai.prov.preset.none')}</option>}
                {PRESET_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`features.ai.prov.preset.${id}`)}
                  </option>
                ))}
                {preset === 'custom' && <option value="custom">{t('features.ai.prov.preset.custom')}</option>}
              </select>
              <ChevronDown size={12} aria-hidden className="drules__chev" />
              </span>
            </span>
          )
        })}
      </div>
      {SHARED_CLASSES.map((cls) => (
        <div key={cls} className="drules__row" role="row" style={{ ['--cols' as string]: providers.length }}>
          <span className="drules__cls" role="rowheader">
            <b>{t(`features.ai.cls.${cls}`)}</b>
            <small>{t(`features.ai.prov.clsHint.${cls}`)}</small>
          </span>
          {providers.map((p) => {
            const list = allow[p]
            const ws = list === null || list === undefined ? p === 'anthropic' : list.includes(cls)
            const off = !!narrow[p]?.includes(cls)
            const lock = lockOf(p)
            const on = ws && !off
            const label = t('features.ai.prov.rules.cell', { class: t(`features.ai.cls.${cls}`), p: providerInfo(p).name })
            return (
              <span key={p} className="drules__cell" role="cell" data-blocked={!on || undefined}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label}
                  className="dkey"
                  data-on={on || undefined}
                  data-cell={`${p}:${cls}`}
                  disabled={!!lock && !ws}
                  onClick={() => {
                    if (lock) {
                      // read-only workspace column: only this device's own switch-off
                      if (ws) onNarrow(p, cls, !off)
                      return
                    }
                    if (off) onNarrow(p, cls, false)
                    const cur = list ?? (p === 'anthropic' ? [...SHARED_CLASSES] : [])
                    onAllow(p, ws ? cur.filter((c) => c !== cls) : [...cur, cls])
                  }}
                >
                  {on ? <Check size={12} strokeWidth={2.2} aria-hidden /> : <Lock size={11} aria-hidden />}
                  <span className="dkey__word">{on ? t('features.ai.prov.rules.allowed') : t('features.ai.prov.rules.blocked')}</span>
                </button>
                {off && <span className="drules__dev label">{t('features.ai.prov.rules.device')}</span>}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
