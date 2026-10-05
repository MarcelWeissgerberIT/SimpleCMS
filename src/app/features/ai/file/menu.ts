/**
 * Claude for files — what the block menus show for a file block (the editor's AI key and ⋮⋮ menu, the AI
 * panel): its actions by kind, their labels in the UI language and their icons.
 */
import { BookOpenText, Database, FileText, ListCollapse, MessageSquareText, Sheet, Table2, type LucideIcon } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import { FILE_ACTIONS, fileKind, type FileAction, type FileKind } from './kinds'

export const FILE_ICONS: Record<FileAction, LucideIcon> = {
  summarize: ListCollapse,
  extract: FileText,
  tables: Table2,
  ask: MessageSquareText,
  page: BookOpenText,
  database: Database,
  sheet: Sheet,
}

/** The actions of a file by its name, in menu order ([] = One can do nothing with it). */
export function fileActionsFor(name: string): FileAction[] {
  const kind = fileKind(name)
  return kind ? FILE_ACTIONS[kind] : []
}

/** The label of an action for this kind of file ("Ask about the file…", "Ask Claude about the data…"). */
export function fileActionLabel(t: Translate, a: FileAction, kind: FileKind | null, menu = false): string {
  if (a === 'ask') return t(`features.ai.file.act.${kind === 'csv' || kind === 'xlsx' ? 'askData' : 'ask'}${menu ? 'Menu' : ''}`)
  return t(`features.ai.file.act.${a}`)
}
