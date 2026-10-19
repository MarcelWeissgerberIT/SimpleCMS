/**
 * One MCP — the error contract (spec § 2.0), pure: the local bridge, the One tab and the team server word a refusal the
 * same way, so a model learns one shape:
 *
 *   <code>: <argument path>: <what happened>. Nothing was changed. <next step>
 *
 * The code is the first word (an agent may branch on it), the path names the argument (`edits[3].ref`,
 * `rows[12].properties.Status`; empty when the call as a whole is meant), the next step comes from MCP_REMEDIES.
 */

export const MCP_ERROR_CODES = [
  'workspace_mismatch',
  'workspace_required',
  'workspace_unknown',
  'workspace_ambiguous',
  'not_found',
  'locked',
  'stale_ref',
  'page_changed',
  'lossy_replace',
  'too_large',
  'quota',
  'refused_type',
  'file_type',
  'private_scope',
  'system_database',
  'local_only',
  'fetch_refused',
  'rejected',
  'approval_timeout',
  'app_outdated',
  'bridge_outdated',
  'bad_argument',
  'comments_off',
] as const

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number]

const CODES = new Set<string>(MCP_ERROR_CODES)

/** The next step per code (model-facing English, one sentence each). */
export const MCP_REMEDIES: Record<McpErrorCode, string> = {
  workspace_mismatch: 'Ask the person which workspace they mean (one_list_workspaces); never repeat the call in another workspace on your own.',
  workspace_required: 'Pass "workspace" (an id from one_list_workspaces, or the exact name).',
  workspace_unknown: 'one_list_workspaces lists what is connected; ask the person which one they mean.',
  workspace_ambiguous: 'Pass the workspace id instead of its name (one_list_workspaces).',
  not_found: 'Find the id with one_search, one_overview or one_list_databases (something in the trash: one_restore_page).',
  locked: 'Ask the person to unlock it in One.',
  stale_ref: 'Read the page again (one_get_page) and use the refs of that read.',
  page_changed: 'Read the page again from the start (one_get_page) and call again.',
  lossy_replace: 'Change single blocks instead, or ask the person.',
  too_large: 'Split it into smaller calls.',
  quota: 'Try again tomorrow, or ask the person.',
  refused_type: 'Use a value of the property\'s type (one_get_database lists them).',
  file_type: 'Use one of the supported file types.',
  private_scope: 'Private content stays out of shared pages; ask the person.',
  system_database: 'Reading it stays allowed; changes there are made in One.',
  local_only: 'Only the local bridge (One open in the browser) can do this; ask the person.',
  fetch_refused: 'Ask the person to add the file in One.',
  rejected: 'Do not retry it; ask the person what they want instead.',
  approval_timeout: 'The person did not answer within 2 minutes; ask them whether to try again — do not retry on your own.',
  app_outdated: 'Ask the person to reload One (or update it); do not retry before.',
  bridge_outdated: 'Ask the person to update the One bridge (download one.mcpb or one-mcp.mjs again).',
  bad_argument: 'Check the tool\'s arguments (tools/list) and call again.',
  comments_off: 'Comments are off in One (Settings → Agents · MCP). Ask the person; do not retry.',
}

export const isMcpErrorCode = (v: unknown): v is McpErrorCode => typeof v === 'string' && CODES.has(v)

/** The code a message starts with (`not_found: …`), or null. */
export function codeOf(message: string): McpErrorCode | null {
  const m = /^([a-z_]+):/.exec(message)
  return m && isMcpErrorCode(m[1]) ? m[1] : null
}

const sentence = (s: string) => {
  const t = s.trim()
  return !t ? '' : /[.!?…]$/.test(t) ? t : `${t}.`
}

/**
 * A refusal in the contract's shape. `path` names the argument ('' = the call); `what` says what happened (a sentence,
 * its full stop added); `next` replaces the code's remedy when the case knows a better next step.
 */
export function mcpError(code: McpErrorCode, path: string, what: string, next?: string): string {
  return `${code}: ${path ? `${path}: ` : ''}${sentence(what)} Nothing was changed. ${next ?? MCP_REMEDIES[code]}`
}

/**
 * The words of an older One tab (contract 1, which sent its refusals without a code) for an approval that never came: the
 * window ran out, or the tab went away while the card waited (the person's answer is unknown — never an argument error).
 */
const NO_ANSWER = /was not approved within|disconnected while this change waited/i

/**
 * The person's own decision or One's settings, in an older tab's words too: rejected on the card, "Agents can only read",
 * a member who can only view, signed out, switched to read-only while the card waited, cancelled.
 */
