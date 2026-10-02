import { useEffect } from 'react'
import { useWorkspace } from '../store/store'
import { STORAGE_KEYS, safeLocalSet } from '@/shared/brand'
import { persistLang } from '@/shared/i18n'

function systemDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function applyTheme(pref: 'light' | 'dark' | 'system') {
  const dark = pref === 'dark' || (pref === 'system' && systemDark())
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  safeLocalSet(STORAGE_KEYS.theme, pref)
}

/** Keeps <html data-theme> and <html lang> in sync with settings. Mount once. */
export function useThemeAndLanguage() {
  const theme = useWorkspace((s) => s.settings.theme)
  const lang = useWorkspace((s) => s.settings.language)
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])
  useEffect(() => {
    persistLang(lang)
  }, [lang])
}
