/**
 * The pieces a fuse plate and a phone fuse card share (plan §3.5, §3.8): the three lamps, the path as chips, the
 * generated sentence, the facts row — and the words they need (message refs resolved live: titles, property names,
 * module names, a member's name; never stored).
 *
 * The path (`pathOf`): the outside source (hatched) → the decider → each step (a written field as a net chip, the module
 * it starts) → the way out ("CAN SEND", signal outline on an open fuse only). Folded steps read "+n steps" (a press shows
 * them all); a loop is marked ↺. On the phone the path runs downwards and the decider's first write is said in words
 * between the chips ("sets „Weiterleiten“").
 */
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  Bot,
  CloudUpload,
  Command,
  Database,
  FileCode2,
  FileText,
  GitBranch,
  GitPullRequest,
  Globe,
  Inbox,
  LayoutGrid,
  ListFilter,
  Mail,
  MousePointerClick,
  PenLine,
  Plug,
  RefreshCw,
  Rows3,
  Scissors,
  Send,
  Server,
  Sigma,
  Webhook,
  Workflow,
  Clock,
  type LucideIcon,
} from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud'
import { fuseSay, nameOf, sayMsg } from '../plain'
import type { Chain, Fact, Mitigation, Model, ModelInput, Module, ModuleKey, MsgRef, Place, Why } from '../types'
import type { Words } from './words'

const P = 'features.patchbay'

/* ------------------------------------------------------------------ words */

/** Vars that may carry a member's account id (team): shown as that member's name. */
const MEMBER_VARS = ['who', 'member', 'creator', 'name']

export interface PlateWords {
  w: Words
  model: Model
  input: ModelInput
  /** a message ref in words (ids → titles / names, a member id → the member's name) */
  say(msg: MsgRef | undefined): string
  /** a member (account id, or null = the local person) by name — "you" for this person */
  member(id: string | null | undefined): string | null
}

function plateWords(model: Model, input: ModelInput, w: Words, people: Array<{ id: string; name: string }>, me: string | null): PlateWords {
  const member = (id: string | null | undefined): string | null => {
    if (!id) return input.ctx.team ? null : w.t(`${P}.plate.you`)
    if (id === me) return w.t(`${P}.plate.you`)
    return people.find((p) => p.id === id)?.name.trim() || null
  }
  const say = (msg: MsgRef | undefined): string => {
    if (!msg) return ''
    const vars = { ...(msg.vars ?? {}) }
    for (const k of MEMBER_VARS) if (typeof vars[k] === 'string') vars[k] = member(vars[k] as string) ?? w.t(`${P}.plate.someone`)
    return sayMsg({ key: msg.key, vars }, model, input, w.ctx)
  }
  return { w, model, input, say, member }
}

export function usePlateWords(model: Model, input: ModelInput, w: Words): PlateWords {
  const people = useWorkspace((s) => s.people)
  const me = useCloud((s) => s.user?.id ?? null)
  return useMemo(() => plateWords(model, input, w, people, me), [people, me, model, input, w])
}

/** The same words before the model is there (null until it is) — the page's patching (B16) holds them from the start. */
export function usePlateWordsOf(model: Model | null, input: ModelInput | null, w: Words | null): PlateWords | null {
  const people = useWorkspace((s) => s.people)
  const me = useCloud((s) => s.user?.id ?? null)
  return useMemo(() => (model && input && w ? plateWords(model, input, w, people, me) : null), [people, me, model, input, w])
}

/* ------------------------------------------------------------------ icons */

const KIND_ICON: Record<Module['kind'], LucideIcon> = {
  server: Server,
  clock: Clock,
  rowTrigger: Rows3,
  button: MousePointerClick,
  command: Command,
  incoming: ArrowDownToLine,
  sync: RefreshCw,
  clippings: Scissors,
  agent: Bot,
  automation: Workflow,
  script: FileCode2,
  autofill: PenLine,
  organise: ListFilter,
  pipeline: GitPullRequest,
  bridge: Plug,
  kit: Sigma,
  database: Database,
  page: FileText,
  inbox: Inbox,
  everything: LayoutGrid,
  outbound: Globe,
  outbox: Send,
}
const EXIT_ICON: Record<NonNullable<Module['exit']>, LucideIcon> = { webhook: Webhook, git: GitBranch, http: Globe, mail: Send, mcp: Server, sync: CloudUpload }

