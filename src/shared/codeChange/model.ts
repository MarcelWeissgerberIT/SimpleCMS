import { codeReference, type CodeReference } from '../mcp/codeReference.ts'
import { sha256Hex } from '../mcp/sha256.ts'
/** Range replacements, never whole-file overwrites of excerpted files. Original snapshots are immutable. */
export type ChangeFile = { id: string; reference: CodeReference; before: string[]; checkedAt: number }
export type Proposal = {
  id: string
  at: number
  instruction: string
  reason: string
  checks: string[]
  edits: { file: string; after: string[] }[]
  author: 'you' | 'ai'
}
export type Delivery = {
  proposal: string
  ref: number
  server: string
  hash: string
  filename: string
  at: number
  state: 'pending' | 'confirmed' | 'uncertain'
  url: string
}
export type RemoteChange = {
  proposal: string
  id: string
  hash: string
  state: string
  publishConfigured: boolean
  url: string
  target?: { url: string; project: string; branch: string; hash: string }
}
export type CodeChange = {
  format: 'one-code-change'
  version: 1
  id: string
  origin: { analysis: string; revision: string; finding: string; title: string }
  references: CodeReference[]
  files: ChangeFile[]
  proposals: Proposal[]
  accepted: string | null
  deliveries: Delivery[]
  remote: RemoteChange[]
}
const fail = (): never => {
  throw Error('changeFormat')
}
const obj = (x: any) => (x && typeof x === 'object' && !Array.isArray(x) ? x : fail())
const str = (x: any, n = 4000): string => (typeof x === 'string' && x.length <= n ? x : fail())
const num = (x: any): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fail())
const list = <T>(x: any, f: (a: any) => T, n: number): T[] => (Array.isArray(x) && x.length <= n ? x.map(f) : fail())
const id = (x: any) => {
  const s = str(x, 100)
  return /^[\w-]+$/.test(s) ? s : fail()
}
const ref = (x: any) => codeReference(JSON.stringify(x)) ?? fail()
const unique = <T extends { id: string }>(xs: T[]) => (new Set(xs.map((x) => x.id)).size === xs.length ? xs : fail())
const lines = (x: any) =>
  list(
    x,
    (s) => {
      const v = str(s, 4000)
      return /[\r\n\0]/.test(v) ? fail() : v
    },
    160,
  )
const safePath = (path: string) =>
  !!path &&
  !path.startsWith('/') &&
  !path.split('/').some((p) => p === '..' || p === '.' || !p) &&
  !/[\\\x00-\x1f\x7f]/.test(path)
