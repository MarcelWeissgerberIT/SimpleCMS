/**
 * Task blocks and HTML. A `div[data-type="work-item"]` becomes a task again ONLY when it is this One's own
 * copy: the editor's clipboard serializer (copy, cut, drag between editors) stamps every task with this
 * device's clip key (`data-one-clip`), and the schema's parse rule takes a task only with that key.
 *
 * Everything else that parses HTML — raw HTML inside Markdown (markdownToDoc: Claude's answers, MCP writes,
 * imports, Markdown paste, scripts), exported or shared pages, another site's clipboard — reads such a div
 * as plain blocks: no text from outside can plant a task (status, people, links of its choosing).
 *
 * The key is per device (localStorage `one.clip.key`, never synced, exported or sent anywhere), so a task
 * copied in one tab pastes as a task in another tab of this One too.
 */
import { customAlphabet } from 'nanoid'

const STORAGE = 'one.clip.key'
const VALID = /^[A-Za-z0-9_-]{24}$/
const fresh = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-', 24)

/** The attribute the clipboard copy of a task carries. */
export const CLIP_ATTR = 'data-one-clip'

let key: string | null = null

export function clipKey(): string {
  if (key) return key
  let k: string | null = null
  try {
    k = localStorage.getItem(STORAGE)
  } catch {
    /* storage blocked: a key for this tab only */
  }
  if (!k || !VALID.test(k)) {
    k = fresh()
    try {
      localStorage.setItem(STORAGE, k)
    } catch {
      /* this tab only */
    }
  }
  key = k
  return k
}

/** Is this element a task's own clipboard copy (from this device)? */
export function isOwnCopy(el: Element): boolean {
  const k = el.getAttribute(CLIP_ATTR)
  return !!k && k === clipKey()
}
