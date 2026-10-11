/** Types of tests/e2e/helpers/trustStory.mjs (plain JS so scripts/trust-shots.mjs and changelog-shots.mjs can import it too). */
import type { Page } from '@playwright/test'
import type { SeededMirror } from './preflightStory.mjs'

export { STORY, inPage } from './preflightStory.mjs'

export const TRUST_STORY: {
  agentId: string
  runId: string
  clarity: string
  options: string[]
  why: string
  lastComment: string
  goneFromSource: string
  records: string[]
}

export interface TrustMirror extends SeededMirror {
  /** option id by name (Klarheit) */
  options: Record<string, string>
}

export function waitTrust(page: Page): Promise<void>
export function seedTrustMirror(page: Page, opts?: { rows?: number }): Promise<TrustMirror>
export function keyOf(m: SeededMirror, role: string): string
export function seedTrustRun(page: Page, m: TrustMirror, opts?: { now?: number; status?: string }): Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
export function seedTrustBook(page: Page, m: TrustMirror, opts?: { now?: number }): Promise<unknown>
export function seedTrust(page: Page, opts?: { lang?: 'de' | 'en'; now?: number; book?: boolean; run?: boolean }): Promise<{ m: TrustMirror; run: Record<string, any> | null }> // eslint-disable-line @typescript-eslint/no-explicit-any
