/**
 * App i18n. Usage:
 *   const t = useT();  t('editor.slash.heading1')  t('db.rows', { count: 3 })
 * Outside React: t('common.untitled')
 * Every user-visible string MUST go through t() with both en + de entries.
 */
import { useCallback } from 'react'
import { makeTranslator, mergeMessages, type Lang, type Translate } from '@/shared/i18n'
import { useWorkspace } from '../store/store'
import { messages as core } from './core'
import { messages as shell } from '../shell/messages'
import { messages as editor } from '../editor/messages'
import { messages as database } from '../database/messages'
import { messages as features } from '../features/messages'

export const ALL_MESSAGES = mergeMessages(core, shell, editor, database, features)

const cache: Partial<Record<Lang, Translate>> = {}
function translator(lang: Lang): Translate {
  return (cache[lang] ??= makeTranslator(ALL_MESSAGES, lang))
}

export function t(key: string, vars?: Record<string, string | number>): string {
  return translator(useWorkspace.getState().settings.language)(key, vars)
}

export function useLang(): Lang {
  return useWorkspace((s) => s.settings.language)
}

export function useT(): Translate {
  const lang = useLang()
  return useCallback((key: string, vars?: Record<string, string | number>) => translator(lang)(key, vars), [lang])
}
