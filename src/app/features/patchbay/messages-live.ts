import type { Messages } from '@/shared/i18n'

/**
 * Patchbay strings — the live signal: windows, comets, announcements, runs today, costs (B13, B14). Split per batch so parallel tracks never edit one file (messages.ts merges them). Keys
 * "features.patchbay.*"; always add both en and de (German without "AI": "KI"; the words of plan §1.1 / §3.11).
 *
 * B13: the screen reader's run announcements (live/announce.ts announcementText — one start and one end per run,
 * throttled; the ticking timer is never said). B14 adds the windows' words beside them.
 */
export const messages: Messages = {
  en: {
    'features.patchbay.live.runningSay': '{name} running',
    'features.patchbay.live.doneSay': '{name} done · {what}',
    'features.patchbay.live.doneSayPlain': '{name} done',
    'features.patchbay.live.failedSay': '{name} failed',
    'features.patchbay.live.heldSay': '{name} held',
    'features.patchbay.live.proposals': '{n} proposals',
    'features.patchbay.live.proposals.one': '{n} proposal',
  },
  de: {
    'features.patchbay.live.runningSay': '{name} läuft',
    'features.patchbay.live.doneSay': '{name} fertig · {what}',
    'features.patchbay.live.doneSayPlain': '{name} fertig',
    'features.patchbay.live.failedSay': '{name}: Fehler',
    'features.patchbay.live.heldSay': '{name} angehalten',
    'features.patchbay.live.proposals': '{n} Vorschläge',
    'features.patchbay.live.proposals.one': '{n} Vorschlag',
  },
}
