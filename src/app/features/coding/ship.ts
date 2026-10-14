/**
 * The ship log (worker 1.10.0, `can` 'ship') — pure: what a git stage or a git key did with commits, the push and the
 * merge / pull request (protocol.ts ShipRecord), checked as it arrives (cleanShip); its line in the person's language
 * with links to the repository's web pages (shipInline · shipText), the note in the task page (shipNote — the
 * pipeline's existing grey callout); the PR / Commit field after it (prFieldNext); and the pipeline editor's warning
 * for a worker that has pushing or requests switched off for a repo (gitStageWarnings).
 *
 * Links only to what is on the remote: the commit, the head and the branch are linked when the record pushed them or a
 * request on the host exists — a commit that is only on the person's computer shows its short sha as text. No store,
 * i18n or DOM here: Node specs test it (coding-ship-lines.spec).
 */
import { format } from 'date-fns'
import type { JSONContent } from '@tiptap/core'
import { GIT_SHA, SHIP_ACTIONS, SHIP_REQUEST, branchUrl, cleanWeb, commitUrl, requestNumber, type ForgeWeb, type GitAction, type ShipAction, type ShipRecord, type ShipRequestHow } from './protocol'

export type Tr = (key: string, vars?: Record<string, string | number>) => string

/**
 * A branch name as git takes it (check-ref-format: no control character, space, ~ ^ : ? * [ \\, "..", "@{", "//", no
 * part starting with "." or ending in ".lock", no "/" or "." at the end) and never an option (no leading "-"), ≤ 200
 * characters — "fix/ümlaute" too: whatever the worker could make a branch of. Stricter only for what would mislead in a
 * line of text (bidi and zero-width marks). It is written as text; its link encodes each part.
 */
