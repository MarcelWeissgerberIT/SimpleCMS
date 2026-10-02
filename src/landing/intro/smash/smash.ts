import type { Sfx } from '../audio'

export interface SmashHooks {
  onSwap(): void
  onDone(): void
}
export interface SmashStage {
  setPage(canvas: HTMLCanvasElement): void
  play(hooks: SmashHooks): void
  advance?(ms: number): void
  dispose(): void
}
export interface SmashOptions {
  mobile: boolean
  sfx: Sfx | null
  manualClock: boolean
}
export async function createSmashStage(_host: HTMLElement, _opts: SmashOptions): Promise<SmashStage> {
  throw new Error('not implemented')
}
