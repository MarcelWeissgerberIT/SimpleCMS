/**
 * Created by / Last edited by (created_by / last_edited_by) and "Me" in person filters.
 *
 * Who a row's creator / last editor is:
 *  - team workspace: Page.createdBy / updatedBy from the meta document — an account id (= the
 *    person id of that member), `api:<tokenId>` (public API) or `hook:<hookId>` (incoming webhook).
 *    A row without them (not stamped yet) shows nothing.
 *  - local workspace: the fields are absent and there is exactly one author, so both properties
 *    always hold LOCAL_ACTOR: the local user — shown as their own person when the workspace has one
 *    (localPerson), else as "You" / settings.userName.
 *
 * "Me" is stored as the filter value ME_TOKEN and resolved each time a filter runs, so a saved view
 * shows every member their own rows:
 *  - team workspace: the signed-in account id (person, created_by, last_edited_by)
 *  - local workspace: LOCAL_ACTOR for created_by / last_edited_by (every row matches); for person
 *    properties the workspace person named like settings.userName — or, without a name, "You" / "Du"
 *    (the demo workspace's own person, whichever language it was seeded in) — case-insensitive;
 *    nobody when there is no such person.
 */
import type { Page, Person, PropertyDef } from '../../store/types'
import { peopleMessages } from '../people-messages'

export const LOCAL_ACTOR = '@local'
export const ME_TOKEN = '@me'

export interface MeCtx {
  /** The signed-in account id in a team workspace; null in the local workspace. */
  id: string | null
  /** settings.userName ('' = not set). */
  name: string
}

export type ActorKind = 'person' | 'api' | 'hook' | 'local' | 'unknown'

export const isActorType = (t: PropertyDef['type']): t is 'created_by' | 'last_edited_by' => t === 'created_by' || t === 'last_edited_by'

/** The actor id a created_by / last_edited_by property shows for a row (null = unknown). */
export function actorOf(prop: PropertyDef, row: Page, me: MeCtx): string | null {
  if (me.id === null) return LOCAL_ACTOR
  const v = prop.type === 'created_by' ? row.createdBy : row.updatedBy
  return typeof v === 'string' && v ? v : null
}

export function actorKind(id: string, people: Person[]): ActorKind {
  if (id === LOCAL_ACTOR) return 'local'
  if (id.startsWith('api:')) return 'api'
  if (id.startsWith('hook:')) return 'hook'
  return people.some((p) => p.id === id) ? 'person' : 'unknown'
}

export interface ActorLabels {
  you: string
  api: string
  webhook: string
  unknown: string
}

/** Display name of an actor id. */
export function actorName(id: string, people: Person[], me: MeCtx, labels: ActorLabels): string {
  switch (actorKind(id, people)) {
    case 'local':
      return me.name.trim() || labels.you
    case 'api':
      return labels.api
    case 'hook':
      return labels.webhook
    case 'person':
      return people.find((p) => p.id === id)!.name
    default:
      return labels.unknown
  }
}

type MeLookup = { me: MeCtx; people: Person[]; labels: Pick<ActorLabels, 'you'> }

/** The demo workspace's own person in every language it is seeded in ("You", "Du"): the language can change later. */
const DEMO_YOU = new Set(Object.values(peopleMessages).map((m) => (m['database.actor.you'] ?? '').trim().toLowerCase()).filter(Boolean))

/** Local workspace: the local user's own person — named like settings.userName, or "You" (the demo's). */
export function localPerson(ctx: MeLookup): Person | null {
  const named = ctx.me.name.trim().toLowerCase()
  if (named) return ctx.people.find((p) => p.name.trim().toLowerCase() === named) ?? null
  const you = ctx.labels.you.trim().toLowerCase()
  const norm = (p: Person) => p.name.trim().toLowerCase()
  return ctx.people.find((p) => norm(p) === you) ?? ctx.people.find((p) => DEMO_YOU.has(norm(p))) ?? null
}

/** What ME_TOKEN stands for on a property (null = nobody). */
export function resolveMe(prop: PropertyDef, ctx: MeLookup): string | null {
  if (ctx.me.id !== null) return ctx.me.id
  if (isActorType(prop.type)) return LOCAL_ACTOR
  return localPerson(ctx)?.id ?? null
}
