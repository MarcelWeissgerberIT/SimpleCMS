import type { Messages } from '@/shared/i18n'

/**
 * Patchbay strings — the live signal: windows, comets, announcements, runs today, costs (B13, B14). Split per batch so parallel tracks never edit one file (messages.ts merges them). Keys
 * "features.patchbay.*"; always add both en and de (German without "AI": "KI"; the words of plan §1.1 / §3.11).
 *
 * B13: the screen reader's run announcements (live/announce.ts announcementText — one start and one end per run,
 * throttled; the ticking timer is never said). B14: the windows' words beside them — "RUNNING 0:04 · $0.21", the clock's
 * "07:30:00 FIRED", a database's "+3 FOR REVIEW", the cable label "3 PROPOSALS", "! FAILED" with the red lamp, "HELD"
 * (never red), "! BUDGET" with the amber one, a server agent's "on the server".
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
    // B14 — the windows (LCDs on the rack and on the strands)
    'features.patchbay.live.running': 'running {t}',
    'features.patchbay.live.runningTitle': 'Running since {time} on this device',
    'features.patchbay.live.elsewhereTitle': 'Running since {time} in another tab of this browser',
    'features.patchbay.live.serverTitle': 'Running on the server since {time}',
    'features.patchbay.live.fired': 'fired',
    'features.patchbay.live.firedTitle': 'Fired at {time}',
    'features.patchbay.live.reviewN': '+{n}',
    'features.patchbay.live.reviewWord': 'for review',
    'features.patchbay.live.review': '{n} for review',
    'features.patchbay.live.reviewTitle': '{n} proposals for this database wait for review',
    'features.patchbay.live.reviewTitle.one': '1 proposal for this database waits for review',
    'features.patchbay.live.failed': 'failed',
    'features.patchbay.live.failedTitle': 'The last run failed — open the module to read why',
    'features.patchbay.live.held': 'held',
    'features.patchbay.live.budget': 'budget',
    'features.patchbay.live.budgetTitle': 'The last run stopped at its own budget per run',
    'features.patchbay.live.server': 'on the server',
    'features.patchbay.live.priceUnknown': 'price unknown',
  },
  de: {
    'features.patchbay.live.runningSay': '{name} läuft',
    'features.patchbay.live.doneSay': '{name} fertig · {what}',
    'features.patchbay.live.doneSayPlain': '{name} fertig',
    'features.patchbay.live.failedSay': '{name}: Fehler',
    'features.patchbay.live.heldSay': '{name} angehalten',
    'features.patchbay.live.proposals': '{n} Vorschläge',
    'features.patchbay.live.proposals.one': '{n} Vorschlag',
    'features.patchbay.live.running': 'läuft {t}',
    'features.patchbay.live.runningTitle': 'Läuft seit {time} auf diesem Gerät',
    'features.patchbay.live.elsewhereTitle': 'Läuft seit {time} in einem anderen Tab dieses Browsers',
    'features.patchbay.live.serverTitle': 'Läuft seit {time} auf dem Server',
    'features.patchbay.live.fired': 'ausgelöst',
    'features.patchbay.live.firedTitle': 'Ausgelöst um {time}',
    'features.patchbay.live.reviewN': '+{n}',
    'features.patchbay.live.reviewWord': 'zur Prüfung',
    'features.patchbay.live.review': '{n} zur Prüfung',
    'features.patchbay.live.reviewTitle': '{n} Vorschläge für diese Datenbank warten auf Prüfung',
    'features.patchbay.live.reviewTitle.one': '1 Vorschlag für diese Datenbank wartet auf Prüfung',
    'features.patchbay.live.failed': 'Fehler',
    'features.patchbay.live.failedTitle': 'Der letzte Lauf ist fehlgeschlagen — Modul öffnen, um den Grund zu lesen',
    'features.patchbay.live.held': 'angehalten',
    'features.patchbay.live.budget': 'Budget',
    'features.patchbay.live.budgetTitle': 'Der letzte Lauf hat an seinem eigenen Budget pro Lauf gestoppt',
    'features.patchbay.live.server': 'auf dem Server',
    'features.patchbay.live.priceUnknown': 'Preis unbekannt',
  },
}
