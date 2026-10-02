/** Ready-made automations + validation helpers. */
import { useWorkspace } from '../../store/store'
import type { Automation, AutomationAction, Database, ID, PropertyDef, SelectOption } from '../../store/types'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import { isValidWebhookUrl } from './engine'

export type RecipeId = 'webhook_new' | 'notify_done' | 'stamp_done'

/** Properties an action can write / a trigger can watch. */
export const SETTABLE = new Set<PropertyDef['type']>(['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone', 'rating'])

export function statusProp(db: Database): PropertyDef | undefined {
  return db.properties.find((p) => p.type === 'status') ?? db.properties.find((p) => p.type === 'select' && /status|state|stage/i.test(p.name))
}

export function doneOption(prop: PropertyDef | undefined): SelectOption | undefined {
  const opts = prop?.options ?? []
  return opts.find((o) => o.group === 'done') ?? opts.find((o) => /done|complete|erledigt|fertig|shipped|closed/i.test(o.name)) ?? opts[opts.length - 1]
}

export function recipeAvailable(db: Database, id: RecipeId): boolean {
  if (id === 'webhook_new') return true
  return !!doneOption(statusProp(db))
}

/** Build the automation for a recipe (may add a "Completed" date property for the stamp recipe). */
export function makeRecipe(dbId: ID, id: RecipeId): Automation | null {
  const db = useWorkspace.getState().databases[dbId]
  if (!db) return null
  const base = { id: newId(), lastRunAt: null, lastStatus: null, lastMessage: null }
  if (id === 'webhook_new') {
    return { ...base, name: t('features.auto.recipe.webhook.name'), enabled: false, trigger: { type: 'row_created' }, actions: [{ type: 'webhook', url: '', method: 'POST' }] }
  }
  const status = statusProp(db)
  const done = doneOption(status)
  if (!status || !done) return null
  if (id === 'notify_done') {
    return {
      ...base,
      name: t('features.auto.recipe.notify.name', { status: status.name, done: done.name }),
      enabled: true,
      trigger: { type: 'property_changed', propertyId: status.id, toValue: done.id },
      actions: [{ type: 'notify', message: t('features.auto.recipe.notify.msg', { done: done.name }) }],
    }
  }
  // stamp a date when done
  let dateProp = db.properties.find((p) => p.type === 'date' && /complet|done|finish|erledigt|abgeschlossen/i.test(p.name))
  if (!dateProp) {
    const pid = useWorkspace.getState().addProperty(dbId, { type: 'date', name: t('features.auto.recipe.stamp.prop') })
    dateProp = useWorkspace.getState().databases[dbId]?.properties.find((p) => p.id === pid)
  }
  if (!dateProp) return null
  return {
    ...base,
    name: t('features.auto.recipe.stamp.name', { done: done.name }),
    enabled: true,
    trigger: { type: 'property_changed', propertyId: status.id, toValue: done.id },
    actions: [{ type: 'set_property', propertyId: dateProp.id, value: '@today' }],
  }
}

export function blankAutomation(): Automation {
  return { id: newId(), name: t('features.auto.untitled'), enabled: false, trigger: { type: 'row_created' }, actions: [{ type: 'notify', message: '' }], lastRunAt: null, lastStatus: null, lastMessage: null }
}

export function blankAction(type: AutomationAction['type'], db: Database): AutomationAction {
  if (type === 'webhook') return { type: 'webhook', url: '', method: 'POST' }
  if (type === 'notify') return { type: 'notify', message: '' }
  const prop = db.properties.find((p) => p.type === 'checkbox') ?? db.properties.find((p) => SETTABLE.has(p.type) && p.type !== 'title')
  return { type: 'set_property', propertyId: prop?.id ?? '', value: prop?.type === 'checkbox' ? true : null }
}

/** First configuration problem (null = runnable). */
export function problemOf(a: Automation, db: Database): string | null {
  if (!a.actions.length) return t('features.auto.problem.noActions')
  if (a.trigger.type === 'property_changed' && a.trigger.propertyId && !db.properties.some((p) => p.id === (a.trigger as { propertyId: ID }).propertyId))
    return t('features.auto.problem.prop')
  for (const act of a.actions) {
    if (act.type === 'webhook' && !isValidWebhookUrl(act.url)) return t('features.auto.problem.url')
    if (act.type === 'set_property' && !db.properties.some((p) => p.id === act.propertyId)) return t('features.auto.problem.setProp')
  }
  return null
}
