/**
 * The mirror agent's instructions when a recipe brings none of its own: composed from the recipe's properties, so
 * they name only what its database has. Pure (the translator comes in), `{db}` / `{server}` stay tokens.
 *
 *  - a part tied to a role (Link, Clarity, Waiting on me …) is there only when a property has that role
 *  - "never write" lists the properties marked "Only by hand" — by name, whatever their role
 *  - properties without a built-in role (and not the title, the key or the person's own) are written "as in the
 *    source", listed with the item's other fields
 *  - the placeholders ([HOW TO LIST THE ITEMS] …) the person replaces: only the ones the steps use
 *
 * With every built-in role (the built-in recipe), this is exactly the built-in recipe's text.
 */
import type { Translate } from '@/shared/i18n'

export interface InstructionProperty {
  role?: string
  name: string
  type: string
  key: boolean
  onlyByHand: boolean
  /** option names (select / status) in the instructions' language */
  options?: string[]
}

/** Roles of the item's fields the agent copies from the source (step 4, in this order of the built-in recipe). */
const SOURCE_ROLES = ['link', 'srcStatus', 'srcPriority', 'owner', 'tags', 'changedAt', 'comments', 'lastComment', 'lastCommentAt']
/** Roles that mean the agent reads the item's comments. */
const COMMENT_ROLES = ['comments', 'lastComment', 'lastCommentAt', 'newComment', 'waiting']

/** "a, b and c" / "a, b oder c" */
function joinList(items: string[], last: string): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`
}

/**
 * The instructions for these properties. `weekday`: the agent runs every weekday (the intro says so). The placeholders
 * are the built-in ones (features.agents.mirror.ph.*: list, read — readItem for items without comments —, me, clear).
 */
export function composeMirrorInstructions(tr: Translate, props: InstructionProperty[], opts: { weekday: boolean; db?: string; server?: string }): string {
  const db = opts.db ?? '{db}'
  const server = opts.server ?? '{server}'
  const k = (key: string, vars?: Record<string, string | number>) => tr(`features.agents.mirror.instr.${key}`, vars)
  const and = k('and')
  const or = k('or')
  const byRole = (role: string) => props.find((p) => p.role === role && !p.onlyByHand)
  const name = (role: string) => byRole(role)?.name ?? ''

  const title = props.find((p) => p.type === 'title')
  const key = props.find((p) => p.key) ?? props.find((p) => p.role === 'key')
  // Clarity takes part only with options to choose from (the first one is what "clear" means)
  const clarity = byRole('clarity')
  const clarityOpts = clarity && (clarity.type === 'select' || clarity.type === 'status') ? (clarity.options ?? []) : []
  const hasClarity = !!clarity && clarityOpts.length > 0
  const clear = hasClarity ? clarityOpts[0] : ''
  const hasNew = byRole('newComment')?.type === 'checkbox'
  const hasWaiting = byRole('waiting')?.type === 'checkbox'
  const hasWhy = hasClarity && !!byRole('why')
  const hasGone = byRole('gone')?.type === 'checkbox'
  const readsComments = COMMENT_ROLES.some((r) => !!byRole(r))
  const aboutMe = hasNew || hasWaiting
  // roles that have their own step here
  const handled = new Set<string>([...(hasNew ? ['newComment'] : []), ...(hasWaiting ? ['waiting'] : []), ...(hasClarity ? ['clarity'] : []), ...(hasWhy ? ['why'] : []), ...(hasGone ? ['gone'] : [])])

  // the item's fields: the source roles in the built-in order, then every other property as in the source
  const fields: string[] = []
  for (const role of SOURCE_ROLES) {
    const p = byRole(role)
    if (!p || p === title || p === key) continue
    fields.push(role === 'comments' ? k('note.comments', { name: p.name }) : role === 'lastComment' ? k('note.lastComment', { name: p.name }) : p.name)
  }
  for (const p of props) {
    if (p === title || p === key || p.onlyByHand || (p.role && (SOURCE_ROLES.includes(p.role) || handled.has(p.role)))) continue
    fields.push(p.name)
  }
  const hand = props.filter((p) => p.onlyByHand && p.type !== 'title').map((p) => p.name)

  const ph = (which: string) => tr(`features.agents.mirror.ph.${which}`)
  const yours = [
    k('yours.list', { ph: ph('list') }),
    readsComments ? k('yours.read', { ph: ph('read') }) : k('yours.readItem', { ph: ph('readItem') }),
    ...(aboutMe ? [k('yours.me', { ph: ph('me'), server })] : []),
    ...(hasClarity ? [k('yours.clear', { ph: ph('clear'), clear })] : []),
  ]

  const steps: string[] = [
    k('readOnly', { server }),
    k(hasNew ? 'state' : 'stateLast'),
    k(readsComments ? 'list' : 'listItems'),
    k('write', { db, key: key?.name ?? '', plus: fields.length ? k('plus', { list: joinList(fields, and) }) : '' }),
  ]
  const marks = [...(hasNew ? [k('new', { new: name('newComment') })] : []), ...(hasWaiting ? [k('waiting', { waiting: name('waiting') })] : [])]
  if (marks.length) steps.push(marks.join(' '))
  if (hasClarity) steps.push([k('clarity', { clarity: clarity!.name, options: clarityOpts.join(' · '), clear }), ...(hasWhy ? [k('why', { why: name('why') })] : [])].join(' '))
  if (hand.length) steps.push(k(hand.length === 1 ? 'handOne' : 'hand', { list: joinList(hand, or) }))
  steps.push(hasGone ? k('gone', { server, gone: name('gone') }) : k('goneKeep', { server }))
  const notes = [...(aboutMe ? [k('notify.comment')] : []), ...(hasClarity ? [k('notify.clear', { clear })] : [])]
  if (notes.length) steps.push(k('notify', { what: notes.join(` ${and} `) }))
  steps.push(k(hasNew ? 'stateSet' : 'stateSetLast'))
  const more = [...(hasWaiting ? [k('report.waiting')] : []), ...(hasClarity ? [k('report.clear', { clear })] : [])]
  steps.push(k('report', { more: more.map((m) => `, ${m}`).join('') }))

  return [k(opts.weekday ? 'intro' : 'introAny', { db, server }), '', k('yours'), ...yours, '', k('fixed'), ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n')
}