export function validateFiles(files: ChangeFile[]) {
  if (!files.length || files.length > 3) fail()
  const first = files[0].reference
  for (const [i, f] of files.entries()) {
    const c = f.reference.citation
    if (
      !f.reference.server ||
      f.reference.server !== first.server ||
      c.repo !== first.citation.repo ||
      c.snapshot !== first.citation.snapshot ||
      c.commit !== first.citation.commit ||
      !safePath(c.path) ||
      f.before.length !== c.lines[1] - c.lines[0] + 1 ||
      f.before.length > 120 ||
      f.before.join('\n').length > 16000
    )
      fail()
    if (
      files
        .slice(0, i)
        .some(
          (p) =>
            p.reference.citation.path === c.path &&
            p.reference.citation.lines[0] <= c.lines[1] &&
            p.reference.citation.lines[1] >= c.lines[0],
        )
    )
      fail()
  }
}
export function readProposal(input: unknown, files: ChangeFile[]): Proposal {
  const v = obj(input),
    edits = list(v.edits, (e) => ({ file: id(e.file), after: lines(e.after) }), 3)
  if (
    !edits.length ||
    new Set(edits.map((e) => e.file)).size !== edits.length ||
    edits.some((e) => !files.some((f) => f.id === e.file) || e.after.join('\n').length > 20000)
  )
    fail()
  if (edits.every((e) => JSON.stringify(e.after) === JSON.stringify(files.find((f) => f.id === e.file)!.before)))
    throw Error('noChange')
  if (!['ai', 'you'].includes(v.author)) fail()
  return {
    id: id(v.id),
    at: num(v.at),
    instruction: str(v.instruction, 8000),
    reason: str(v.reason),
    checks: list(v.checks, (s) => str(s, 1000), 12),
    edits,
    author: v.author,
  }
}
export function readChange(raw: string): CodeChange {
  if (raw.length > 450000) fail()
  const v = obj(JSON.parse(raw))
  if (v.format !== 'one-code-change' || v.version !== 1) fail()
  const o = obj(v.origin),
    references = list(v.references, ref, 24)
  const files = unique(
    list(
      v.files,
      (f) => ({ id: id(f.id), reference: ref(f.reference), before: lines(f.before), checkedAt: num(f.checkedAt) }),
      3,
    ),
  )
  if (files.length) validateFiles(files)
  const proposals = unique(list(v.proposals, (p) => readProposal(p, files), 10))
  if (v.accepted !== null && !proposals.some((p) => p.id === v.accepted)) fail()
  const remote = list(
    v.remote ?? [],
    (r) => {
      const url = str(r.url, 2000)
      if (url) {
        const u = new URL(url)
        if (u.protocol !== 'https:' || u.username || u.password) fail()
      }
      if (!proposals.some((p) => p.id === r.proposal) || !/^[a-f0-9]{64}$/.test(r.hash)) fail()
      const target = r.target
        ? {
            url: str(r.target.url, 2000),
            project: str(r.target.project, 100),
            branch: str(r.target.branch, 255),
            hash: str(r.target.hash, 64),
          }
        : undefined
      if (target) {
        const u = new URL(target.url)
        if (u.protocol !== 'https:' || u.username || u.password || !/^[a-f0-9]{64}$/.test(target.hash)) fail()
      }
      return {
        proposal: id(r.proposal),
        id: id(r.id),
        hash: r.hash,
        state: str(r.state, 40),
        publishConfigured: r.publishConfigured === true,
        url,
        target,
      }
    },
    20,
  )
  const deliveries = list(
    v.deliveries,
    (d) => {
      if (
        !['pending', 'confirmed', 'uncertain'].includes(d.state) ||
        !Number.isSafeInteger(d.ref) ||
        d.ref < 1 ||
        !proposals.some((p) => p.id === d.proposal) ||
        !/^[a-f0-9]{64}$/.test(d.hash)
      )
        fail()
      const url = str(d.url, 2000)
      if (url) {
        const u = new URL(url)
        if (u.protocol !== 'https:' || u.username || u.password) fail()
      }
      return {
        proposal: id(d.proposal),
        ref: d.ref,
        server: str(d.server, 200),
        hash: d.hash,
        filename: str(d.filename, 200),
        at: num(d.at),
        state: d.state,
        url,
      } as Delivery
    },
    20,
  )
  return {
    format: 'one-code-change',
    version: 1,
    id: id(v.id),
    origin: {
      analysis: str(o.analysis, 100),
      revision: str(o.revision, 100),
      finding: str(o.finding, 100),
      title: str(o.title, 300),
    },
    references,
    files,
    proposals,
    accepted: v.accepted,
    deliveries,
    remote,
  }
}
export function newChange(id: string, origin: CodeChange['origin'], references: CodeReference[]): CodeChange {
  return {
    format: 'one-code-change',
    version: 1,
    id,
    origin,
    references,
    files: [],
    proposals: [],
    accepted: null,
    deliveries: [],
    remote: [],
  }
}
export function packageText(a: CodeChange, p: Proposal) {
  return JSON.stringify(
    {
      format: 'one-code-change-package',
      version: 1,
      id: a.id,
      origin: a.origin,
      proposal: p,
      accepted: a.accepted === p.id,
      base: {
        server: a.files[0].reference.server,
        repo: a.files[0].reference.citation.repo,
        snapshot: a.files[0].reference.citation.snapshot,
        commit: a.files[0].reference.citation.commit,
      },
      replacements: p.edits.map((e) => {
        const f = a.files.find((f) => f.id === e.file)!
        return {
          citation: f.reference.citation,
          before: f.before,
          after: e.after,
          beforeLinesHash: sha256Hex(JSON.stringify(f.before)),
        }
      }),
      application: {
        mode: 'exact-line-ranges',
        requireBaseCommit: true,
        preserveLineEndings: true,
        preserveFinalNewline: true,
        atomic: true,
      },
      checks: {
        source: 'Reverify pinned citations and exact before lines immediately before application',
        build: 'not-run',
        tests: 'not-run',
        repository: 'not-modified',
        recommended: p.checks,
      },
    },
    null,
    2,
  )
}
/** Consumer contract: compute every replacement before writing any file; never search-and-replace elsewhere. */
export function applyRanges(text: string, file: ChangeFile, after: string[]) {
  const crlf = text.includes('\r\n'),
    sep = crlf ? '\r\n' : '\n'
  if ((crlf && text.replace(/\r\n/g, '').includes('\n')) || text.replace(/\r\n/g, '').includes('\r'))
    throw Error('mixedNewlines')
  const final = text.endsWith(sep),
    all = text.split(sep)
  if (final) all.pop()
  const [start, end] = file.reference.citation.lines
  if (JSON.stringify(all.slice(start - 1, end)) !== JSON.stringify(file.before)) throw Error('sourceMismatch')
  const result = [...all.slice(0, start - 1), ...after, ...all.slice(end)]
  return result.join(sep) + (final && result.length ? sep : '')
}
/** LCS gives actual changed lines, bounded by the scoped edit limits. */
export function lineDiff(before: string[], after: string[]) {
  const dp = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      dp[i][j] = before[i] === after[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { kind: 'same' | 'remove' | 'add'; text: string; old: number | null; next: number | null }[] = []
  let i = 0,
    j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      out.push({ kind: 'same', text: before[i], old: i++, next: j++ })
    } else if (j < after.length && (i === before.length || dp[i][j + 1] > dp[i + 1][j]))
      out.push({ kind: 'add', text: after[j], old: null, next: j++ })
    else out.push({ kind: 'remove', text: before[i], old: i++, next: null })
  }
  return out
}
