/** Types of tests/e2e/helpers/preflightStory.mjs (plain JS so scripts/preflight-shots.mjs can import it too). */
import type { Page } from '@playwright/test'

export const STORY: {
  workspace: string
  db: string
  mirrorAgent: string
  reportAgent: string
  profile: string
  server: string
  host: string
  people: string[]
  pipeline: string
  tasks: string[]
}
export const RELAY_SERVER: Record<string, unknown>
export const REPLY_ROUTE: Record<string, unknown>
export const TESSERA_PROFILE: Record<string, unknown>

export interface SeededMirror {
  dbId: string
  mirrorId: string
  reportId: string
  rows: Record<string, string>
  props: Record<string, string>
  [k: string]: unknown
}
export interface SeededPipeline {
  dbId: string
  gateId: string
  tasks: string[]
}

export function inPage<R, A>(page: Page, fn: (w: any, arg: A) => R | Promise<R>, arg?: A): Promise<R> // eslint-disable-line @typescript-eslint/no-explicit-any
export function waitPreflight(page: Page): Promise<void>
export function flushLamps(page: Page): Promise<void>
export function seedMirror(page: Page, opts?: { rows?: number }): Promise<SeededMirror>
export function seedRuns(page: Page, m: SeededMirror, now?: number): Promise<void>
export function seedTerminal(page: Page): Promise<void>
export function seedPipeline(page: Page): Promise<SeededPipeline>
export function seedRelay(page: Page, opts?: { refused?: boolean }): Promise<void>
export function seedSlip(page: Page, m: SeededMirror): Promise<unknown>
export function seedSyncGrey(page: Page): Promise<void>
export function seedMorning(page: Page, opts?: { parts?: string[] }): Promise<{ mirror?: SeededMirror; pipeline?: SeededPipeline; slip?: unknown }>