// eslint-disable-next-line no-control-regex
const BRANCH_BAD = /[\u0000-\u0020\u007f-\u009f~^:?*[\\\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/
export const branchOk = (b: string): boolean =>
  b.length > 0 && b.length <= 200 && !BRANCH_BAD.test(b) && b !== '@' && !b.startsWith('-') && !b.startsWith('/') && !b.endsWith('/') && !b.endsWith('.') && !b.includes('..') && !b.includes('//') && !b.includes('@{') && !b.split('/').some((p) => p.startsWith('.') || p.endsWith('.lock'))
/** A remote's name as worker.json may name it. */
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const shaOf = (v: unknown): string | null => (typeof v === 'string' && GIT_SHA.test(v) ? v : null)
const objOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/**
 * A request's address as One takes it: http(s), on the record's own repository (as a URL writes it — host lower-cased, no
 * default port — it starts with `web.base` + "/"), no user name or password, no fragment, no white space — kept in that
 * form; null otherwise (and always without a web address).
 */
function cleanRequest(raw: unknown, web: ForgeWeb | null): ShipRecord['request'] {
  const r = objOf(raw)
  if (!web || !r) return null
  const { url, how } = r
  if (!(SHIP_REQUEST as readonly unknown[]).includes(how) || typeof url !== 'string' || url.length > 2000 || /[\s#\\]/.test(url)) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const at = `${web.base}/`
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.hash || !u.href.startsWith(at)) return null
  return { url: u.href, how: how as ShipRequestHow }
}

/** A ship record as it arrives from a worker — every field checked; null: nothing usable. */
export function cleanShip(raw: unknown): ShipRecord | null {
  const r = objOf(raw)
  if (!r) return null
  if (!(SHIP_ACTIONS as readonly unknown[]).includes(r.action) || (r.from !== 'stage' && r.from !== 'key')) return null
  if (typeof r.branch !== 'string' || !branchOk(r.branch)) return null
  const commit = shaOf(objOf(r.commit)?.sha)
  const p = objOf(r.pushed)
  const pushed = p && typeof p.remote === 'string' && REMOTE.test(p.remote) ? { remote: p.remote, ...(p.force === true ? { force: true as const } : {}) } : null
  const web = cleanWeb(r.web)
  const f = objOf(r.failed)
  const failed = f && (f.step === 'push' || f.step === 'request') ? { step: f.step as 'push' | 'request', ...(f.code === 'pushRejected' ? { code: 'pushRejected' as const } : {}) } : null
  return {
    action: r.action as ShipAction,
    from: r.from,
    at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : Date.now(),
    branch: r.branch,
    commit: commit ? { sha: commit } : null,
    head: shaOf(r.head),
    pushed,
    ...(r.pushOff === true ? { pushOff: true as const } : {}),
    request: cleanRequest(r.request, web),
    web,
    ...(failed ? { failed } : {}),
  }
}

/** Does the record say anything worth a note? A commit, a push (or that it was off / failed) or a request. */
export const shipShows = (s: ShipRecord): boolean => !!(s.commit || s.pushed || s.pushOff || s.request || s.failed)

/**
 * The note's date in the UI's language: "14.10. 14:32" (de) · "14 Oct 14:32" (en) — with the year when it is not this
 * year's. A record delivered late (the worker keeps an outcome until a tab takes it — Friday's Ship on Monday) keeps its
 * own time, however old; only a time in the future (a worker's clock ahead by more than a few minutes) becomes now.
 */
export function shipWhen(at: number, lang: 'en' | 'de', now = Date.now()): string {
  const when = Number.isFinite(at) && at > 0 && at <= now + FUTURE_SLACK_MS ? Math.min(at, now) : now
  const year = new Date(when).getFullYear() !== new Date(now).getFullYear()
  return format(when, lang === 'de' ? (year ? 'dd.MM.yyyy HH:mm' : 'dd.MM. HH:mm') : year ? 'd MMM yyyy HH:mm' : 'd MMM HH:mm')
}
/** How far ahead of this tab's clock a record's time may be and still count (a worker on another computer). */
const FUTURE_SLACK_MS = 5 * 60_000

const txt = (text: string, href?: string | null): JSONContent => (href ? { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] } : { type: 'text', text })

/** A string with one value linked: `t(key)` with the value's slot cut out, the value put back in as its own text node. */
function linked(t: Tr, key: string, vars: Record<string, string | number>, slot: string, value: string, href: string | null): JSONContent[] {
  const MARK = '\u0001'
  const out: JSONContent[] = []
  t(key, { ...vars, [slot]: MARK })
    .split(MARK)
    .forEach((piece, i) => {
      if (i > 0) out.push(txt(value, href))
      if (piece) out.push(txt(piece))
    })
  return out
}

/** Plain text nodes next to each other become one (links stay their own). */
function joined(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const last = out[out.length - 1]
    if (last && !last.marks && !n.marks && typeof last.text === 'string' && typeof n.text === 'string') out[out.length - 1] = { type: 'text', text: last.text + n.text }
    else out.push(n)
  }
  return out
}

/** A request's kind: by its address (".../-/merge_requests/n" · ".../pull/n"), else by the forge. */
const kindOf = (s: ShipRecord): 'mr' | 'pr' => (s.request ? requestNumber(s.request.url)?.kind : undefined) ?? (s.web?.forge === 'gitlab' ? 'mr' : 'pr')

/** "MR !42" · "PR #7" — or "MR" / "PR" for an address without a number. */
function requestLabel(s: ShipRecord, t: Tr): string {
  const n = s.request ? requestNumber(s.request.url) : null
  if (n) return t(`features.coding.ship.${n.kind}`, { n: n.n })
  return t(kindOf(s) === 'mr' ? 'features.coding.ship.mrPlain' : 'features.coding.ship.prPlain')
}

/** The record's line (inline nodes), in the owner's order: Commit · Branch · MR / PR · pushed. */
export function shipInline(s: ShipRecord, t: Tr): JSONContent[] {
  const web = s.web
  // what this record pushed, or a request on the host, is on the remote: only that is linked
  const onRemote = !!web && (!!s.pushed || (!!s.request && s.request.how !== 'link'))
  const shaLink = (sha: string) => (onRemote && web ? commitUrl(web, sha) : null)
  const parts: JSONContent[][] = []
  // 1 · the commit: a stage's commit · push · pr and the Commit key commit first; the other keys name the head
  const commits = s.from === 'stage' ? s.action === 'commit' || s.action === 'push' || s.action === 'pr' : s.action === 'commit'
  const keyHead = s.from === 'key' && (s.action === 'push' || s.action === 'force-push' || s.action === 'pr')
  if (commits && s.commit) parts.push(linked(t, 'features.coding.ship.commit', {}, 'sha', s.commit.sha.slice(0, 7), shaLink(s.commit.sha)))
  else if (commits) {
    parts.push([txt(t('features.coding.ship.noCommit'))])
    if (s.head && onRemote) parts.push(linked(t, 'features.coding.ship.head', {}, 'sha', s.head.slice(0, 7), shaLink(s.head)))
  } else if (keyHead && s.head) parts.push(linked(t, 'features.coding.ship.head', {}, 'sha', s.head.slice(0, 7), shaLink(s.head)))
  // 2 · the branch
  parts.push(linked(t, 'features.coding.ship.branch', {}, 'branch', s.branch, onRemote && web ? branchUrl(web, s.branch) : null))
  // 3 · the merge / pull request
  if (s.failed?.step === 'request') parts.push([txt(t('features.coding.ship.requestFailed', { req: requestLabel(s, t) }))])
  else if (s.request) {
    const { url, how } = s.request
    if (how === 'link') parts.push([txt(t(kindOf(s) === 'mr' ? 'features.coding.ship.linkMr' : 'features.coding.ship.linkPr'), url)])
    else if (how === 'opened') parts.push([txt(requestLabel(s, t), url)])
    else parts.push(linked(t, `features.coding.ship.${how}`, {}, 'req', requestLabel(s, t), url))
  }
  // 4 · the push
  if (s.pushed) parts.push([txt(t(s.pushed.force ? 'features.coding.ship.forcePushed' : 'features.coding.ship.pushed', { remote: s.pushed.remote, branch: s.branch }))])
  else if (s.pushOff) parts.push([txt(t('features.coding.ship.pushOff'))])
  else if (s.failed?.step === 'push') parts.push([txt(t(s.failed.code === 'pushRejected' ? 'features.coding.ship.pushRejected' : 'features.coding.ship.pushFailed'))])
  const line = joined(parts.flatMap((p, i) => (i ? [txt(' · '), ...p] : p)))
  // the line starts with a capital ("At a1b2c3d · …", "Nothing new to commit · …") — never inside a linked value
  const first = line[0]
  if (first && !first.marks && first.text) line[0] = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) }
  return line
}

