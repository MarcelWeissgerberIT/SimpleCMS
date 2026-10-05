/**
 * Mermaid for "Transform into → Diagram": the code Claude writes is cleaned (no fences, no init directives,
 * no click handlers), checked by Mermaid's own parser before any preview, and turned between top-down and
 * left-to-right without asking Claude again.
 */
import type { DiagramKind, Direction } from './types'

type MermaidApi = typeof import('mermaid').default

let api: Promise<MermaidApi> | null = null

/** Mermaid's parser (the editor's diagram block loads the same module). */
async function mermaid(): Promise<MermaidApi | null> {
  api ??= import('mermaid').then((m) => m.default)
  try {
    return await api
  } catch {
    // offline / a redeploy renamed the chunk: no check possible now (the block itself says it can't render)
    api = null
    return null
  }
}

const MAX_CODE = 12_000

/** The code as the block will hold it: no fences, no `%%{init}%%` directives, no click handlers or links. */
export function cleanMermaid(code: string): string {
  const body = code
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```[a-z]*\s*\n/i, '')
    .replace(/\n\s*```\s*$/, '')
  return body
    .split('\n')
    .filter((l) => !/%%\s*\{/.test(l) && !/^\s*(click|href)\s/i.test(l))
    .join('\n')
    .trim()
    .slice(0, MAX_CODE)
}

/** The diagram kind of a piece of code by its first keyword (null: not one of ours). */
export function kindOfCode(code: string): DiagramKind | null {
  const first = code.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%'))?.trim() ?? ''
  const word = first.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (word === 'flowchart' || word === 'graph') return 'flowchart'
  if (word === 'mindmap') return 'mindmap'
  if (word === 'sequencediagram') return 'sequence'
  if (word === 'timeline') return 'timeline'
  if (word === 'gantt') return 'gantt'
  return null
}

const HEAD = /^(\s*)(flowchart|graph)(?:[ \t]+(TD|TB|BT|RL|LR))?[ \t]*$/im

/** The direction of a flowchart (null: not a flowchart). */
export function directionOf(code: string): Direction | null {
  const m = HEAD.exec(code)
  if (!m) return null
  return m[3] === 'LR' || m[3] === 'RL' ? 'LR' : 'TD'
}

/** The flowchart drawn the other way (other kinds stay as they are). */
export function withDirection(code: string, dir: Direction | null): string {
  if (!dir) return code
  return code.replace(HEAD, (_m, indent: string, word: string) => `${indent}${word} ${dir}`)
}

/** null when Mermaid parses the code, else its error (a few lines — what a repair round gets). */
export async function mermaidError(code: string): Promise<string | null> {
  if (!code.trim()) return 'The diagram is empty.'
  if (!kindOfCode(code)) return 'Start the code with one of: flowchart TD, flowchart LR, mindmap, sequenceDiagram, timeline, gantt.'
  const m = await mermaid()
  if (!m) return null
  try {
    await m.parse(code)
    return null
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    return msg.split('\n').slice(0, 6).join('\n').slice(0, 800) || 'Mermaid could not parse the code.'
  }
}
