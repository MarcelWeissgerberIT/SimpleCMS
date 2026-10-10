/**
 * The Outbox's fingerprints (pure, WebCrypto): `argsHash = sha256(canonicalJson(args))` — the same bytes the worker
 * hashes (features/coding/protocol.ts canonicalJson) — and a route's `sig` over the profile id, the route and the
 * server it goes to (a changed route never sends a slip staged for the old one).
 */
import { canonicalJson } from '../coding/protocol'

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const argsHashOf = (args: Record<string, unknown>) => sha256Hex(canonicalJson(args))

export const routeSigOf = (profileId: string, route: unknown, server: { name: string; url: string }) => sha256Hex(canonicalJson({ profileId, route, server: { name: server.name, url: server.url } }))

/** UTF-8 bytes of the canonical JSON (the 64 KB cap). */
export const argsBytes = (args: Record<string, unknown>) => new TextEncoder().encode(canonicalJson(args)).length
