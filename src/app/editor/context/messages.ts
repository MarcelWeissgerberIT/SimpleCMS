import type { Messages } from '@/shared/i18n'

/** Context picker strings (merged into the editor area's messages). Keys: "editor.ctx.*". */
export const contextMessages: Messages = {
  en: {
    'editor.ctx.layer': 'Blocks Claude may read — Space marks, ↑ ↓ move',
    'editor.ctx.bar': 'What Claude reads on this page',
    'editor.ctx.label': 'Context',
    'editor.ctx.blocks.one': '1 block',
    'editor.ctx.blocks.other': '{count} blocks',
    'editor.ctx.words.one': '1 word',
    'editor.ctx.words.other': '{count} words',
    'editor.ctx.nothing': 'Nothing marked — Claude reads nothing from this page',
    'editor.ctx.all': 'All',
    'editor.ctx.none': 'None',
    'editor.ctx.done': 'Done',
    'editor.ctx.cancel': 'Cancel',
    'editor.ctx.hint': 'Click or Space marks · Shift-click: a range · ↑ ↓ / j k move',
    'editor.ctx.block': 'Block {n}',
    'editor.ctx.blockOf': 'Block {n}: {text}',
  },
  de: {
    'editor.ctx.layer': 'Blöcke, die Claude lesen darf — Leertaste markiert, ↑ ↓ bewegen',
    'editor.ctx.bar': 'Was Claude auf dieser Seite liest',
    'editor.ctx.label': 'Kontext',
    'editor.ctx.blocks.one': '1 Block',
    'editor.ctx.blocks.other': '{count} Blöcke',
    'editor.ctx.words.one': '1 Wort',
    'editor.ctx.words.other': '{count} Wörter',
    'editor.ctx.nothing': 'Nichts markiert — Claude liest nichts von dieser Seite',
    'editor.ctx.all': 'Alle',
    'editor.ctx.none': 'Keine',
    'editor.ctx.done': 'Fertig',
    'editor.ctx.cancel': 'Abbrechen',
    'editor.ctx.hint': 'Klick oder Leertaste markiert · Shift-Klick: Bereich · ↑ ↓ / j k bewegen',
    'editor.ctx.block': 'Block {n}',
    'editor.ctx.blockOf': 'Block {n}: {text}',
  },
}
