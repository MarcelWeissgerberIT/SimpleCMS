import type { Messages } from '@/shared/i18n'

/**
 * Patchbay strings — setup lamps, the band, the strip, the return chip, the profile drop (B11, B12). Split per batch so parallel tracks never edit one file (messages.ts merges them). Keys
 * "features.patchbay.*"; always add both en and de (German without "AI": "KI"; the words of plan §1.1 / §3.11).
 */
export const messages: Messages = {
  en: {},
  de: {},
}
