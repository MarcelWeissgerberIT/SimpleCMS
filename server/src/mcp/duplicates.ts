/**
 * Duplicate MCP calls on the team server (spec § 2.0, src/shared/mcp/duplicates.ts): a creating call whose tool and
 * canonical arguments equal one this token made in the last 2 minutes answers that call's result (`duplicateOf` and a
 * note) — nothing new is made. A repeat that arrives while the first still runs waits for it. Kept in the REST API's
 * idempotency store (sealed with the workspace key, purged after a day), keyed by the token and the SHA-256 of the
 * call's key (dupHash); failed calls are not remembered. A keyed upsert only waits for a running repeat
 * (MCP_JOIN_ONLY_TOOLS: it makes no duplicate on its own) and is never answered from the store; a call an owner put back
 * (Workspace → API Restore, preimages.ts) is forgotten (forgetCall), so repeating it makes the thing again.
 */
import type { Services } from '../context.ts'
import { DUPLICATE_MS, dupHash, duplicateAnswer, remembersResult } from '../../../src/shared/mcp/duplicates.ts'

type Json = Record<string, unknown> | unknown[]

/** Calls in flight in this process, by scope + key: a repeat waits for the first. */
const inflight = new Map<string, Promise<unknown>>()

/** The idempotency scope of a token's MCP calls. */
export const dupScope = (tokenId: string) => `mcp:${tokenId}`

/** Run a creating call once per token and arguments within the window; a repeat gets the first call's answer. */
export async function once(s: Services, tokenId: string, wsId: string, tool: string, args: Record<string, unknown>, run: () => Promise<Json>): Promise<Json> {
  const scope = dupScope(tokenId)
  const key = dupHash(tool, args)
  const id = `${scope}\n${key}`
  const remember = remembersResult(tool)
  const pending = inflight.get(id)
  if (pending) await pending.catch(() => {})
  const hit = remember ? s.repo.idempotent(scope, key, Date.now() - DUPLICATE_MS) : undefined
  if (hit) {
    const kept = JSON.parse(hit.body) as { result?: unknown; at?: number }
    return duplicateAnswer(kept.result, typeof kept.at === 'number' ? kept.at : Date.now(), Date.now())
  }
  const job = run()
  inflight.set(id, job)
  try {
    const result = await job
    if (remember) {
      try {
        s.repo.rememberIdempotent(scope, key, wsId, 200, JSON.stringify({ result, at: Date.now() }))
      } catch (err) {
        // the workspace went meanwhile: the answer stands, there is nothing to replay
        s.log.warn('mcp duplicate key not stored', { error: (err as Error).message })
      }
    }
    return result
  } finally {
    if (inflight.get(id) === job) inflight.delete(id)
  }
}

/** A call was put back (Restore): its repeat is a new call again. */
export function forgetCall(s: Services, tokenId: string, key: string): void {
  s.repo.forgetIdempotent(dupScope(tokenId), key)
}
