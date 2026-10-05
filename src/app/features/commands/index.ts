/**
 * DATABASE COMMANDS — public API (re-exported by features/index.ts). A database's menu of things to run:
 * a ⌘ key on its sidebar row (touch: the row's ⋯ menu), the same section in the row's right-click menu, a
 * key in the database toolbar, and "<database>: <command>" in ⌘K.
 *
 * Defaults are computed where they apply (defaults.ts): New entry, From template ▸, Open view ▸, Import
 * CSV…, Export CSV, Copy link · the Mails database: Sync now, Organise with Claude now, Mail settings… ·
 * agents that watch the database: Run "<agent>" now · the One memory: Open the memory log. Own commands
 * are stored in `Database.commands` (DbCommand, store/types.ts) with the order and the switched-off
 * defaults; `Database.locked` blocks changing them, running stays allowed.
 *
 *  - DbCommandKey { dbId, variant: 'sidebar' | 'toolbar', rowIds?, host?, onOpenChange? }: the key + its menu
 *  - DbCommandsMenu { dbId, entries, open, anchor, onClose, host?, exclude? }: a row menu with the commands on top
 *  - CommandsEditor { databaseId, onClose } (modal 'dbCommands') · openCommandsEditor(dbId)
 *  - paletteDbCommands(): the ⌘K entries (shell/lib/commands.ts)
 *  - readDbCommands(raw) (every reader: sanitized list) · saveDbCommands(dbId, list) (the only writer)
 *  - withoutCommandSecrets(db): the database with its commands' webhook URLs emptied (page backups, features/io)
 *
 * EXTENSION POINT — registerCommandKind(def): a new kind of own command, offered in "Edit commands… → Add
 * command". Call it once at module load of the area that owns the kind (e.g. features/script for "Run
 * script"), in a module the app loads at boot (one features/index.ts imports — not a lazy chunk: until its
 * kind is registered, a command of that kind stays out of the menus and ⌘K); nothing here changes. Keep
 * `run` light at the top and import heavy code (an interpreter) inside it. The def (types.ts CommandKindDef):
 *    kind      'script' — stored as DbCommand.kind ([a-z][a-z0-9-]{1,23}, not 'default')
 *    label     string | () => string — its name (a function: translated when shown)
 *    icon      a lucide icon
 *    Picker    ({ databaseId, config, onChange(fn) }) => JSX — the settings form; onChange takes an updater
 *    create?   (databaseId) => config of a new command (default {})
 *    sanitize? (raw: unknown) => config | null — every stored config passes it (null drops the command)
 *    writes?   boolean | (config) => boolean — viewers of a team workspace don't get writing commands (default true)
 *    unavailable? ({ databaseId, config, rowIds, surface }) => reason | null — shown as the item's hint, disabled
 *    run       (ctx) => outcome — ctx: { databaseId, command, config, workspace: 'local' | 'cloud', rowIds (rows
 *              selected on the database page when started from its toolbar, else []), surface: 'sidebar' |
 *              'toolbar' | 'palette' }. Resolve with a short outcome line for the toast ("12 rows exported";
 *              null: no toast); throw for an error toast with Retry (CommandFailure(msg, action | null) to replace
 *              or drop the Retry key). The key shows its LED while `run` is pending.
 * A command of a kind this build doesn't know keeps its JSON settings untouched and stays out of the menus.
 */
import { registerCommandKind } from './registry'
import { actionsKind } from './kinds/actions'
import { agentKind } from './kinds/agent'
import { viewKind } from './kinds/view'
import './commands.css'

// the built-in kinds go through the same extension point
registerCommandKind(actionsKind)
registerCommandKind(agentKind)
registerCommandKind(viewKind)

export { registerCommandKind } from './registry'
export { CommandFailure } from './failure'
export { DbCommandKey, DbCommandsMenu, openCommandsEditor, type DbCommandKeyProps } from './menu'
export { CommandsEditor } from './CommandsEditor'
export { paletteDbCommands, type PaletteCommand } from './palette'
export { readDbCommands, saveDbCommands } from './model'
export { withoutCommandSecrets } from './kinds/actions'
export type { CommandKindDef, CommandPickerProps, CommandRunContext, CommandSurface, CommandHost } from './types'
