/**
 * One MCP — the options a call names (one_create_property, one_create_database's properties, one_update_property's
 * options.add / options.update colours), read the same way by the local bridge and the team server (pure). A name has
 * its whitespace collapsed and is cut to MCP_LIMITS.optionName; a colour is lower-cased ("Red" is red). Refused alike on
 * both sides — `bad_argument`, nothing written: an empty name, a name listed twice (case aside), a colour that is none of
 * MCP_OPTION_COLORS, a status group other than todo / in_progress / done.
 */
import { MCP_LIMITS } from './tables.ts'

/** The colours an option takes (the app's ColorName list). */
export const MCP_OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const

export type McpOptionColor = (typeof MCP_OPTION_COLORS)[number]
export type McpStatusGroup = 'todo' | 'in_progress' | 'done'

const COLOR_SET = new Set<string>(MCP_OPTION_COLORS)
const GROUP_SET = new Set<string>(['todo', 'in_progress', 'done'])

export interface McpOption {
  name: string
  color?: McpOptionColor
  group?: McpStatusGroup
}

/** "Blue " → 'blue'; null when it is none of the colours. */
export function optionColor(raw: unknown): McpOptionColor | null {
  const c = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return COLOR_SET.has(c) ? (c as McpOptionColor) : null
}

/** Why a colour is refused (both sides word it alike). */
export const colorRefusal = (raw: unknown) => `${JSON.stringify(String(raw))} is not a colour; use one of: ${MCP_OPTION_COLORS.join(', ')}`

/** An option name as both sides keep it: whitespace collapsed, cut to MCP_LIMITS.optionName. */
export const optionName = (raw: string) => raw.replace(/\s+/g, ' ').trim().slice(0, MCP_LIMITS.optionName)

/** Why an option list is refused: the entry (index) and its part ('' = the entry itself), in the contract's words. */
export interface OptionProblem {
  index: number
  field: '' | 'name' | 'color' | 'group'
  what: string
}

/** The options of a list as a call gives them — names or {name, color?, group?} — or the first entry that does not fit. */
export function readOptions(raw: readonly unknown[]): { options: McpOption[] } | { problem: OptionProblem } {
  const options: McpOption[] = []
  const seen = new Set<string>()
  for (const [index, item] of raw.entries()) {
    const o = typeof item === 'string' ? { name: item } : item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
    if (!o || typeof o.name !== 'string') return { problem: { index, field: '', what: 'every option is a name or {name, color, group}' } }
    const name = optionName(o.name)
    if (!name) return { problem: { index, field: 'name', what: 'an option name cannot be empty' } }
    if (seen.has(name.toLowerCase())) return { problem: { index, field: 'name', what: `option ${JSON.stringify(name)} is listed twice` } }
    seen.add(name.toLowerCase())
    let color: McpOptionColor | undefined
    if (o.color !== undefined && o.color !== null) {
      const c = optionColor(o.color)
      if (!c) return { problem: { index, field: 'color', what: colorRefusal(o.color) } }
      color = c
    }
    let group: McpStatusGroup | undefined
    if (o.group !== undefined && o.group !== null) {
      if (typeof o.group !== 'string' || !GROUP_SET.has(o.group)) return { problem: { index, field: 'group', what: 'group is todo, in_progress or done' } }
      group = o.group as McpStatusGroup
    }
    options.push({ name, ...(color ? { color } : {}), ...(group ? { group } : {}) })
  }
  return { options }
}

/** The argument path of an option problem under `key` (`options[2].color`). */
export const optionPath = (key: string, p: OptionProblem) => `${key}[${p.index}]${p.field ? `.${p.field}` : ''}`

/**
 * A database made over MCP always has a title property — "Name" unless the call gives one of type "title". A property of
 * another type with that name would clash with it: refused the same way on both sides (never renamed quietly).
 */
export const titleNameTaken = (name: string) =>
  `${JSON.stringify(name)} is the name of the title property every database gets (when no property of type "title" is given): give this property another name, or make it the title with type "title"`