const PERSON = /\bcancelled\b|the person's decision|rejected this change|can only read|can only view|not signed in|switched to read-only/i

/**
 * The code a refusal without one means (spec § 2.0: the code is the first word of EVERY refusal — an agent branches on
 * it): something that changed while the call waited → page_changed; something gone meanwhile → not_found; locked
 * meanwhile → locked; an approval that never came → approval_timeout; the person's own decision (or One's settings) →
 * rejected; anything else is about the arguments → bad_argument (as the team server's explain() does). A message that
 * starts with a code keeps it. An older One tab's (contract 1) refusals get their code here (the bridge, mcp/src/bridge.ts).
 */
export function withCode(message: string): string {
  if (codeOf(message)) return message
  const code: McpErrorCode = /changed (while this call waited|meanwhile|after its dry run|since)/i.test(message)
    ? 'page_changed'
    : /\b(is|are) gone\b|gone by now|deleted meanwhile|Use one_search to find page ids/i.test(message)
      ? 'not_found'
      : /was locked meanwhile/i.test(message)
        ? 'locked'
        : NO_ANSWER.test(message)
          ? 'approval_timeout'
          : PERSON.test(message)
            ? 'rejected'
            : 'bad_argument'
  return `${code}: ${message}`
}

/**
 * A message as the agent gets it: one that starts with a code but does not say "Nothing was …" (changed, done, moved,
 * restored …) gets that and the code's next step; anything else passes as it is (such messages carry their own wording).
 */
export function withRemedy(message: string): string {
  const code = codeOf(message)
  if (!code || /\b[Nn]othing (was|is) \w+/.test(message)) return message
  return `${sentence(message)} Nothing was changed. ${MCP_REMEDIES[code]}`
}

/**
 * A new option for a select bound to a shared list (features/kit, PropertyDef.listId): the list owns the options and
 * every list edit writes them into the property again — an option added to the property alone would vanish and leave
 * its values pointing at nothing. Agents and MCP never add one there (the local bridge, the AI terminal, custom agents
 * and the team server word it alike).
 */
export const listOptionText = (option: string, list: string): string =>
  `unknown option ${JSON.stringify(option)} — this property takes its options from the shared list ${JSON.stringify(list)}; a new option is added to that list in One (Building blocks)`

/** The most entries a batch refusal lists (then "and n more"). */
export const BATCH_REFUSAL_LINES = 20

/** An entry's refusal as a line of the batch's list: no code, no "Nothing was changed.", no next step, its path short. */
export function entryText(message: string, path: string): string {
  let m = message
  const code = codeOf(m)
  if (code) m = m.slice(code.length + 1).trim()
  // the entry's own path (the list names it); a deeper part stays ("properties.Status: …")
  if (m.startsWith(`${path}.`)) m = m.slice(path.length + 1)
  else if (m.startsWith(`${path}:`)) m = m.slice(path.length + 1)
  m = m.replace(/Nothing was (changed|staged)\.\s*/g, '')
  for (const r of Object.values(MCP_REMEDIES)) m = m.split(r).join('')
  return m.replace(/\s+/g, ' ').trim()
}

/**
 * ONE refusal for every entry of a batch that does not fit (spec § 2.3, bridge and team server alike): `rows[i]
 * ("title"): …` per line (≤ 20, then "and n more"), the code they share (else bad_argument), "Nothing was changed." and
 * the next step. `failed[i].message` is the entry's own refusal (with its code); `root` is the argument ("rows").
 */
export function batchRefusal(failed: ReadonlyArray<{ path: string; name: string | null; message: string }>, total: number, root: string): string {
  const codes = new Set(failed.map((f) => codeOf(f.message) ?? 'bad_argument'))
  const code: McpErrorCode = codes.size === 1 ? [...codes][0]! : 'bad_argument'
  const listed = failed.slice(0, BATCH_REFUSAL_LINES).map((f) => `- ${f.path}${f.name ? ` (${JSON.stringify(f.name)})` : ''}: ${entryText(f.message, f.path)}`)
  if (failed.length > BATCH_REFUSAL_LINES) listed.push(`- and ${failed.length - BATCH_REFUSAL_LINES} more`)
  // the contract's shape over several lines: code and path first, the list, then "Nothing was changed." and the next step
  return `${code}: ${root}: ${failed.length} of ${total} ${root} do not fit:\n${listed.join('\n')}\nNothing was changed. Fix those ${root} (or leave them out) and send the call again.`
}
