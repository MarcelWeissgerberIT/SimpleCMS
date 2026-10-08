/**
 * Integration profiles in e2e specs (features/agents/integrations): a fictional profile that unlocks every agent
 * feature for the fictional MCP server "tracker" (tracker.example.com) — specs that use keys, "Only by hand",
 * upsert_rows, the tool list, the agent state or notes add it first; the gate itself is integrations.spec.ts.
 */
import type { Page } from '@playwright/test'
import { wsEval } from '../fixtures'

export type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const ALL_FEATURES = ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify'] as const

/** A profile for the "tracker" server (by name), every feature, the built-in mirror recipe. */
export function trackerProfile(extra: AnyState = {}): AnyState {
  return { schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: [...ALL_FEATURES], recipes: [{ kind: 'mirror' }], ...extra }
}

/** The tested "tracker" server (7 tools, 4 of them read-only by name). */
export const TRACKER_SERVER = { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() }

/** Add (or replace) a profile through the store; true when it was saved. */
export const addProfile = (page: Page, profile: AnyState = trackerProfile()) => wsEval(page, (s, p) => s.upsertIntegration(p), profile)

/** The servers and the profile that unlocks everything for them. */
export async function unlockAll(page: Page, servers: AnyState[] = [TRACKER_SERVER]): Promise<void> {
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), servers)
  await addProfile(page)
}
