/**
 * Workspace page § 04 — Automation: one read-only overview of what runs or is built to be reused — the
 * coding worker, custom agents, scripts, custom functions, database automations, own database commands,
 * repeating entries and own templates: name, where, on / off, the last run when this device knows it, and
 * the way to each. Team workspaces: API tokens and webhooks (owners and admins manage them) at the end.
 */
import { useEffect, type ReactNode } from 'react'
import { Bot, CalendarClock, Command, GitBranch, LayoutTemplate, SquareCode, SquareFunction, Workflow, type LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { Automation as DbAutomation, ID } from '../../store/types'
import { activeWorkspace } from '../../cloud'
import { navigate } from '../../lib/router'
import { agentTriggerText, codingWorkerStateText, formatRun, loadAgentRuns, loadScriptRuns, nextRun, openCodingSettings, templateName, useAgentRuns, useCoding, useScriptRuns, codingDbId } from '../../features'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import type { Translate } from '@/shared/i18n'
import { fmtRelative } from '../lib/format'
import { useInCloud } from '../cloud/state'
import { TeamApi, type TeamData } from '../cloud/Team'
import { useAutomationInventory, inventoryCount } from './automation'
import { GoKey, SectionHead, SubHead } from './parts'

type LedState = 'ok' | 'on' | 'off'

interface Item {
  key: string
  name: string
  where: string
  tag?: string
  /** ok = runs on its trigger · off = switched off · on = attention (the last run failed) · null = no switch */
  led: LedState | null
  last?: string | null
  open: () => void
  openLabel: string
}

export function AutomationSection({ team }: { team: TeamData }) {
  const t = useT()
  const lang = useLang()
  const inv = useAutomationInventory()
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const inCloud = useInCloud()
  const agentRuns = useAgentRuns((s) => s.byAgent)
  const scriptRuns = useScriptRuns((s) => s.byScript)
  const title = (id: ID) => pages[id]?.title.trim() || t('common.untitled')
  const ago = (at: number) => fmtRelative(at, lang, t('shell.ws.auto.justNow'))
  const ui = useUI.getState()

  // this device's runs (IndexedDB) — read once per visit, never written here
  const agentIds = inv.agents.map((a) => a.id).join(',')
  const scriptIds = inv.scripts.map((s) => s.id).join(',')
  useEffect(() => {
    for (const id of agentIds.split(',').filter(Boolean)) void loadAgentRuns(id).catch(() => null)
  }, [agentIds])
  useEffect(() => {
    for (const id of scriptIds.split(',').filter(Boolean)) void loadScriptRuns(id).catch(() => null)
  }, [scriptIds])
  const scope = (() => {
    const ref = activeWorkspace()
    return `${ref.kind}:${ref.id}`
  })()

  const groups: Array<{ id: string; icon: LucideIcon; items: Item[]; empty: string; add?: { label: string; run: () => void } }> = [
    {
      id: 'agents',
      icon: Bot,
      empty: t('shell.ws.auto.agentsEmpty'),
      add: { label: t('shell.ws.auto.agentsOpen'), run: () => navigate({ name: 'agents' }) },
      items: inv.agents.map((a) => {
        const run = agentRuns[a.id]?.[0]
        return {
          key: a.id,
          name: a.name,
          where: agentTriggerText(t, a.trigger, { pages, databases, lang }),
          tag: t(`shell.ws.auto.runner.${a.runner}`),
          led: !a.enabled ? 'off' : run && (run.status === 'error' || run.status === 'budget') ? 'on' : 'ok',
          last: run ? `${ago(run.startedAt)} · ${t(`shell.ws.auto.agentRun.${run.status}`)}` : null,
          open: () => navigate({ name: 'agents', id: a.id }),
          openLabel: t('shell.ws.auto.open'),
        }
      }),
    },
    {
      id: 'scripts',
      icon: SquareCode,
      empty: t('shell.ws.auto.scriptsEmpty'),
      add: { label: t('shell.ws.auto.scriptsOpen'), run: () => navigate({ name: 'scripts' }) },
      items: inv.scripts.map((s) => {
        const run = scriptRuns[`${scope}|${s.id}`]?.[0]
        return {
          key: s.id,
          name: s.name,
          where: s.description?.trim() || t(`shell.ws.auto.scriptKind.${s.kind}`),
          tag: t(`shell.ws.auto.scriptKind.${s.kind}`).toUpperCase(),
          led: run?.status === 'error' ? 'on' : null,
          last: run ? `${ago(run.at)} · ${t(`shell.ws.auto.scriptRun.${run.status}`)}${run.mode === 'dry' ? ` · ${t('shell.ws.auto.dry')}` : ''}` : null,
          open: () => navigate({ name: 'scripts', id: s.id }),
          openLabel: t('shell.ws.auto.open'),
        }
      }),
    },
    {
      id: 'functions',
      icon: SquareFunction,
      empty: t('shell.ws.auto.functionsEmpty'),
      add: { label: t('shell.ws.auto.functionsOpen'), run: () => ui.openModal({ type: 'functions' }) },
      items: inv.functions.map((f) => ({
        key: f.id,
        name: `${f.name}(${f.params.map((p) => p.name).join('; ')})`,
        where: f.description?.trim() || t('shell.ws.auto.fnWhere'),
        tag: 'ƒx',
        led: null,
        open: () => ui.openModal({ type: 'functions', id: f.id }),
        openLabel: t('shell.ws.auto.edit'),
      })),
    },
    {
      id: 'automations',
      icon: Workflow,
      empty: t('shell.ws.auto.automationsEmpty'),
      items: inv.automations.map(({ dbId, automation: a }) => ({
        key: `${dbId}:${a.id}`,
        name: a.name.trim() || t('shell.ws.auto.unnamed'),
        where: `${title(dbId)} · ${automationTrigger(t, a, databases[dbId]?.properties ?? [])}`,
        tag: a.actions.length === 1 ? t(`shell.ws.auto.action.${a.actions[0].type}`).toUpperCase() : t('shell.ws.auto.actions', { n: a.actions.length }),
        led: !a.enabled ? 'off' : a.lastStatus === 'error' ? 'on' : 'ok',
        last: a.lastRunAt ? `${ago(a.lastRunAt)} · ${a.lastStatus === 'error' ? t('shell.ws.auto.failed') : t('shell.ws.auto.ok')}` : null,
        open: () => ui.openModal({ type: 'automations', databaseId: dbId }),
        openLabel: t('shell.ws.auto.edit'),
      })),
    },
    {
      id: 'commands',
      icon: Command,
      empty: t('shell.ws.auto.commandsEmpty'),
      items: inv.commands.map(({ dbId, command: c }) => ({
        key: `${dbId}:${c.id}`,
        name: c.label?.trim() || t('shell.ws.auto.unnamed'),
        where: title(dbId),
        tag: (['actions', 'agent', 'view', 'script'].includes(c.kind) ? t(`shell.ws.auto.cmdKind.${c.kind}`) : c.kind).toUpperCase(),
        led: c.hidden ? 'off' : null,
        open: () => ui.openModal({ type: 'dbCommands', databaseId: dbId }),
        openLabel: t('shell.ws.auto.edit'),
      })),
    },
    {
      id: 'repeating',
      icon: CalendarClock,
      empty: t('shell.ws.auto.repeatingEmpty'),
      items: inv.repeating.map(({ dbId, template }) => {
        const next = nextRun(template.repeat)
        return {
          key: `${dbId}:${template.id}`,
          name: template.name.trim() || t('shell.ws.auto.unnamed'),
          where: `${title(dbId)} · ${t(`shell.ws.auto.freq.${template.repeat!.freq}`)} · ${template.repeat!.time}`,
          tag: next ? t('shell.ws.auto.next', { at: formatRun(next.at, lang) }) : t('shell.ws.auto.ended'),
          led: next ? 'ok' : 'off',
          last: template.repeat?.lastRunAt ? ago(template.repeat.lastRunAt) : null,
          open: () => navigate({ name: 'page', id: dbId }),
          openLabel: t('shell.ws.auto.open'),
        }
      }),
    },
    {
      id: 'templates',
      icon: LayoutTemplate,
      empty: t('shell.ws.auto.templatesEmpty'),
      add: { label: t('shell.ws.auto.templatesOpen'), run: () => ui.openModal({ type: 'templates', parentId: null, tab: 'mine' }) },
      items: inv.templates.map((p) => ({
        key: p.id,
        name: templateName(p),
        where: p.template?.from ? t('shell.ws.auto.tplCustomised') : t('shell.ws.auto.tplOwn'),
        led: null,
        open: () => ui.openModal({ type: 'templates', parentId: null, tab: 'mine', select: p.id }),
        openLabel: t('shell.ws.auto.open'),
      })),
    },
  ]

  return (
    <>
      <SectionHead n="04" title={t('shell.ws.sec.automation')} lead={t('shell.ws.auto.lead', { n: inventoryCount(inv) })} />
      <CodingPlate />
      {groups.map((g) => (
        <Group key={g.id} id={g.id} icon={g.icon} label={t(`shell.ws.auto.group.${g.id}`)} items={g.items} empty={g.empty} add={g.add} />
      ))}
      {inCloud && team.wsId && (
        <div className="wsp-api">
          <TeamApi wsId={team.wsId} admin={team.admin} />
        </div>
      )}
    </>
  )
}

function automationTrigger(t: Translate, a: DbAutomation, props: Array<{ id: ID; name: string }>): string {
  if (a.trigger.type === 'row_created') return t('shell.ws.auto.trig.created')
  if (a.trigger.type === 'row_deleted') return t('shell.ws.auto.trig.deleted')
  const pid = a.trigger.propertyId
  const prop = pid ? props.find((p) => p.id === pid) : undefined
  return prop ? t('shell.ws.auto.trig.changedProp', { prop: prop.name }) : t('shell.ws.auto.trig.changed')
}

function Group({ id, icon: Icon, label, items, empty, add }: { id: string; icon: LucideIcon; label: string; items: Item[]; empty: string; add?: { label: string; run: () => void } }) {
  const headId = `wsp-auto-${id}`
  return (
    <section className="wsp-group" aria-labelledby={headId} data-testid={`ws-auto-${id}`}>
      <SubHead label={label} count={items.length} id={headId}>
        <span className="wsp-group__icon" aria-hidden>
          <Icon size={14} strokeWidth={1.75} />
        </span>
      </SubHead>
      {items.length === 0 ? (
        <p className="wsp-empty">
          <span>{empty}</span>
          {add && <GoKey label={add.label} onClick={add.run} />}
        </p>
      ) : (
        <ul className="wsp-autos">
          {items.map((it) => (
            <li key={it.key} className="wsp-auto" data-testid="ws-auto-item">
              <span className="wsp-auto__led">{it.led ? <Led state={it.led} /> : <span className="wsp-auto__dot" aria-hidden />}</span>
              <span className="wsp-auto__who">
                <span className="wsp-auto__name">{it.name}</span>
                <span className="wsp-auto__where">{it.where}</span>
              </span>
              <span className="wsp-auto__side">
                {it.tag && <span className="wsp-auto__tag">{it.tag}</span>}
                {it.last && <span className="wsp-auto__last">{it.last}</span>}
              </span>
              <GoKey label={it.openLabel} onClick={it.open} ariaLabel={`${it.openLabel}: ${it.name}`} />
            </li>
          ))}
          {add && (
            <li className="wsp-auto wsp-auto--add">
              <GoKey label={add.label} onClick={add.run} />
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

/** The coding worker on this device: its link, what runs, the Coding database — #/coding and its settings. */
function CodingPlate() {
  const t = useT()
  const s = useCoding(useShallow((c) => ({ enabled: c.enabled, conn: c.conn, worker: c.worker, busy: c.busy, refused: c.refused })))
  const tasks = useWorkspace((w) => {
    const dbId = codingDbId()
    if (!dbId) return null
    let n = 0
    for (const id of Object.keys(w.pages)) {
      const p = w.pages[id]
      if (p.databaseId === dbId && !p.trashed) n++
    }
    return n
  })
  const led: LedState = !s.enabled ? 'off' : s.conn === 'connected' ? (s.busy.length ? 'on' : 'ok') : 'off'
  const rest: ReactNode = tasks === null ? t('shell.ws.auto.codingNoDb') : t(tasks === 1 ? 'shell.ws.auto.codingTask' : 'shell.ws.auto.codingTasks', { n: tasks })
  return (
    <div className="wsp-coding" data-testid="ws-coding">
      <span className="wsp-coding__icon" aria-hidden>
        <GitBranch size={17} strokeWidth={1.7} />
      </span>
      <div className="wsp-coding__text">
        <span className="label">{t('shell.ws.auto.coding')}</span>
        <span className="wsp-coding__state">
          <Led state={led} />
          {codingWorkerStateText(t, s)}
        </span>
        <span className="wsp-coding__meta">{rest}</span>
      </div>
      <div className="wsp-coding__keys">
        <GoKey label={t('shell.ws.auto.codingOpen')} onClick={() => navigate({ name: 'coding' })} testId="ws-coding-open" />
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => openCodingSettings()}>
          {t('shell.ws.auto.codingSettings')}
        </button>
      </div>
    </div>
  )
}
