import { STORAGE_KEYS, safeLocalGet, safeLocalSet } from './brand'

export type Lang = 'en' | 'de'
export const LANGS: Lang[] = ['en', 'de']

/** Messages for one area: { en: { 'area.key': 'Text {name}' }, de: {...} } */
export type Messages = Record<Lang, Record<string, string>>

/** Stored choice → browser language → English. */
export function detectLang(): Lang {
  const stored = safeLocalGet(STORAGE_KEYS.lang)
  if (stored === 'en' || stored === 'de') return stored
  const nav = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'en'
  return nav.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export function persistLang(lang: Lang): void {
  safeLocalSet(STORAGE_KEYS.lang, lang)
  document.documentElement.lang = lang
}

/** Replace {name} placeholders. */
export function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/** Merge several area message objects into one. Later areas win on key clashes. */
export function mergeMessages(...parts: Messages[]): Messages {
  const out: Messages = { en: {}, de: {} }
  for (const p of parts) {
    Object.assign(out.en, p.en)
    Object.assign(out.de, p.de)
  }
  return out
}

/** Build a translate function. Falls back to English, then to the key itself. */
export function makeTranslator(messages: Messages, lang: Lang) {
  return (key: string, vars?: Record<string, string | number>): string => {
    const str = messages[lang][key] ?? messages.en[key] ?? key
    return interpolate(str, vars)
  }
}

export type Translate = ReturnType<typeof makeTranslator>
