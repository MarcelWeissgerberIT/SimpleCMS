/**
 * One memory — shared types. A memory is a row of the memory database (schema.ts): one plain
 * sentence (the row title), a type, topics, a source, Active, Uses and Last used; a Procedure's page
 * body holds its template. Everything here is read sanitised (read.ts) — the person edits the
 * database by hand like any other.
 */
import type { ID } from '../../../store/types'

export const MEMORY_TYPES = ['fact', 'preference', 'decision', 'procedure'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

/** A memory as read from the database. */
export interface Memory {
  /** the row id */
  id: ID
  text: string
  type: MemoryType
  topics: string[]
  source: string
  active: boolean
  /** requests in the log that cited it (live rows of "Cited in") */
  uses: number
  /** "yyyy-MM-dd" of the latest of those (null: never) */
  lastUsed: string | null
  /** the row's page text (plain, for the search) */
  plain: string
  createdAt: number
}

/** A memory picked for one request: its label in that request ("M3"). */
export interface PickedMemory {
  id: ID
  label: string
  type: MemoryType
  text: string
}

/** What a request carried: the picked memories, or memory switched off for it. */
export interface MemoryUse {
  items: PickedMemory[]
  /** switched off for this request (/no-memory, the AI menu's toggle) */
  off?: boolean
}

/** A memory Claude (or the person) proposes; saved only after the person confirms. */
export interface MemoryProposal {
  type: MemoryType
  text: string
  topics: string[]
  /** a Procedure's template (Markdown) — '' for none */
  body: string
  /** "Page title · #/p/<id>" / "AI terminal · 2026-10-05" */
  source: string
}

/** Stored property roles of the memory database (Uses / Last used are rollups over "Cited in", schema.ts). */
export type MemoryRole = 'type' | 'topics' | 'source' | 'active'