/** A module's icon (lucide, 14 px): the kind's — a mail row trigger a letter, a way out its exit type's. */
export function KindIcon({ m, input }: { m: Module; input: ModelInput }) {
  let Icon = m.kind === 'outbound' && m.exit ? EXIT_ICON[m.exit] : KIND_ICON[m.kind]
  if (m.ref.kind === 'rowTrigger') {
    const db = m.ref.db
    const sys = input.databases.find((d) => d.id === db)?.system
    if (sys === 'mails' || (typeof sys === 'string' && sys.startsWith('mail-'))) Icon = Mail
  }
  return <Icon className="pb-pn__i" size={14} strokeWidth={1.7} aria-hidden="true" />
}

/* ------------------------------------------------------------------ the path */

export type PathNode =
  | { kind: 'module'; key: ModuleKey; role: 'source' | 'decider' | 'step' | 'exit'; outside?: boolean }
  | { kind: 'place'; place: Place; first: boolean }
  | { kind: 'more'; n: number }
  | { kind: 'loop' }

const placeKey = (p: Place): string => ('db' in p ? `db:${p.db}:${p.prop ?? '*'}` : 'page' in p ? `page:${p.page}` : 'inbox' in p ? 'inbox' : 'everything' in p ? 'everything' : `x:${p.external}`)

/** A place that is the whole database of the module it leads into (`pipeline:<db>`, `database:<db>`). */
function wholeOf(p: Place, to: ModuleKey): boolean {
  if (!('db' in p) || (p.prop && p.prop !== '*')) return false
  const [kind, id] = to.split(':')
  return (kind === 'pipeline' || kind === 'database') && !!id && decodeURIComponent(id) === p.db
}

/** The path's nodes in order; `all` = every step (the "+n steps" chip pressed). */
export function pathOf(chain: Chain, all: boolean): PathNode[] {
  const out: PathNode[] = []
  const last = () => out[out.length - 1]
  const mod = (key: ModuleKey, role: 'source' | 'decider' | 'step' | 'exit', outside?: boolean) => {
    const l = last()
    if (l?.kind === 'module' && l.key === key) {
      if (role === 'exit') l.role = 'exit'
      return
    }
    out.push({ kind: 'module', key, role, ...(outside ? { outside } : {}) })
  }
  const place = (p: Place) => {
    const l = last()
    if (l?.kind === 'place' && placeKey(l.place) === placeKey(p)) return
    out.push({ kind: 'place', place: p, first: !out.some((n) => n.kind === 'place') })
  }
  mod(chain.source, 'source', !!chain.lamps?.outside.on)
  if (chain.decider) mod(chain.decider, 'decider')
  const steps = chain.steps
  const shown = all ? steps.length : Math.min(steps.length, Math.max(1, chain.shown))
  for (let i = 0; i < shown; i++) {
    const s = steps[i]
    if (typeof s.to !== 'string') place(s.to)
    else {
      // a whole database handed to its own module (a task row → its pipeline) says nothing a chip would add
      if (s.via && !wholeOf(s.via, s.to)) place(s.via)
      else if (s.via && last()?.kind === 'place' && placeKey((last() as { place: Place }).place) === placeKey(s.via)) out.pop()
      mod(s.to, s.to === chain.exit?.module ? 'exit' : 'step')
    }
  }
  if (shown < steps.length) {
    out.push({ kind: 'more', n: Math.max(1, steps.length - shown - 1) })
    if (chain.exit) mod(chain.exit.module, 'exit')
  }
  if (chain.loop) out.push({ kind: 'loop' })
  return out
}

/** A place on a chip ("„Weiterleiten“" — a field in the language's quotes; else the flag's words: "Mails · new row", a page's title). */
function placeLabel(pw: PlateWords, p: Place): string {
  if ('db' in p && p.prop && p.prop !== '*' && p.prop !== '+row' && p.prop !== '-row') {
    const name = pw.input.databases.find((d) => d.id === p.db)?.properties.find((x) => x.id === p.prop)?.name.trim() || pw.w.t(`${P}.untitled`)
    return `${pw.w.t(`${P}.q.open`)}${name}${pw.w.t(`${P}.q.close`)}`
  }
  return pw.w.flag({ key: '', place: p, writers: [], listeners: [] })
}

/** What the decider's first write does, in words ("sets „Weiterleiten“") — the phone path's line between its chips. */
function viaLabel(pw: PlateWords, p: Place): string {
  const t = pw.w.t
  if ('db' in p) {
    const db = pw.input.pages[p.db]?.title.trim() || t(`${P}.untitled`)
    if (p.prop === '+row') return t(`${P}.plate.via.row`, { db })
    if (!p.prop || p.prop === '*' || p.prop === '-row') return t(`${P}.plate.via.any`, { db })
    return t(`${P}.plate.via.set`, { prop: placeLabel(pw, p) })
  }
  if ('page' in p) return t(`${P}.plate.via.page`, { page: pw.input.pages[p.page]?.title.trim() || t(`${P}.untitled`) })
  return t(`${P}.plate.via.place`, { place: placeLabel(pw, p) })
}

