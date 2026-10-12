/**
 * API keys never travel as text: a request whose typed text looks like a key is refused before anything is sent, a
 * terminal prompt that looks like one never enters the history, and every error message is scrubbed of keys.
 */

/** Claude, OpenAI project and OpenRouter keys, and any other "sk-…" key of 20+ characters (never inside a word). */
const KEY_RES = [/(?<![A-Za-z0-9_-])sk-(?:ant|proj|or-v1)-[A-Za-z0-9_-]{12,}/g, /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g]

/** Does the text hold something that looks like an API key? ("task-1234", "desk-…" do not.) */
export function looksLikeKey(text: string | null | undefined): boolean {
  if (!text) return false
  return KEY_RES.some((re) => {
    re.lastIndex = 0
    return re.test(text)
  })
}

/** The text with every key-shaped part and every given secret (≥ 4 characters) replaced by "••••". */
export function scrubSecrets(text: string, extra: ReadonlyArray<string | null | undefined> = []): string {
  let out = text
  for (const s of extra) if (s && s.length >= 4) out = out.split(s).join('••••')
  for (const re of KEY_RES) out = out.replace(re, '••••')
  return out
}
