import type { Messages } from '@/shared/i18n'

/** "Turn into page" strings (merged into the editor area's messages). Keys: "editor.split.*". */
export const splitMessages: Messages = {
  en: {
    'editor.split.toPage': 'Turn into page',
    'editor.split.pageN': 'Page · {n} blocks',
    'editor.split.done': 'Moved to a new page · {title}',
    'editor.split.kept': 'The blocks are back — “{title}” was changed meanwhile and stays as it is',
    'editor.split.err.none': 'Nothing here can become a page — select whole blocks of one page, column, callout, toggle or tab',
    'editor.split.err.busy': 'Meeting notes that are recording stay here — stop the recording first',
    'editor.split.err.failed': 'The new page could not be created',
  },
  de: {
    'editor.split.toPage': 'In Seite umwandeln',
    'editor.split.pageN': 'Seite · {n} Blöcke',
    'editor.split.done': 'In eine neue Seite verschoben · {title}',
    'editor.split.kept': 'Die Blöcke sind zurück — „{title}“ wurde inzwischen geändert und bleibt, wie es ist',
    'editor.split.err.none': 'Hier wird nichts zur Seite — markiere ganze Blöcke einer Seite, Spalte, Hinweisbox, Aufklappliste oder eines Tabs',
    'editor.split.err.busy': 'Besprechungsnotizen, die gerade aufnehmen, bleiben hier — beende zuerst die Aufnahme',
    'editor.split.err.failed': 'Die neue Seite konnte nicht angelegt werden',
  },
}
