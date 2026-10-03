/** Ready-made automations + validation helpers. */
import { useWorkspace } from '../../store/store'
import type { Automation, AutomationAction, Database, ID, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
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

function valueName(prop: PropertyDef, value: PropertyValue): string {
  if (prop.type === 'checkbox') return value ? t('features.auto.checked') : t('features.auto.unchecked')
  const one = Array.isArray(value) ? value[0] : value
  if (prop.options) return prop.options.find((o) => o.id === one)?.name ?? '—'
  if (prop.type === 'person') return useWorkspace.getState().people.find((p) => p.id === one)?.name ?? '—'
  if (one && typeof one === 'object') return (one as { start?: string }).start ?? '—'
  return one === null || one === '' ? '—' : String(one)
}

/**
 * Self-describing name that follows the configuration:
 * "New row → Webhook", "Status = Done → Notify", "Status = Done → Set Completed".
 */
export function autoName(a: Pick<Automation, 'trigger' | 'actions'>, db: Database): string {
  const trig = a.trigger
  let when: string
  if (trig.type === 'property_changed') {
    const prop = db.properties.find((p) => p.id === trig.propertyId)
    if (!prop) when = t('features.auto.nm.anyChange')
    else if (trig.toValue === undefined) when = t('features.auto.nm.changes', { prop: prop.name })
    else when = `${prop.name} = ${valueName(prop, trig.toValue)}`
  } else when = t(`features.auto.nm.${trig.type}`)
  const then = a.actions
    .map((act) => (act.type === 'set_property' ? t('features.auto.nm.set', { prop: db.properties.find((p) => p.id === act.propertyId)?.name ?? '…' }) : t(`features.auto.nm.${act.type}`)))
    .join(' + ')
  return then ? `${when} → ${then}` : when
}

/** Is this name still the generated one (then it keeps following the configuration)? */
export function isAutoName(a: Automation, db: Database): boolean {
  const name = a.name.trim()
  return !name || name === t('features.auto.untitled') || name === autoName(a, db)
}

/** The date property the stamp recipe writes ("Completed"), if the database has one. */
const stampProp = (db: Database) => db.properties.find((p) => p.type === 'date' && /complet|done|finish|erledigt|abgeschlossen/i.test(p.name))

/** Why a recipe can't be added to this database (null = it can). */
export function recipeHint(db: Database, id: RecipeId): string | null {
  if (id === 'webhook_new') return null
  if (!doneOption(statusProp(db))) return t('features.auto.recipe.needsStatus')
  // it would add a "Completed" property: a locked database keeps its properties (database/model/lock.ts)
  if (id === 'stamp_done' && db.locked && !stampProp(db)) return t('features.auto.recipe.needsUnlock')
  return null
}


/** Build the automation for a recipe (may add a "Completed" date property for the stamp recipe). */
export function makeRecipe(dbId: ID, id: RecipeId): Automation | null {
  const db = useWorkspace.getState().databases[dbId]
  if (!db) return null
  const base = { id: newId(), lastRunAt: null, lastStatus: null, lastMessage: null }
  if (id === 'webhook_new') {
    const a: Automation = { ...base, name: '', enabled: false, trigger: { type: 'row_created' }, actions: [{ type: 'webhook', url: '', method: 'POST' }] }
    return { ...a, name: autoName(a, db) }
  }
  const status = statusProp(db)
  const done = doneOption(status)
  if (!status || !done) return null
  if (id === 'notify_done') {
    const a: Automation = {
      ...base,
      name: '',
      enabled: true,
      trigger: { type: 'property_changed', propertyId: status.id, toValue: done.id },
      actions: [{ type: 'notify', message: t('features.auto.recipe.notify.msg', { done: done.name }) }],
    }
    return { ...a, name: autoName(a, db) }
  }
  // stamp a date when done
  let dateProp = stampProp(db)
  if (!dateProp && db.locked) return null
  if (!dateProp) {
    const pid = useWorkspace.getState().addProperty(dbId, { type: 'date', name: t('features.auto.recipe.stamp.prop') })
    dateProp = useWorkspace.getState().databases[dbId]?.properties.find((p) => p.id === pid)
  }
  if (!dateProp) return null
  const a: Automation = {
    ...base,
    name: '',
    enabled: true,
    trigger: { type: 'property_changed', propertyId: status.id, toValue: done.id },
    actions: [{ type: 'set_property', propertyId: dateProp.id, value: '@today' }],
  }
  const fresh = useWorkspace.getState().databases[dbId] ?? db
  return { ...a, name: autoName(a, fresh) }
}

export function blankAutomation(db: Database): Automation {
  const a: Automation = { id: newId(), name: '', enabled: false, trigger: { type: 'row_created' }, actions: [{ type: 'notify', message: '' }], lastRunAt: null, lastStatus: null, lastMessage: null }
  return { ...a, name: autoName(a, db) }
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
