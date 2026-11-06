import { moneySymbol } from '../lib/money'
import { shortcutText } from '../ui/controls'
/**
 * App i18n. Usage:
 *   const t = useT();  t('editor.slash.heading1')  t('db.rows', { count: 3 })
 * Outside React: t('common.untitled')
 * Every user-visible string MUST go through t() with both en + de entries.
 */
import { useCallback } from 'react'
import { makeTranslator, mergeMessages, type Lang, type Messages, type Translate } from '@/shared/i18n'
import { useWorkspace } from '../store/store'
import { messages as core } from './core'
import { messages as shell } from '../shell/messages'
import { messages as editor } from '../editor/messages'
import { messages as database } from '../database/messages'
import { messages as features } from '../features/messages'
import { messages as help } from '../help/messages'
import { messages as code } from '../ui/code/messages'

/**
 * "{settingsAI}" in any string = the way to the AI settings ("Settings → AI" / "Einstellungen → KI", one key:
 * `shell.settings.path.ai`) — filled in once here, so a renamed tab is one change and no call site passes it.
 */
function withSettingsPath(m: Messages): Messages {
  for (const lang of ['en', 'de'] as const) {
    const path = m[lang]['shell.settings.path.ai'] ?? m.en['shell.settings.path.ai'] ?? ''
    for (const [k, v] of Object.entries(m[lang])) m[lang][k] = shortcutText(v.split('{settingsAI}').join(path))
  }
  return m
}

export const ALL_MESSAGES = withSettingsPath(mergeMessages(core, code, shell, editor, database, features, help))

const cache: Partial<Record<Lang, Translate>> = {}
function translator(lang: Lang): Translate {
  return (cache[lang] ??= ((base) => (key, vars) => base(key, { costCurrency: moneySymbol(), ...vars }))(makeTranslator(ALL_MESSAGES, lang)))
}

export function t(key: string, vars?: Record<string, string | number>): string {
  return translator(useWorkspace.getState().settings.language)(key, vars)
}

/** The UI's language now (outside React; components use useLang()). */
export function currentLang(): Lang {
  return useWorkspace.getState().settings.language
}

export function useLang(): Lang {
  // Currency and rate are part of this device’s number presentation. Refresh localized cost surfaces together.
  useWorkspace((s) => s.settings.costDisplay)
  return useWorkspace((s) => s.settings.language)
}

export function useT(): Translate {
  const lang = useLang()
  return useCallback((key: string, vars?: Record<string, string | number>) => translator(lang)(key, vars), [lang])
}
