import type { Messages } from '@/shared/i18n'

/** Block selection strings (merged into the editor area's messages). Keys: "editor.select.*". */
export const selectMessages: Messages = {
  en: {
    'editor.select.count': '{n} blocks · Esc',
    'editor.select.blocks': '{n} blocks',
    'editor.select.menuN': 'Block menu · {n} blocks',
    'editor.select.todb': 'Turn into database…',
    'editor.select.transform': 'Transform into',
    'editor.select.claude': 'Claude',
  },
  de: {
    'editor.select.count': '{n} Blöcke · Esc',
    'editor.select.blocks': '{n} Blöcke',
    'editor.select.menuN': 'Blockmenü · {n} Blöcke',
    'editor.select.todb': 'In Datenbank umwandeln…',
    'editor.select.transform': 'Verwandeln in',
    'editor.select.claude': 'Claude',
  },
}