/**
 * Does the path fit on one row (measured)? A row never wraps — an arrow would dangle at a line's end: while the chips
 * overflow the plate's width, the path stands as the phone's column instead. Another width, other chips or another
 * language measure the row again (before the frame is painted).
 */
function useStacked(ol: RefObject<HTMLOListElement | null>, off: boolean, content: unknown): boolean {
  const [stacked, setStacked] = useState(false)
  useLayoutEffect(() => setStacked(false), [content])
  useLayoutEffect(() => {
    const el = ol.current
    if (!el || off) return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return
      w = el.clientWidth
      setStacked(false)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ol, off])
  useLayoutEffect(() => {
    const el = ol.current
    if (!el || off || stacked || el.clientWidth === 0) return
    if (el.scrollWidth > el.clientWidth + 1) setStacked(true)
  })
  return stacked
}

/**
 * The path as chips (an ordered list; the arrows are decoration). `hot`: the open fuse's way out in signal ("CAN
 * SEND"); `vertical`: the phone's column, the decider's first write said between the chips. A plate too narrow for the
 * row stacks the same chips into a column (useStacked: one row, never wrapped — no arrow dangles at a line's end).
 */
export function FusePath({ chain, pw, hot, vertical: phone }: { chain: Chain; pw: PlateWords; hot: boolean; vertical?: boolean }) {
  const [all, setAll] = useState(false)
  const nodes = useMemo(() => pathOf(chain, all), [chain, all])
  const t = pw.w.t
  const mods = useMemo(() => new Map(pw.model.modules.map((m) => [m.key, m])), [pw.model])
  const olRef = useRef<HTMLOListElement>(null)
  const stacked = useStacked(olRef, !!phone, `${pw.w.lang}|${nodes.length}|${chain.exit?.module ?? ''}|${hot}`)
  // the phone says a written place in words between its chips and names each chip's kind; a stacked plate keeps the
  // row's chips — only the arrows turn down
  const vertical = !!phone
  const Arrow = vertical || stacked ? ArrowDown : ArrowRight
  const items: ReactNode[] = []
  nodes.forEach((n, i) => {
    const key = `${i}`
    if (n.kind === 'place' && vertical) {
      // the phone: a written place is said in words on the arrow between its chips
      items.push(
        <li key={key} className="pb-path__via">
          <Arrow className="pb-path__arrow" size={13} strokeWidth={1.7} aria-hidden="true" />
          <span className="label">{viaLabel(pw, n.place)}</span>
        </li>,
      )
      return
    }
    if (i > 0 && !(vertical && nodes[i - 1].kind === 'place'))
      items.push(
        <li key={`a${key}`} className="pb-path__sep" aria-hidden="true">
          <Arrow className="pb-path__arrow" size={13} strokeWidth={1.7} />
        </li>,
      )
    if (n.kind === 'module') {
      const m = mods.get(n.key)
      // a module the rack does not draw (a closed plate's path as it was, a source only the path names) is named too
      const name = m ? pw.w.name(m) : nameOf(pw.model, pw.input, n.key, pw.w.ctx)
      const cls = ['pb-pn', n.outside ? 'pb-pn--outside' : '', n.role === 'exit' ? (hot ? 'pb-pn--out pb-pn--hot' : 'pb-pn--out') : ''].filter(Boolean).join(' ')
      const sub = n.outside ? t(`${P}.tag.outside`) : n.role === 'exit' ? t(`${P}.fuse.canSend`) : vertical && m ? [pw.w.kind(m), ...pw.w.tags(m).filter((x) => x.tag === 'direct' || x.tag === 'stage').map((x) => x.text)].join(' · ') : ''
      items.push(
        <li key={key} className={cls} data-key={n.key} title={name}>
          {m && <KindIcon m={m} input={pw.input} />}
          <span className="pb-pn__n">{name}</span>
          {sub && <span className="label pb-pn__s">{sub}</span>}
        </li>,
      )
    } else if (n.kind === 'place') {
      items.push(
        <li key={key} className="pb-pn pb-pn--net">
          <span className="pb-pn__n">{placeLabel(pw, n.place)}</span>
        </li>,
      )
    } else if (n.kind === 'more') {
      items.push(
        <li key={key} className="pb-pn pb-pn--more">
          <button type="button" className="pb-pn__more" title={t(`${P}.plate.stepsTitle`)} onClick={() => setAll(true)} data-testid="pb-path-more">
            {t(n.n === 1 ? `${P}.steps.more.one` : `${P}.steps.more`, { n: n.n })}
          </button>
        </li>,
      )
    } else {
      items.push(
        <li key={key} className="pb-pn pb-pn--loop" title={t(`${P}.plate.loopTitle`)}>
          <span aria-hidden="true">↺</span>
          <span className="label">{t(`${P}.plate.loop`)}</span>
        </li>,
      )
    }
  })
  return (
    <ol ref={olRef} className={vertical || stacked ? 'pb-path pb-path--v' : 'pb-path'} aria-label={t(`${P}.plate.path`)} data-stacked={stacked ? '' : undefined} data-testid="pb-path">
      {items}
    </ol>
  )
}

