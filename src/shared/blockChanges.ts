/** Server-authored source snapshots for a shared page's section-level change view. */
export const BLOCK_CHANGES = 'blockChangesV1'
export const PAGE_AREA = '@page'
export interface BlockContent {
  type: string
  attrs?: Record<string, unknown>
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  content?: BlockContent[]
}
export interface BlockChange {
  id: string
  block: string
  area: string
  actor: string
  seq: number
  from: number
  at: number
  before: BlockContent | null
  after: BlockContent | null
}
function contentNode(value: unknown, depth = 0): value is BlockContent {
  if (!value || typeof value !== 'object' || depth > 66) return false
  const n = value as BlockContent
  return typeof n.type === 'string' && (n.text === undefined || typeof n.text === 'string') &&
    (n.content === undefined || (Array.isArray(n.content) && n.content.every(c => contentNode(c, depth + 1)))) &&
    (n.marks === undefined || (Array.isArray(n.marks) && n.marks.every(m => m && typeof m.type === 'string')))
}
/** Validate the envelope. Snapshots are ordinary JSON, never executable HTML. */
export function isBlockChange(value: unknown): value is BlockChange {
  if (!value || typeof value !== 'object') return false
  const v = value as BlockChange
  return ['id', 'block', 'area', 'actor'].every(k => typeof v[k as keyof BlockChange] === 'string' && (v[k as keyof BlockChange] as string).length > 0) &&
    Number.isSafeInteger(v.seq) && v.seq > 0 && Number.isFinite(v.from) && Number.isFinite(v.at) &&
    [v.before, v.after].every(n => n === null || contentNode(n))
}
