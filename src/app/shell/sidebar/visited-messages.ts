import type { Messages } from '@/shared/i18n'

/** The sidebar's RECENT | FREQUENT section (shell/sidebar/Visited.tsx) and ⌘K "Clear recent and frequent pages". */
export const visitedMessages: Messages = {
  en: {
    'shell.sidebar.visited': 'Recently and frequently visited',
    'shell.sidebar.recent': 'Recent',
    'shell.sidebar.frequent': 'Frequent',
    'shell.sidebar.recentEmpty': 'Pages you open show up here.',
    'shell.sidebar.frequentEmpty': 'Pages you open often show up here — on this device.',
    'shell.sidebar.visitedFold': 'Fold recent and frequent',
    'shell.sidebar.visitedUnfold': 'Unfold recent and frequent',
    'shell.sidebar.visitedMenu': 'Recent and frequent: options',
    'shell.sidebar.visitedClear': 'Clear this list',
    'shell.sidebar.visitedClearAll': 'Clear both lists',
    'shell.sidebar.visitedDevice': 'This device only',
    'shell.sidebar.visitedCleared': 'Cleared on this device',
    'shell.cmd.clearVisits': 'Clear recent and frequent pages',
  },
  de: {
    'shell.sidebar.visited': 'Zuletzt und häufig besucht',
    'shell.sidebar.recent': 'Zuletzt',
    'shell.sidebar.frequent': 'Häufig',
    'shell.sidebar.recentEmpty': 'Seiten, die du öffnest, erscheinen hier.',
    'shell.sidebar.frequentEmpty': 'Seiten, die du oft öffnest, erscheinen hier — auf diesem Gerät.',
    'shell.sidebar.visitedFold': 'Zuletzt und Häufig einklappen',
    'shell.sidebar.visitedUnfold': 'Zuletzt und Häufig aufklappen',
    'shell.sidebar.visitedMenu': 'Zuletzt und Häufig: Optionen',
    'shell.sidebar.visitedClear': 'Liste leeren',
    'shell.sidebar.visitedClearAll': 'Beide Listen leeren',
    'shell.sidebar.visitedDevice': 'Nur dieses Gerät',
    'shell.sidebar.visitedCleared': 'Auf diesem Gerät geleert',
    'shell.cmd.clearVisits': 'Zuletzt und häufig besuchte Seiten leeren',
  },
}
