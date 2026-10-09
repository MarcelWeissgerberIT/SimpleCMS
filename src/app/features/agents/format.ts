/** Custom agents — read-outs: triggers in words, times, durations, money. */
import type { Translate } from '@/shared/i18n'
import type { AgentTrigger, CustomAgent, Database, ID, Page } from '../../store/types'
import { localTimeZone } from '../../store/agents'
import { nextSlot } from './schedule'
import type { AgentRun } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function weekdayName(day: number, lang: string, style: 'long' | 'short' = 'long'): string {
  // 2026-10-04 is a Sunday
  return new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 4 + day)))
}

/** "Daily · 08:00", "Mondays · 08:00 (UTC)", "New row in Mails" … */
export function triggerText(t: Translate, trigger: AgentTrigger, ctx: { pages: Record<ID, Page>; databases: Record<ID, Database>; lang: string }): string {
  const title = (id: ID) => ctx.pages[id]?.title.trim() || t('common.untitled')
  switch (trigger.type) {
    case 'manual':
      return t('features.agents.trig.manualText')
    case 'webhook':
      return t('features.agents.trig.webhookText')
    case 'row_created':
      return trigger.databaseId && ctx.pages[trigger.databaseId] ? t('features.agents.trig.createdText', { db: title(trigger.databaseId) }) : t('features.agents.trig.noDb')
    case 'row_changed': {
      if (!trigger.databaseId || !ctx.pages[trigger.databaseId]) return t('features.agents.trig.noDb')
      const prop = trigger.propertyId ? ctx.databases[trigger.databaseId]?.properties.find((p) => p.id === trigger.propertyId) : undefined
      return prop ? t('features.agents.trig.changedPropText', { db: title(trigger.databaseId), prop: prop.name }) : t('features.agents.trig.changedText', { db: title(trigger.databaseId) })
    }
    case 'schedule': {
      const tz = trigger.tz === localTimeZone() ? '' : ` (${trigger.tz})`
      if (trigger.every === 'hour') return `${t('features.agents.every.hourText', { min: trigger.at.slice(3) })}${tz}`
      if (trigger.every === 'week') return `${t('features.agents.every.weekText', { day: weekdayName(trigger.weekday ?? 1, ctx.lang) })} · ${trigger.at}${tz}`
      if (trigger.every === 'month') return `${t('features.agents.every.monthText', { day: trigger.day ?? 1 })} · ${trigger.at}${tz}`
      return `${t(`features.agents.every.${trigger.every}Text`)} · ${trigger.at}${tz}`
    }
  }
}

/** "Mon 05.10. · 08:00" in local time (today: "Today · 08:00"). */
export function fmtWhen(t: Translate, ms: number, lang: string, now = Date.now()): string {
  const d = new Date(ms)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = new Date(now)
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, day)) return `${t('features.agents.today')} · ${time}`
  const tomorrow = new Date(now + 86_400_000)
  if (same(d, tomorrow)) return `${t('features.agents.tomorrow')} · ${time}`
  const yesterday = new Date(now - 86_400_000)
  if (same(d, yesterday)) return `${t('features.agents.yesterday')} · ${time}`
  return `${weekdayName(d.getDay(), lang, 'short')} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. · ${time}`
}

/** The next run in words ('' when nothing is planned). */
export function nextRunText(t: Translate, agent: CustomAgent, lang: string, now = Date.now()): string {
  if (!agent.enabled) return t('features.agents.off')
  if (agent.trigger.type === 'schedule') {
    const at = nextSlot(agent.trigger, now)
    return at === null ? '—' : fmtWhen(t, at, lang, now)
  }
  if (agent.trigger.type === 'row_created' || agent.trigger.type === 'row_changed') return t('features.agents.next.onRow')
  if (agent.trigger.type === 'webhook') return t('features.agents.next.onHook')
  return t('features.agents.next.manual')
}

/** Money in the UI's language ("$3.00" · "3,00 $"): every caller passes the language (lib/money.ts). */
export { fmtUsd } from '../../lib/money'

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${pad(s % 60)}s` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`
}

/** Cost of the last `n` runs. */
export function recentCost(runs: AgentRun[], n = 10): number {
  return runs.slice(0, n).reduce((sum, r) => sum + (r.usage?.usd ?? 0), 0)
}

/** LED class of a run status. */
export function statusLed(status: AgentRun['status'] | 'off' | 'idle'): string {
  switch (status) {
    case 'running':
      return 'led led--on agx-led--live'
    case 'ok':
      return 'led led--ok'
    case 'staged':
      return 'led led--on'
    case 'error':
    case 'budget':
      return 'led agx-led--err'
    default:
      return 'led'
  }
}
