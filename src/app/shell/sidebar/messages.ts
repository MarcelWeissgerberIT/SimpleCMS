import type { Messages } from '@/shared/i18n'

/** Sidebar tree strings for database entries (merged into the shell messages) — always add en and de. */
export const treeMessages: Messages = {
  en: {
    'shell.sidebar.newEntry': 'New entry',
    'shell.sidebar.noEntries': 'No entries',
    'shell.sidebar.showAll': 'Show all · {n}',
    'shell.sidebar.showAllLabel': 'Show all {n} entries of {db}',
    'shell.entry.makeTitle': 'Make “{title}” an entry of {db}?',
    'shell.entry.makeBody': 'Its {n} sub-pages come along and stay inside the entry. Its properties start empty.',
    'shell.entry.makeBodyOne': 'Its sub-page comes along and stays inside the entry. Its properties start empty.',
    'shell.entry.makeLabel': 'Make entry',
    'shell.entry.made': '“{title}” is now an entry of {db}',
    'shell.entry.leaveTitle': 'Remove from database and move here?',
    'shell.entry.leaveBody': '“{title}” leaves {db} and becomes a normal page. Its properties are dropped, links to it from other entries too. Sub-pages come along.',
    'shell.entry.leaveLabel': 'Remove and move',
    'shell.entry.left': '“{title}” moved out of {db}',
  },
  de: {
    'shell.sidebar.newEntry': 'Neuer Eintrag',
    'shell.sidebar.noEntries': 'Keine Einträge',
    'shell.sidebar.showAll': 'Alle anzeigen · {n}',
    'shell.sidebar.showAllLabel': 'Alle {n} Einträge von {db} anzeigen',
    'shell.entry.makeTitle': '„{title}“ zu einem Eintrag in {db} machen?',
    'shell.entry.makeBody': 'Ihre {n} Unterseiten kommen mit und bleiben im Eintrag. Die Eigenschaften starten leer.',
    'shell.entry.makeBodyOne': 'Ihre Unterseite kommt mit und bleibt im Eintrag. Die Eigenschaften starten leer.',
    'shell.entry.makeLabel': 'Zum Eintrag machen',
    'shell.entry.made': '„{title}“ ist jetzt ein Eintrag in {db}',
    'shell.entry.leaveTitle': 'Aus Datenbank entfernen und hierher verschieben?',
    'shell.entry.leaveBody': '„{title}“ verlässt {db} und wird eine normale Seite. Ihre Eigenschaften gehen verloren, ebenso Verknüpfungen anderer Einträge zu ihr. Unterseiten kommen mit.',
    'shell.entry.leaveLabel': 'Entfernen und verschieben',
    'shell.entry.left': '„{title}“ aus {db} herausgelöst',
  },
}