/** The same line as plain text (toasts). */
export function shipText(s: ShipRecord, t: Tr): string {
  return shipInline(s, t)
    .map((n) => n.text ?? '')
    .join('')
}

/** The note: the existing grey callout of the coding pipeline — a bold label line "<label> · <when>", then the record's line. */
export function shipNote(label: string, s: ShipRecord, t: Tr, lang: 'en' | 'de', now?: number): JSONContent {
  return {
    type: 'callout',
    attrs: { icon: 'asset:publish', color: 'gray' },
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `${label} · ${shipWhen(s.at, lang, now)}`, marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: shipInline(s, t) },
    ],
  }
}

/** A commit's page on a host (".../-/commit/<sha>" · ".../commit/<sha>") — what PR / Commit holds when there is no request. */
export const isCommitUrl = (url: string): boolean => /^https?:\/\/[^/?#]+\/[^?#]*?\/(?:-\/)?commit\/[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(url.trim())

/**
 * The PR / Commit field after a record (D6): the request's address wins (a 'link' never over an opened request's
 * address); else the pushed commit's link (commit, else head) — only into an empty field or over an older commit link
 * of the same repository. null: leave the field as it is.
 */
export function prFieldNext(current: string | null | undefined, s: ShipRecord): string | null {
  const cur = (current ?? '').trim()
  if (s.request && s.failed?.step !== 'request') {
    if (s.request.how === 'link' && cur && requestNumber(cur)) return null
    return s.request.url === cur ? null : s.request.url
  }
  const sha = s.commit?.sha ?? s.head
  if (!s.pushed || !sha || !s.web) return null
  const link = commitUrl(s.web, sha)
  if (link === cur) return null
  const isCommitLink = cur.startsWith(`${s.web.base}/commit/`) || cur.startsWith(`${s.web.base}/-/commit/`)
  return !cur || isCommitLink ? link : null
}

/**
 * Pipeline editor: the connected worker's repos (of this project's Repo options) where a git stage cannot do all it
 * says. push / pr: push off → commits only · pr: requests off → a link only · comment / merge: push off (nothing was
 * pushed, so there is no request) or requests off → fails (`prFails`: both lines say "fails there").
 * Only an explicit `push: false` / `pr: 'none'` counts — an older worker announces neither and warns about nothing.
 */
export function gitStageWarnings(action: GitAction | null | undefined, repos: ReadonlyArray<{ name: string; push?: unknown; pr?: unknown }>): { pushOff: string[]; prOff: string[]; prFails: boolean } {
  const names = (pick: (r: { push?: unknown; pr?: unknown }) => boolean) => [...new Set(repos.filter(pick).map((r) => r.name))]
  if (action === 'comment' || action === 'merge') {
    const pushOff = names((r) => r.push === false)
    const prOff = names((r) => r.pr === 'none').filter((n) => !pushOff.includes(n))
    return { pushOff, prOff, prFails: pushOff.length + prOff.length > 0 }
  }
  if (action !== 'push' && action !== 'pr') return { pushOff: [], prOff: [], prFails: false }
  const pushOff = names((r) => r.push === false)
  const prOff = action === 'pr' ? names((r) => r.pr === 'none').filter((n) => !pushOff.includes(n)) : []
  return { pushOff, prOff, prFails: false }
}
