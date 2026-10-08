/**
 * Coding relay — the frames it lets through (docs/CLOUD.md § Coding relay). Pure, no I/O.
 *
 * The tab ⇄ worker protocol travels end to end encrypted (`box` frames, src/app/features/coding/relayBox.ts and
 * mcp/src/worker/box.ts): the relay never parses protocol content. It sees and checks only the shape of
 * `key` (a fresh nonce per pairing), `box` (pairing number, sequence number, iv, base64 ciphertext — and the
 * worker's `k: 'e'` mark of an event it may drop under load) and its own small `relay` control frames.
 * Everything else closes the sender (1008).
 *
 * KEEP IN STEP with src/app/features/coding/protocol.ts (the server image builds only server/, so it cannot
 * import it) — test/coding-frames.test.ts compares the two.
 */
export const RELAY_TAB_PATH = '/coding/tab'
export const RELAY_WORKER_PATH = '/coding/worker'
export const WORKER_SUBPROTOCOL = 'one-worker.v1'
export const RELAY_MAX_FRAME = 8 * 1024 * 1024 + 64 * 1024
export const RELAY_CLOSE_AUTH = 4401
export const RELAY_CLOSE_FORBIDDEN = 4403
export const RELAY_CLOSE_IDLE = 4408
export const RELAY_CLOSE_TAB_CODES = [4001, 4003, 1008] as const
export const RELAY_TAB_IDLE_MS = 150_000
export const RELAY_NONCE = /^[A-Za-z0-9_-]{43}$/
export const RELAY_IV = /^[A-Za-z0-9_-]{16}$/

const B64 = /^[A-Za-z0-9+/]*={0,2}$/

export type Frame =
  /** a pairing's nonce — forwarded as is (re-serialised) when `s` is the current pairing */
  | { kind: 'key'; s: number; text: string }
  /** a sealed protocol frame — forwarded (re-serialised); `droppable`: an event the relay may drop under load */
  | { kind: 'box'; s: number; droppable: boolean; text: string }
  /** tab → relay: still here (a frozen background tab stops sending these) */
  | { kind: 'alive' }
  /** worker → relay: close the tab of pairing `s` (after a refusal) */
  | { kind: 'close-tab'; s: number; code: number; reason: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const pairing = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1

/** What a frame from this side is — or null: not allowed (the relay closes the sender with 1008). */
export function checkFrame(text: string, from: 'tab' | 'worker'): Frame | null {
  if (text.length > RELAY_MAX_FRAME) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(raw)) return null
  switch (raw.type) {
    case 'key':
      if (!pairing(raw.s) || typeof raw.n !== 'string' || !RELAY_NONCE.test(raw.n)) return null
      return { kind: 'key', s: raw.s, text: JSON.stringify({ type: 'key', s: raw.s, n: raw.n }) }
    case 'box': {
      const { s, seq, iv, data, k } = raw
      if (!pairing(s) || !pairing(seq) || typeof iv !== 'string' || !RELAY_IV.test(iv) || typeof data !== 'string' || data.length < 24 || !B64.test(data)) return null
      // only the worker marks events the relay may drop
      if (k !== undefined && (from !== 'worker' || k !== 'e')) return null
      return { kind: 'box', s, droppable: k === 'e', text: JSON.stringify({ type: 'box', s, seq, iv, data }) }
    }
    case 'relay':
      if (from === 'tab' && raw.op === 'alive') return { kind: 'alive' }
      if (from === 'worker' && raw.op === 'close-tab' && pairing(raw.s) && (RELAY_CLOSE_TAB_CODES as readonly unknown[]).includes(raw.code)) {
        const reason = (typeof raw.reason === 'string' ? raw.reason : '').replace(/[^a-z0-9 -]/gi, '').slice(0, 60)
        return { kind: 'close-tab', s: raw.s, code: raw.code as number, reason }
      }
      return null
    default:
      return null
  }
}
