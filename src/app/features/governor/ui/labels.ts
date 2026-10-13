/**
 * #/regler's names for ledger sources (lazy chunk): who a consumer is (its label, icon, count line) and what it may do
 * (the DARF chip — G1 has no lever: what each kind of work does by itself). Names come from the workspace live (agents,
 * databases, properties); the ledger itself holds ids only.
 */
import { Blocks, Bot, Brain, CircleDot, CircleHelp, Command, Mail, MessagesSquare, Mic, Palette, PenLine, Plug, Send, SquareCode, SquareTerminal, TableProperties, Wand, type LucideIcon } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { CustomAgent, Database, Page } from '../../../store/types'
import { shortcutLabel } from '../../../ui/controls'
import type { ConsumerKind } from '../consumers'

export interface NameWorld {
  agents: Record<string, CustomAgent> | undefined
  databases: Record<string, Database>
  pages: Record<string, Page>
}

const ICONS: Record<ConsumerKind, LucideIcon> = {
  terminal: SquareTerminal,
  menu: Wand,
  agent: Bot,
  autofill: TableProperties,
  mail: Mail,
  outbox: Send,
  script: SquareCode,
  palette: Command,
  workspace: MessagesSquare,
  help: CircleHelp,
  memory: Brain,
  meeting: Mic,
  kit: Blocks,
  setup: Plug,
  mcp: Plug,
  design: Palette,
  writing: PenLine,
  other: CircleDot,
}

export const iconOf = (kind: ConsumerKind): LucideIcon => ICONS[kind]

/** A feature class's name as Settings › AI calls it ('mcp-setup' / 'generate' share the MCP row). */
const classLabel = (t: Translate, cls: string): string => t(`features.ai.prov.class.${cls === 'mcp-setup' || cls === 'generate' ? 'mcp' : cls}`)

const dbTitle = (w: NameWorld, id: string | undefined): string => (id ? w.pages[id]?.title.trim() : '') || ''

/** The consumer's name ("AI terminal", "Nordlicht mirror", "AI autofill · Launch plan" …). */
export function consumerName(t: Translate, kind: ConsumerKind, id: string | undefined, w: NameWorld): string {
  switch (kind) {
    case 'terminal':
      return t('features.ai.prov.class.terminal')
    case 'menu':
      return t('features.governor.cons.menu')
    case 'agent':
      return (id && w.agents?.[id]?.name.trim()) || t('features.governor.cons.agentGone')
    case 'autofill': {
      const db = dbTitle(w, id)
      return db ? t('features.governor.cons.autofill', { db }) : t('features.governor.cons.autofillAny')
    }
    case 'mail':
      return t('features.governor.cons.mail')
    case 'outbox':
      return t('features.ai.prov.class.outbox')
    case 'script':
      return t('features.ai.prov.class.scripts')
    case 'palette':
      return t('features.governor.cons.palette', { key: shortcutLabel('Mod+K') })
    case 'workspace':
      return t('features.ai.prov.class.workspace')
    case 'help':
      return t('features.ai.prov.class.help')
    case 'memory':
      return t('features.ai.prov.class.memory')
    case 'meeting':
      return t('features.ai.prov.class.meeting')
    case 'kit':
      return t('features.kit.title')
    case 'setup':
      return t('features.governor.cons.setup')
    case 'mcp':
      return t('features.ai.prov.class.mcp')
    case 'design':
      return t('features.governor.cons.design')
    case 'writing':
      return t('features.ai.prov.class.write')
    default:
      return t('features.governor.cons.other')
  }
}

const plural = (t: Translate, key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

/** The consumer's count line ("3 tasks", "Agent · 1 run", "2 runs · 41 requests"). */
export function consumerCount(t: Translate, kind: ConsumerKind, runs: number, requests: number): string {
  if (kind === 'terminal') return plural(t, 'features.governor.cons.tasks', runs)
  if (kind === 'palette' || kind === 'help' || kind === 'workspace') return plural(t, 'features.governor.cons.questions', runs)
  if (kind === 'agent') return t('features.governor.cons.agent', { runs: plural(t, 'features.governor.cons.runs', runs) })
  if (kind === 'autofill') return `${plural(t, 'features.governor.cons.runs', runs)} · ${plural(t, 'features.governor.cons.requests', requests)}`
  return plural(t, 'features.governor.cons.runs', runs)
}

/** What a consumer may do by itself (the DARF chip); null: nothing to say. */
export type May = 'checks' | 'preview' | 'answer' | 'report' | 'propose' | 'apply' | 'asks' | 'writes' | 'drafts' | 'sorts' | 'person' | 'test'

export function mayOf(kind: ConsumerKind, id: string | undefined, w: NameWorld, prop?: string): May | null {
  switch (kind) {
    case 'terminal':
      return 'checks'
    case 'menu':
    case 'writing':
    case 'design':
      return 'preview'
    case 'palette':
    case 'workspace':
    case 'help':
      return 'answer'
    case 'agent': {
      const a = id ? w.agents?.[id] : undefined
      if (!a) return null
      return a.write === 'apply' ? 'apply' : a.write === 'stage' ? 'propose' : 'report'
    }
    case 'autofill': {
      const props = id ? w.databases[id]?.properties : undefined
      const cfgs = (props ?? []).filter((p) => p.autofill && (!prop || p.id === prop)).map((p) => p.autofill!)
      return cfgs.length && cfgs.every((c) => c.skipReview) ? 'writes' : 'asks'
    }
    case 'memory':
      return 'asks'
    case 'outbox':
      return 'drafts'
    case 'mail':
      return 'sorts'
    case 'script':
    case 'kit':
    case 'meeting':
      return 'person'
    case 'setup':
    case 'mcp':
      return 'test'
    default:
      return null
  }
}

/** What a receipt of the roll is: the consumer, and for the AI menu the kind of work ("AI menu · Reshaping"). */
export function rollLabel(t: Translate, item: { kind: ConsumerKind; id?: string; cls: string }, w: NameWorld): string {
  const who = consumerName(t, item.kind, item.id, w)
  if (item.kind === 'menu') return `${who} · ${classLabel(t, item.cls)}`
  return who
}
