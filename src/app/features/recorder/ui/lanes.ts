/**
 * The tracks on the tape: what a lane is called (long name + sub, the phone's short name, the full title), its icon,
 * which lanes show (those with Vorgänge in the span + "Du" + the selected one, minus the filter) and in what order:
 * Du · Undo · members · AI terminal · AI menu · agents · MCP · scripts · sync · automations · import · templates ·
 * others · team · unknown. Names of agents, scripts and automations are read live from the workspace (data).
 */
import type { LucideIcon } from 'lucide-react'
import { Blocks, Bot, CircleHelp, Code, FileDown, FolderSync, GitBranch, LayoutTemplate, Mail, MessageSquareText, Plug, ScrollText, Terminal, Undo2, Upload, User, Users, Wand, Webhook, Workflow } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { Workspace } from '../../../store/types'
import type { LaneKey } from '../model/types'

export interface LaneMeta {
  lane: LaneKey
  icon: LucideIcon | null
  /** members: initials on a chip instead of an icon */
  initials?: string
  name: string
  /** "· Nordlicht-Spiegel" (without the dot) */
  sub?: string
  /** the phone's name */
  short: string
  /** the full name (title, aria) */
  title: string
  /** sort group, then name */
  group: number
}

type WsNames = Pick<Workspace, 'agents' | 'scripts' | 'databases' | 'settings'>

const GROUP: Record<string, number> = { you: 0, undo: 1, member: 2, terminal: 3, ai: 4, agent: 5, mcp: 6, script: 7, sync: 8, automation: 9, import: 10, template: 11, team: 13, unknown: 14 }

/** The kind part of a lane key ('agent:x' → 'agent'). */
export const laneKind = (lane: LaneKey): string => (lane.includes(':') ? lane.slice(0, lane.indexOf(':')) : lane)

const SIMPLE: Record<string, { icon: LucideIcon; name: string; short?: string }> = {
  undo: { icon: Undo2, name: 'undo' },
  terminal: { icon: Terminal, name: 'terminal', short: 'terminalShort' },
  ai: { icon: MessageSquareText, name: 'ai', short: 'aiShort' },
  autofill: { icon: Wand, name: 'autofill' },
  import: { icon: Upload, name: 'import' },
  template: { icon: LayoutTemplate, name: 'template' },
  mail: { icon: Mail, name: 'mail' },
  coding: { icon: GitBranch, name: 'coding' },
  kit: { icon: Blocks, name: 'kit', short: 'kitShort' },
  api: { icon: Code, name: 'api' },
  hook: { icon: Webhook, name: 'hook' },
  team: { icon: Users, name: 'team' },
  unknown: { icon: CircleHelp, name: 'unknown' },
}

export function laneMeta(lane: LaneKey, t: Translate, ws: WsNames): LaneMeta {
  const kind = laneKind(lane)
  const id = lane.slice(kind.length + 1)
  const k = (key: string) => t(`features.recorder.lane.${key}`)
  const group = GROUP[kind] ?? 12
  const make = (icon: LucideIcon | null, name: string, sub?: string, short?: string): LaneMeta => ({ lane, icon, name, ...(sub ? { sub } : {}), short: short ?? name, title: sub ? `${name} · ${sub}` : name, group })
  switch (kind) {
    case 'you': {
      const me = ws.settings.userName?.trim()
      return make(User, k('you'), me || undefined)
    }
    case 'agent': {
      const a = ws.agents?.[id]
      return make(Bot, k('agent'), a?.name || k('gone'))
    }
    case 'script': {
      const s = ws.scripts?.[id]
      return make(ScrollText, k('script'), s?.name || (id === '-' ? undefined : k('gone')))
    }
    case 'mcp':
      return make(Plug, k('mcp'), id && id !== '-' ? id : undefined)
    case 'sync':
      return make(FolderSync, k('sync'), id === 'github' ? k('syncGitHub') : k('syncFolder'))
    case 'automation': {
      const [db, auto] = id.split('/')
      const a = ws.databases[db]?.automations?.find((x) => x.id === auto)
      return make(Workflow, k('automation'), a?.name || k('gone'))
    }
    case 'member': {
      // R5: the member's name and colour; until then the account id's start
      const short = id.slice(0, 6)
      return { ...make(null, k('member'), short), initials: short.slice(0, 2).toUpperCase(), short }
    }
    default: {
      const s = SIMPLE[kind]
      if (s) return make(s.icon, k(s.name), undefined, s.short ? k(s.short) : undefined)
      return make(FileDown, kind)
    }
  }
}

/** Lanes in the tape's order. */
export function sortLanes(metas: LaneMeta[]): LaneMeta[] {
  return [...metas].sort((a, b) => a.group - b.group || (a.sub ?? a.name).localeCompare(b.sub ?? b.name) || (a.lane < b.lane ? -1 : 1))
}

/** The lanes shown: with Vorgänge in the span, "Du" always, the selected one — minus the hidden ones. */
export function visibleLanes(withOps: Iterable<LaneKey>, selected: LaneKey | null, hidden: LaneKey[] | null): LaneKey[] {
  const set = new Set<LaneKey>(['you', ...withOps])
  if (selected) set.add(selected)
  // system writes never get a track
  set.delete('system')
  if (hidden) for (const l of hidden) if (l !== selected) set.delete(l)
  return [...set]
}
