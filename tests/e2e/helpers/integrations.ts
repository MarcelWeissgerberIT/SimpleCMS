/**
 * Integration profiles in e2e specs (features/agents/integrations): a fictional profile that unlocks every agent
 * feature for the fictional MCP server "tracker" (tracker.example.com) — specs that use keys, "Only by hand",
 * upsert_rows, the tool list, the agent state or notes add it first; the gate itself is integrations.spec.ts.
 * The Outbox's specs add a profile with send routes (trackerSendsProfile) — its tools are OUT on "tracker".
 */
import type { Page } from '@playwright/test'
import { wsEval } from '../fixtures'

export type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const ALL_FEATURES = ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify', 'sends'] as const

/** A profile for the "tracker" server (by name), every feature, the built-in mirror recipe. */
export function trackerProfile(extra: AnyState = {}): AnyState {
  return { schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: [...ALL_FEATURES], recipes: [{ kind: 'mirror' }], ...extra }
}

/** The tested "tracker" server (7 tools, 4 of them read-only by name). */
export const TRACKER_SERVER = { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() }

/** The "tracker" server as the Outbox knows it: also list_comments (a read-back) and log_work (a send). */
export const TRACKER_SERVER_OUTBOX = { ...TRACKER_SERVER, tools: [...TRACKER_SERVER.tools, 'list_comments', 'log_work'] }

/** The reply route (fictional; the shape the Outbox's specs use): add_comment with a pre-read and a read-back. */
export const REPLY_ROUTE = {
  id: 'reply',
  role: 'reply',
  label: { en: 'Reply in the ticket tool', de: 'Im Ticket-Tool antworten' },
  tool: 'add_comment',
  args: { ref: '{key}', visibility: 'team', body: '{draft}' },
  params: [{ name: 'draft', type: 'text', max: 4000, style: { de: 'Kurz, freundlich, du-Form' } }],
  check: { tool: 'get_item', args: { ref: '{key}' }, fields: ['status', 'comments.length'], latest: 'comments.-1', identity: 'ref' },
  confirm: { tool: 'list_comments', args: { ref: '{key}' }, find: 'items', match: [{ path: 'body', equals: '{draft}' }], capture: { id: 'id' } },
  after: [{ property: 'waiting', value: false }],
  via: ['worker', 'hand'],
}

/** A route that books time (typed params only): log_work. */
export const WORK_ROUTE = {
  id: 'work',
  role: 'work',
  label: { en: 'Log work', de: 'Arbeit buchen' },
  tool: 'log_work',
  args: { ref: '{key}', minutes: '{minutes}' },
  params: [{ name: 'minutes', type: 'minutes', max: 600, round: 15 }],
  confirm: { tool: 'list_comments', args: { ref: '{key}' }, match: [{ path: 'kind', equals: 'work' }] },
}

/** A profile for "tracker" (by name) with send routes (default: the reply route), every feature, the mirror recipe. */
export function trackerSendsProfile(extra: AnyState = {}, sends: AnyState[] = [REPLY_ROUTE]): AnyState {
  return trackerProfile({ id: 'tracker-out', name: 'Tracker out', reads: ['list_items', 'get_item', 'search_items', 'list_comments'], sends, ...extra })
}

/** Add (or replace) a profile through the store; true when it was saved. */
export const addProfile = (page: Page, profile: AnyState = trackerProfile()) => wsEval(page, (s, p) => s.upsertIntegration(p), profile)

/** The servers and the profile that unlocks everything for them. */
export async function unlockAll(page: Page, servers: AnyState[] = [TRACKER_SERVER]): Promise<void> {
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), servers)
  await addProfile(page)
}
