/**
 * Template variables — filled in when a template is USED (titles, text, text properties of the
 * copy). The recurring row templates' variables (schedule.ts: {{date}} {{weekday}} {{week}}
 * {{month}} {{year}} {{time}} {{iso}} {{name}}) plus {{user}} and {{workspace}}. Unknown ones
 * stay as they are, so text that only looks like a variable survives.
 */
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { fillRepeatVars } from './schedule'

/** Shown in the template banner (the most useful ones; all of fillRepeatVars work). */
export const TEMPLATE_VARIABLES = ['{{date}}', '{{weekday}}', '{{user}}', '{{workspace}}', '{{week}}', '{{time}}'] as const

/** Who uses the template: the name in Settings, in a team workspace else the account's name. */
function userName(): string {
  const own = useWorkspace.getState().settings.userName.trim()
  return own || useCloud.getState().user?.name?.trim() || ''
}

function workspaceName(): string {
  const c = useCloud.getState()
  if (c.active.kind === 'cloud') {
    const id = c.active.id
    const ws = c.workspaces.find((w) => w.id === id)
    if (ws?.name) return ws.name
  }
  return useWorkspace.getState().settings.workspaceName
}

/** A filler for one use of a template (one moment, one language): text → text with variables filled. */
export function templateFiller(name: string, at = new Date()): (text: string) => string {
  const lang = useWorkspace.getState().settings.language
  const user = userName()
  const workspace = workspaceName()
  return (text) => {
    if (!text.includes('{{')) return text
    const own = text.replace(/\{\{\s*(user|workspace)\s*\}\}/gi, (_all, key: string) => (key.toLowerCase() === 'user' ? user : workspace))
    return fillRepeatVars(own, at, { name, lang })
  }
}
