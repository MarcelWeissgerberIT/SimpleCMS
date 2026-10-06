/**
 * "What can One do?" — the cards: six groups of three. Each card: an icon, what it is, how to get there
 * (keys + a short path), a "Try it" key from the help's allow-list (help runTry — no code in text) and its
 * help article. Texts: shell.discover.card.<id>.title / .what / .how (EN + DE).
 */
import type { LucideIcon } from 'lucide-react'
import { Bot, Command, Inbox, Mail, MessageSquareText, Plug, RefreshCw, Shapes, Share2, Sheet, SquareCode, SquareSlash, SquareTerminal, Table2, Upload, Workflow, Search, Clock3 } from 'lucide-react'
import type { ChangelogTry } from '../../help'

export type DiscoverGroupId = 'write' | 'organise' | 'claude' | 'automate' | 'share' | 'capture'

export interface DiscoverCard {
  id: string
  icon: LucideIcon
  /** shortcut(s) shown as keycaps in front of the "how" line */
  keys?: string[]
  try: ChangelogTry
  /** help article id */
  help: string
}

export const DISCOVER_GROUPS: Array<{ id: DiscoverGroupId; cards: DiscoverCard[] }> = [
  {
    id: 'write',
    cards: [
      { id: 'slash', icon: SquareSlash, keys: ['/'], try: 'slash', help: 'blocks' },
      { id: 'sheet', icon: Sheet, try: 'sheet', help: 'spreadsheets' },
      { id: 'history', icon: Clock3, try: 'history', help: 'history' },
    ],
  },
  {
    id: 'organise',
    cards: [
      { id: 'database', icon: Table2, try: 'database', help: 'views' },
      { id: 'palette', icon: Search, keys: ['Mod+K'], try: 'palette', help: 'command-palette' },
      { id: 'commands', icon: Command, try: 'commands', help: 'database-commands' },
    ],
  },
  {
    id: 'claude',
    cards: [
      { id: 'aiMenu', icon: MessageSquareText, try: 'ai-menu', help: 'ai-menu' },
      { id: 'transform', icon: Shapes, try: 'transform', help: 'ai-menu' },
      { id: 'terminal', icon: SquareTerminal, keys: ['Mod+J'], try: 'terminal', help: 'agent' },
    ],
  },
  {
    id: 'automate',
    cards: [
      { id: 'scripts', icon: SquareCode, try: 'scripts', help: 'one-script' },
      { id: 'agents', icon: Bot, try: 'agents', help: 'custom-agents' },
      { id: 'automations', icon: Workflow, try: 'automations', help: 'automations' },
    ],
  },
  {
    id: 'share',
    cards: [
      { id: 'share', icon: Share2, try: 'share', help: 'share-links' },
      { id: 'sync', icon: RefreshCw, try: 'settings-sync', help: 'sync' },
      { id: 'mcp', icon: Plug, try: 'settings-mcp', help: 'mcp-bridge' },
    ],
  },
  {
    id: 'capture',
    cards: [
      { id: 'import', icon: Upload, try: 'import', help: 'import' },
      { id: 'mail', icon: Mail, try: 'settings-mail', help: 'gmail-sync' },
      { id: 'inbox', icon: Inbox, try: 'inbox', help: 'mentions-dates' },
    ],
  },
]

export const DISCOVER_CARD_COUNT = DISCOVER_GROUPS.reduce((n, g) => n + g.cards.length, 0)
