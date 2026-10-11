/**
 * Who a task's reminder rings for — pure. Locally a reminder always rings. In a team workspace a task with
 * people rings only for them (when I am one of them); a task with nobody assigned — or with only people who
 * are not members (no account to ring for) — rings for every member.
 */

export interface AudienceCtx {
  /** a team workspace */
  team: boolean
  /** the signed-in member's account id (null locally / unknown) */
  me: string | null
  /** the workspace's member account ids (null: not known yet — then every assigned person counts as one) */
  members: ReadonlySet<string> | null
}

/** Does this task's reminder ring on this device? */
export function ringsHere(people: readonly string[] | null | undefined, ctx: AudienceCtx): boolean {
  if (!ctx.team || !people?.length) return true
  if (ctx.me && people.includes(ctx.me)) return true
  return ctx.members !== null && !people.some((p) => ctx.members!.has(p))
}

type T = (key: string, vars?: Record<string, string | number>) => string

/** "Alex and Mara" / "Alex und Mara" (Intl list, the UI's language). */
export function joinNames(names: readonly string[], lang: string): string {
  try {
    return new Intl.ListFormat(lang, { type: 'conjunction', style: 'long' }).format(names)
  } catch {
    return names.join(', ')
  }
}

/**
 * The due picker's audience line (team workspaces only; null locally): "Rings for every member — nobody is
 * assigned." · "Rings for Alex and Mara." · "Rings for every member — no member is assigned."
 */
export function audienceText(people: readonly string[], ctx: AudienceCtx, nameOf: (id: string) => string | null, t: T, lang: string): string | null {
  if (!ctx.team) return null
  if (!people.length) return t('features.workItems.audience.everyone')
  const members = ctx.members === null ? people : people.filter((p) => ctx.members!.has(p))
  if (!members.length) return t('features.workItems.audience.noMember')
  const names = members.map((id) => nameOf(id)).filter((n): n is string => !!n)
  if (!names.length) return t('features.workItems.audience.noMember')
  return t('features.workItems.audience.people', { names: joinNames(names, lang) })
}
