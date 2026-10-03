import type { Messages } from '@/shared/i18n'

/** Strings for Created by / Last edited by, "Me" filters and locked databases (merged into the database messages). */
export const peopleMessages: Messages = {
  en: {
    'database.type.created_by': 'Created by',
    'database.type.last_edited_by': 'Last edited by',
    'database.actor.you': 'You',
    'database.actor.api': 'API',
    'database.actor.webhook': 'Webhook',
    'database.actor.unknown': 'Unknown person',
    'database.me': 'Me',
    'database.me.short': 'ME',

    'database.lock.lock': 'Lock database',
    'database.lock.unlock': 'Unlock database',
    'database.lock.plate': 'Locked',
    'database.lock.hint': 'Properties and views of this database are locked.',
    'database.lock.unlockHint': 'Properties and views are locked, rows stay editable. Click to unlock.',
    'database.lock.sessionOnly': 'Locked database — filters and sorts apply to this tab only and are not saved.',
    'database.lock.notSaved': 'Not saved',
    'database.lock.reset': 'Reset',
    'database.lock.propHint': 'Locked — sort and filter only',
    'database.lock.optionSearch': 'Search options…',
  },
  de: {
    'database.type.created_by': 'Erstellt von',
    'database.type.last_edited_by': 'Zuletzt bearbeitet von',
    'database.actor.you': 'Du',
    'database.actor.api': 'API',
    'database.actor.webhook': 'Webhook',
    'database.actor.unknown': 'Unbekannte Person',
    'database.me': 'Ich',
    'database.me.short': 'ICH',

    'database.lock.lock': 'Datenbank sperren',
    'database.lock.unlock': 'Datenbank entsperren',
    'database.lock.plate': 'Gesperrt',
    'database.lock.hint': 'Eigenschaften und Ansichten dieser Datenbank sind gesperrt.',
    'database.lock.unlockHint': 'Eigenschaften und Ansichten sind gesperrt, Zeilen bleiben bearbeitbar. Klicken zum Entsperren.',
    'database.lock.sessionOnly': 'Gesperrte Datenbank — Filter und Sortierung gelten nur in diesem Tab und werden nicht gespeichert.',
    'database.lock.notSaved': 'Nicht gespeichert',
    'database.lock.reset': 'Zurücksetzen',
    'database.lock.propHint': 'Gesperrt — nur sortieren und filtern',
    'database.lock.optionSearch': 'Optionen suchen…',
  },
}
