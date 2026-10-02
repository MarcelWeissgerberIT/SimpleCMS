export const BRAND = {
  name: 'SimpleCMS One',
  short: 'One',
  version: '1.0',
  repoUrl: 'https://github.com/MarcelWeissgerberIT/SimpleCMS',
  /** URL of the workspace app relative to the site root (respects Vite base). */
  appHref: `${import.meta.env.BASE_URL}app/`,
  /** URL of the landing page. */
  homeHref: `${import.meta.env.BASE_URL}`,
} as const

/** localStorage keys shared between landing and app. */
export const STORAGE_KEYS = {
  /** Set to '1' once the Excel → hammer intro has played. */
  introSeen: 'one.introSeen',
  /** 'en' | 'de' — user-chosen language (overrides navigator.language). */
  lang: 'one.lang',
  /** 'light' | 'dark' | 'system' — mirrored here so the landing can respect it. */
  theme: 'one.theme',
} as const

export function safeLocalGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* private mode / blocked storage — ignore */
  }
}
