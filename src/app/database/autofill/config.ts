/**
 * AI autofill — which properties can be filled, with which presets, and when a config is runnable.
 * The config itself lives on the property (PropertyDef.autofill, see store/types.ts).
 */
import type { AutofillConfig, AutofillPreset, PropertyDef, PropertyType } from '../../store/types'

export const AUTOFILL_TYPES: readonly PropertyType[] = ['text', 'number', 'select', 'multi_select', 'checkbox', 'url']

export const canAutofill = (p: Pick<PropertyDef, 'type'>): boolean => AUTOFILL_TYPES.includes(p.type)

/** Presets that make sense for a property type (first = default). */
export function presetsFor(type: PropertyType): AutofillPreset[] {
  switch (type) {
    case 'text':
      return ['summary', 'extract', 'translate', 'custom']
    case 'number':
    case 'url':
      return ['extract', 'custom']
    case 'select':
    case 'multi_select':
      return ['categorize', 'custom']
    case 'checkbox':
      return ['custom']
    default:
      return []
  }
}

/** The effective config: null when autofill is off or the type no longer supports it. */
export function autofillOf(prop: PropertyDef): AutofillConfig | null {
  const cfg = prop.autofill
  if (!cfg || !canAutofill(prop)) return null
  const presets = presetsFor(prop.type)
  return presets.includes(cfg.preset) ? cfg : { ...cfg, preset: presets[0] }
}

export function defaultConfig(prop: PropertyDef): AutofillConfig {
  return { preset: presetsFor(prop.type)[0] ?? 'custom' }
}

/** Why a config can't run yet (i18n key), or null. */
export function configIssue(prop: PropertyDef, cfg: AutofillConfig): string | null {
  if (cfg.preset === 'custom' && !cfg.prompt?.trim()) return 'database.autofill.need.prompt'
  if (cfg.preset === 'extract' && !cfg.prompt?.trim()) return 'database.autofill.need.extract'
  if ((cfg.preset === 'categorize' || ((prop.type === 'select' || prop.type === 'multi_select') && cfg.preset === 'custom')) && !(prop.options ?? []).length && !cfg.allowNewOptions)
    return 'database.autofill.need.options'
  return null
}

/** Translation targets: `name` is what Claude is told, `native` is shown. */
export const LANGUAGES: ReadonlyArray<{ name: string; native: string }> = [
  { name: 'English', native: 'English' },
  { name: 'German', native: 'Deutsch' },
  { name: 'French', native: 'Français' },
  { name: 'Spanish', native: 'Español' },
  { name: 'Italian', native: 'Italiano' },
  { name: 'Portuguese', native: 'Português' },
  { name: 'Dutch', native: 'Nederlands' },
  { name: 'Polish', native: 'Polski' },
  { name: 'Swedish', native: 'Svenska' },
  { name: 'Turkish', native: 'Türkçe' },
  { name: 'Ukrainian', native: 'Українська' },
  { name: 'Japanese', native: '日本語' },
  { name: 'Korean', native: '한국어' },
  { name: 'Chinese (Simplified)', native: '简体中文' },
]
