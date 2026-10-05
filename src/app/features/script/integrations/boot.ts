/**
 * One Script — what other areas offer for scripts, registered at boot (script/index.ts imports this;
 * features/index.ts loads it with the app): the database command kind "Run script".
 * (Gmail registers mail.send itself — features/mail; buttons and automations call runScriptById.)
 */
import { registerCommandKind } from '../../commands'
import { scriptCommandKind } from './command'

registerCommandKind(scriptCommandKind)