/** The path in one line of plain names (the fuse list's rows, a tab's name): "Mails → Inbox-Helfer → … → Webhook". */
export function pathLine(chain: Chain, pw: PlateWords): string {
  const mods = new Map(pw.model.modules.map((m) => [m.key, m]))
  return pathOf(chain, false)
.map((n) => (n.kind === 'module' ? (mods.get(n.key) ? pw.w.name(mods.get(n.key)!) : nameOf(pw.model, pw.input, n.key, pw.w.ctx)) : n.kind === 'place' ? placeLabel(pw, n.place) : n.kind === 'more' ? pw.w.t(n.n === 1 ? `${P}.steps.more.one` : `${P}.steps.more`, { n: n.n }) : '↺'))
    .join(' → ')
}

/* ------------------------------------------------------------------ the lamps */

const LAMPS = ['outside', 'private', 'out'] as const

/** The three lamps: filled dot = met, ring = not met (shape, not colour alone); the state also in words for readers. */
export function FuseLamps({ lamps, pw, head }: { lamps: { outside: Why; private: Why; out: Why }; pw: PlateWords; head: string }) {
  const t = pw.w.t
  return (
    <div className="pb-tri" data-testid="pb-lamps">
      <span className="label pb-tri__k">{head}</span>
      <ul className="pb-tri__rows">
        {LAMPS.map((k) => {
          const why = lamps[k]
          return (
            <li key={k} className="pb-tri__row" data-on={why.on || undefined} data-lamp={k}>
              <span className="pb-tri__lamp" aria-hidden="true" />
              <span className="pb-tri__t">
                <span className="pb-tri__name">
                  {t(`${P}.fuse.${k}`)}
                  <span className="visually-hidden"> — {t(why.on ? `${P}.plate.lamp.on` : `${P}.plate.lamp.off`)}</span>
                </span>
                <small>{pw.say(why.say)}</small>
                {why.detail && <small className="pb-tri__d">{pw.say(why.detail)}</small>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The phone's short lamp row: "● FROM OUTSIDE ● PRIVATE ● WAY OUT". */
export function ShortLamps({ lamps, pw }: { lamps: { outside: Why; private: Why; out: Why }; pw: PlateWords }) {
  const t = pw.w.t
  return (
    <ul className="pb-tri3" data-testid="pb-lamps">
      {LAMPS.map((k) => (
        <li key={k} data-on={lamps[k].on || undefined}>
          <i aria-hidden="true" />
          {t(`${P}.plate.short.${k}`)}
          <span className="visually-hidden"> — {t(lamps[k].on ? `${P}.plate.lamp.on` : `${P}.plate.lamp.off`)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ the sentence and the facts */

/** The plate's sentence (plain.ts fuseSay: no pronouns in German, names bold). */
export function FuseSentence({ chain, pw, className }: { chain: Chain; pw: PlateWords; className: string }) {
  const parts = useMemo(() => fuseSay({ chain }, pw.model, pw.input, pw.w.ctx), [chain, pw])
  if (!parts.length) return null
  return (
    <p className={className} data-testid="pb-say">
      {parts.map((p, i) => (p.b ? <b key={i}>{p.t}</b> : <Fragment key={i}>{p.t}</Fragment>))}
    </p>
  )
}

/** The facts row (mono): CHANGES Apply directly · ACCESS Everything · TRIGGER Field „…“ → POST · CHAIN 3 steps … */
export function FuseFacts({ facts, mitigations, pw }: { facts: Fact[]; mitigations: Mitigation[]; pw: PlateWords }) {
  const t = pw.w.t
  return (
    <>
      <div className="pb-facts" data-testid="pb-facts">
        {facts.map((f) => (
          <span key={f.kind} className="label pb-fact" data-fact={f.kind}>
            {t(`${P}.fact.label.${f.kind}`)} <b>{pw.say(f.say)}</b>
          </span>
        ))}
      </div>
      {mitigations.length > 0 && (
        <div className="pb-facts pb-facts--m" data-testid="pb-mitigations">
          <span className="label pb-fact">
            {t(`${P}.plate.inPlace`)} <b>{mitigations.map((m) => pw.say(m.say)).join(' · ')}</b>
          </span>
        </div>
      )}
    </>
  )
}
