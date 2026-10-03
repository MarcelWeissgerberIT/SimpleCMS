/**
 * Resolver contexts built outside React (plain-text values, view rows for exports) and who "Me" is.
 */
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import type { Translate } from '@/shared/i18n'
import type { Ctx } from './resolve'
import type { MeCtx } from './actors'

/** The signed-in account in a team workspace; in the local workspace only the local user's name. */
export function currentMe(): MeCtx {
  const c = useCloud.getState()
  return { id: c.active.kind === 'cloud' ? (c.user?.id ?? null) : null, name: useWorkspace.getState().settings.userName }
}

export function resolverLabels(tr: Translate): Ctx['labels'] {
  return {
    today: tr('database.date.today'),
    tomorrow: tr('database.date.tomorrow'),
    yesterday: tr('database.date.yesterday'),
    untitled: tr('common.untitled'),
    yes: tr('database.yes'),
    no: tr('database.no'),
    you: tr('database.actor.you'),
    api: tr('database.actor.api'),
    webhook: tr('database.actor.webhook'),
    unknown: tr('database.actor.unknown'),
  }
}

/** A resolver context for the current workspace state. */
export function workspaceCtx(me: MeCtx = currentMe()): Ctx {
  const s = useWorkspace.getState()
  return { pages: s.pages, databases: s.databases, people: s.people, lang: s.settings.language, now: Date.now(), labels: resolverLabels(t), me }
}
