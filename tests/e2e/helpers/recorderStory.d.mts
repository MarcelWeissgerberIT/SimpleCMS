/** Types of tests/e2e/helpers/recorderStory.mjs (plain JS so scripts/changelog-shots.mjs and scripts/recorder-shots.mjs can import it too). */
import type { Page } from '@playwright/test'

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StoryStepJson {
  at: string
  writer: AnyRec
  calls: Array<[string, ...unknown[]]>
  note?: AnyRec | true
  end?: boolean
}

export interface StoryJson {
  day: string
  tz: string
  setupAt: string
  span: [string, string]
  now: string
  playhead: string
  bracket: [string, string]
  database: { id: string; title: string; properties: AnyRec[]; board: { id: string; name: string; groupBy: string }; rows: Array<{ ref: string; title: string; properties: AnyRec; content: AnyRec | null }> }
  pages: Array<{ id: string; title: string; parentId?: string; content: AnyRec | null }>
  agent: { id: string; name: string }
  script: { id: string; name: string }
  mcpClient: string
  steps: StoryStepJson[]
  agentRun: { id: string; seq: number; changes: Record<string, { kind: string; page: string; prop?: string }> }
  expect: {
    lanes: Record<string, number>
    run212: { key: string; ops: number; from: string; to: string; places: AnyRec; words: [number, number] }
    eject: { back: number; all: number; held: string[]; trash: string[]; board: number[]; optionBack: { prop: string; id: string; index: number }; agent: { ejected: number; held: string[] } }
  }
}

export function storyTime(story: Pick<StoryJson, 'day' | 'tz'>, hms: string): number
export function resolveRefs(v: unknown, ids: Record<string, string>): unknown
export function setupStory(page: Page, story: StoryJson): Promise<Record<string, string>>
export function playSteps(page: Page, story: StoryJson, ids: Record<string, string>): Promise<void>
export function putStoryRun(page: Page, story: StoryJson, ids: Record<string, string>): Promise<unknown>
export function playStoryPage(page: Page, story: StoryJson, opts?: { wipeSetup?: boolean; agentRun?: boolean }): Promise<Record<string, string>>
export function seedPrivacyRun(page: Page, story: StoryJson): Promise<{ note: string; page: string; row: string; run: string }>
