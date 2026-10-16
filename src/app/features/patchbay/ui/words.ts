/**
 * The rack's words (plan §3.3, §3.11): a module's kind line, name, sub-line, tags, jack labels, net tags and flags,
 * folds and column heads — looked up live from the model input (the model holds ids only). Names and descriptions come
 * from plain.ts (B4: the same words the Klartext and the fuse plate use). Also which modules and flags sit on an open
 * fuse's path ("F1" tags, the dashed orange frame — the only orange on the rack).
 */
import { useMemo } from 'react'
import { useLang, useT } from '../../../i18n'
import type { Translate } from '@/shared/i18n'
import { labelOf, MODELS, modelRow, shortOfLabel } from '@/shared/ai/models'
import { fmtUsd as fmtMoney } from '../../../lib/money'
import { chainModules, type ColumnCount, type FoldSlot } from '../layout'
import { edgesAt, moduleOfJack } from './lit'
import { describe, nameOf, placeNameOf, type PlainCtx } from '../plain'
import type { Column, FuseState, Jack, Model, ModelInput, Module, ModuleKey, ModuleTag, NetLabel, NetTag } from '../types'

const P = 'features.patchbay'

/** Tags a module's kind line shows as chips (in this order); the rest live in its description. */
const SHOWN_TAGS: ModuleTag[] = ['outside', 'direct', 'stage', 'readonly', 'outbound', 'afterApproval', 'asksFirst', 'server', 'blocked', 'awaitsConfirm', 'handRunOnly', 'disabled', 'thisDevice']
/** Kinds whose "by hand" sits in the kind line ("BUTTON · BY HAND", as the mock) rather than as a chip. */
const HAND_KINDS = new Set(['button', 'command'])

export interface FuseMarks {
  /** module → the labels of the open fuses whose path runs through it (F-order) */
  modules: Map<ModuleKey, string[]>
  /** net key → labels (the flag pair on a path) */
  nets: Map<string, string[]>
  /** every edge on an open fuse's path */
  edges: Set<string>
  /** open fuses in F-order */
  open: FuseState[]
}

const marksCache = new WeakMap<Model, FuseMarks>()

/** "1 module" / "4 modules" — a count said in a sentence (fix ui-words: t() picks no `.one` by itself). */
export const countOf = (t: (k: string, v?: Record<string, string | number>) => string, what: 'modules' | 'cables' | 'ghosts' | 'planned', n: number): string =>
  t(n === 1 ? `${P}.n.${what}.one` : `${P}.n.${what}`, { n })

/** A fuse label's number ("F12" → 12; anything else last). */
export const fuseNo = (label: string): number => {
  const n = Number(label.replace(/^\D+/, ''))
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER
}

/** Open fuses (not allowed; a lapsed one counts as open) and what their paths run through. */
export function fuseMarks(model: Model): FuseMarks {
  const had = marksCache.get(model)
  if (had) return had
  const fuses = model.fuses as FuseState[]
  // in F-order (F1, F2 …): the readout's FUSE cell, F, the glyphs and the plate's tabs all count the same way
  const open = fuses.filter((f) => f.allowed?.state !== 'allowed').sort((a, b) => fuseNo(a.label) - fuseNo(b.label))
  const modules = new Map<ModuleKey, string[]>()
  const nets = new Map<string, string[]>()
  const edges = new Set<string>()
  const put = (map: Map<string, string[]>, k: string, label: string) => {
    const list = map.get(k) ?? []
    if (!list.includes(label)) list.push(label)
    map.set(k, list)
  }
  for (const f of open) {
    for (const k of chainModules(f.chain, model)) put(modules, k, f.label)
    for (const e of [...(f.chain.edges ?? []), f.at]) {
      edges.add(e)
      for (const end of e.split('>')) if (end.startsWith('net:')) put(nets, end, f.label)
    }
  }
  const out = { modules, nets, edges, open }
  marksCache.set(model, out)
  return out
}

export interface Words {
  t: Translate
  lang: 'en' | 'de'
  ctx: PlainCtx
  name(m: Module): string
  kind(m: Module): string
  sub(m: Module): string | null
  /** a pipeline's worker when it cannot run as it should (§3.3, §6 U24): the window's word, its title, the LED */
  worker(m: Module): { word: string; title: string; led: 'off' | 'warn' } | null
  tags(m: Module): Array<{ tag: ModuleTag; text: string }>
  describe(m: Module): string
  /** a jack's label; `tier` 1 = the short form a narrow module takes ("4 DB", "Out 1"), 2 = none (the title keeps it) */
  jack(j: Jack, m: Module, tier?: number): string
  /** a jack's title / name: where its cables go (an out-jack) or come from (an in-jack) — `to` = its peers */
  jackTitle(j: Jack, m: Module, to: string[]): string
  /** what a jack (or a net flag's key) is cabled to, by name */
  peers(jack: string): string[]
  /** a property's name (untitled: the word for it) */
  fieldName(db: string, prop: string): string
  net(n: NetTag, m: Module): string
  netTitle(n: NetTag, m: Module): string
  flag(n: NetLabel): string
  colName(col: Column): string
  colCount(c: ColumnCount): string
  fold(f: FoldSlot): { label: string; names: string[]; title: string }
  knobModel(m: Module): { label: string; v: number; ticks: number }
  knobBudget(m: Module): { label: string; v: number; ticks: number }
}

/** The models an agent's picker offers (the model knob's ticks after the first, "Standard"). */
const MODEL_TICKS: string[] = MODELS.filter((r) => r.route.p === 'anthropic' && r.selectable).map((r) => r.route.m)

/**
 * What the setup adds to the words (B12): the names of the modules a profile's lamps will make (ghosts — ghostsOf's
 * names, the very titles the setup gives them) and the lamps that make or touch each module ("04").
 */
export interface WordsExtra {
  names?: Record<ModuleKey, string>
  chips?: Record<ModuleKey, number[]>
}

export function makeWords(t: Translate, lang: 'en' | 'de', model: Model, input: ModelInput, extra?: WordsExtra | null): Words {
  const ctx: PlainCtx = { lang, t }
  const ghostName = (m: Module): string | null => (m.tags.includes('ghost') ? (extra?.names?.[m.key] ?? '') || t(`${P}.kind.${m.kind}`) : null)
  const title = (id: string | null | undefined) => (id ? input.pages[id]?.title.trim() : '') || t(`${P}.untitled`)
  const db = (id: string) => input.databases.find((d) => d.id === id)
  const prop = (dbId: string, id: string) => db(dbId)?.properties.find((p) => p.id === id)?.name.trim() || t(`${P}.untitled`)
  const name = (m: Module) => ghostName(m) ?? extra?.names?.[m.key] ?? nameOf(model, input, m.key, ctx)
  const kind = (m: Module) => {
    const k = m.kind === 'outbox' ? t(`${P}.module.outbox.kind`) : m.kind === 'outbound' && m.exit ? t(`${P}.exit.${m.exit}`) : t(`${P}.kind.${m.kind}`)
    return HAND_KINDS.has(m.kind) && m.tags.includes('byHand') ? `${k} · ${t(`${P}.tag.byHand`)}` : k
  }
  const sub = (m: Module): string | null => {
    const r = m.ref
    if (r.kind === 'server') {
      if (r.runtime) return t(`${P}.tag.server`)
      const url = input.servers.find((s) => s.server.id === r.id)?.server.url
      try {
        return url ? new URL(url).host : null
      } catch {
        return null
      }
    }
    if (r.kind === 'automation') {
      if (m.folds?.script) return t(`${P}.sub.viaScript`, { name: input.scripts.find((s) => s.script.id === m.folds!.script)?.script.name.trim() || t(`${P}.untitled`) })
      const a = db(r.db)?.automations.find((x) => x.id === r.id)
      if (!a) return null
      if (a.trigger.type === 'row_created') return t(`${P}.sub.trigger.created`)
      if (a.trigger.type === 'row_deleted') return t(`${P}.sub.trigger.deleted`)
      return a.trigger.propertyId ? t(`${P}.sub.trigger.field`, { prop: prop(r.db, a.trigger.propertyId) }) : t(`${P}.sub.trigger.any`)
    }
    return null
  }
  // offline: grey; too old or an unsafe version: amber — always with its word in the window, never colour alone
  const worker = (m: Module) => {
    if (m.ref.kind !== 'pipeline') return null
    if (!input.worker.online) return { word: t(`${P}.worker.offline`), title: t(`${P}.worker.offlineTitle`), led: 'off' as const }
    if (input.worker.verdict === 'unsafe') return { word: t(`${P}.worker.unsafe`), title: t(`${P}.worker.unsafeTitle`), led: 'warn' as const }
    if (input.worker.verdict === 'outdated') return { word: t(`${P}.worker.old`), title: t(`${P}.worker.oldTitle`), led: 'warn' as const }
    return null
  }
  const tags = (m: Module) => {
    const out: Array<{ tag: ModuleTag; text: string }> = []
    for (const tag of SHOWN_TAGS) {
      if (!m.tags.includes(tag)) continue
      // a switched-off module that only runs by hand says it once
      if (tag === 'disabled' && m.tags.includes('handRunOnly')) continue
      out.push({ tag, text: t(`${P}.tag.${tag}`) })
    }
    return out
  }
  const jack = (j: Jack, m: Module, tier = 0): string => {
    if (tier >= 2) return ''
    if (m.kind === 'server' && (j.role === 'read' || j.role === 'write')) {
      const n = j.count === undefined ? '?' : String(j.count)
      return `${t(`${P}.jack.${j.role}`)}${j.guessed ? '?' : ''} ${n}`
    }
    if (m.kind === 'server' && j.role === 'out') return t(tier ? `${P}.jack.outShort` : `${P}.jack.out`, { n: j.count ?? 0 })
    if (j.role === 'everything') return t(tier ? `${P}.jack.everythingShort` : `${P}.jack.everything`, { n: j.count ?? input.databases.length })
    // a clock or an incoming hook says START, a button / command PRESS; a row trigger's cables say it themselves
    if (j.side === 'out' && j.role === 'start' && (m.kind === 'clock' || m.kind === 'incoming')) return t(`${P}.jack.start`)
    if (j.side === 'out' && j.role === 'start' && HAND_KINDS.has(m.kind)) return t(`${P}.jack.press`)
    return ''
  }
  // the words carry the direction (§3.9, fix ui-words): an out-jack's cables go "→ to", an in-jack's come "from" — a
  // database written, a module started, an exit sent to, the Outbox handed a row, in their own words
  const jackTitle = (j: Jack, m: Module, to: string[]) => {
    const label = jack(j, m) || t(`${P}.jack.role.${j.role}`)
    const head = `${name(m)} · ${label}`
    if (!to.length) return t(`${P}.jack.free`, { jack: head })
    if (j.side !== 'in') return t(`${P}.jack.to`, { jack: head, to: to.join(', ') })
    const own = j.role === 'writes' || j.role === 'start' || j.role === 'out' || j.role === 'send'
    return own ? t(`${P}.jack.from.${j.role}`, { module: name(m), from: to.join(', ') }) : t(`${P}.jack.from`, { jack: head, from: to.join(', ') })
  }
  const peers = (key: string): string[] => {
    const out: string[] = []
    for (const e of edgesAt(model, key)) {
      const other = e.from === key ? e.to : e.from
      let label: string
      if (other.startsWith('net:')) {
        const n = model.nets.find((x) => x.key === other)
        label = n ? flag(n) : other
      } else {
        const k = moduleOfJack(model, other)
        const om = k ? byKey.get(k) : undefined
        label = om ? name(om) : other
      }
      if (!out.includes(label)) out.push(label)
    }
    return out
  }
  const net = (n: NetTag, m: Module) => {
    if (m.ref.kind === 'pipeline' && 'db' in n.place && n.place.db === m.ref.db) return t(`${P}.net.tasks`)
    return placeNameOf(model, input, n.place, ctx)
  }
  const netTitle = (n: NetTag, m: Module) => t(n.tainted ? `${P}.net.tainted` : `${P}.net.reads`, { place: net(n, m) })
  const flag = (n: NetLabel) => {
    const p = n.place
    if (!('db' in p)) return placeNameOf(model, input, p, ctx)
    const d = title(p.db)
    if (p.prop === '+row') return t(`${P}.flag.row`, { db: d })
    if (p.prop === '-row') return t(`${P}.flag.gone`, { db: d })
    if (!p.prop || p.prop === '*') return t(`${P}.flag.any`, { db: d })
    return t(`${P}.flag.field`, { db: d, prop: prop(p.db, p.prop) })
  }
  const colCount = (c: ColumnCount) => {
    const parts = [String(c.placed)]
    if (c.idle) parts.push(t(`${P}.col.idle`, { n: c.idle }))
    if (c.off) parts.push(t(`${P}.col.off`, { n: c.off }))
    if (c.filter) parts.push(t(`${P}.col.hidden`, { n: c.filter }))
    if (c.bus) parts.push(t(`${P}.col.bus`, { n: c.bus }))
    return parts.join(' · ')
  }
  const byKey = new Map(model.modules.map((m) => [m.key, m]))
  const fold = (f: FoldSlot) => {
    const n = f.modules.length
    const names = f.modules.map((k) => (byKey.get(k) ? name(byKey.get(k)!) : k))
    if (f.why === 'idle') return { label: t(`${P}.idle`, { n }), names, title: t(`${P}.idleTitle`) }
    if (f.why === 'off') return { label: t(`${P}.off`, { n }), names, title: t(`${P}.offTitle`) }
    if (f.why === 'setup') return { label: t(`${P}.setupFold`, { n }), names, title: names.join(' · ') }
    return { label: t(`${P}.hidden`, { n }), names, title: t(n === 1 ? `${P}.hiddenTitle.one` : `${P}.hiddenTitle`, { n }) }
  }
  const knobModel = (m: Module) => {
    const id = m.knobs?.model ?? null
    const list = MODEL_TICKS
    if (!id) return { label: t(`${P}.knob.standard`), v: 0, ticks: Math.max(3, list.length + 1) }
    const row = modelRow({ p: 'anthropic', m: id })
    const label = row?.short ?? shortOfLabel(labelOf({ p: 'anthropic', m: id }))
    const i = list.indexOf(id)
    const ticks = Math.max(3, list.length + 1)
    return { label, v: i >= 0 ? (i + 1) / (ticks - 1) : 0.5, ticks }
  }
  const knobBudget = (m: Module) => {
    const usd = m.knobs?.budgetUsd ?? null
    if (usd === null) return { label: t(`${P}.knob.noBudget`), v: 0, ticks: 11 }
    // 0.01 … 50 on a logarithmic dial (the agents' own limits)
    const v = Math.min(1, Math.max(0, Math.log10(usd / 0.01) / Math.log10(50 / 0.01)))
    return { label: fmtMoney(usd, lang), v, ticks: 11 }
  }
  return {
    t,
    lang,
    ctx,
    name,
    kind,
    sub,
    worker,
    tags,
    describe: (m) => {
      if (!m.tags.includes('ghost')) return describe(model, input, m.key, ctx)
      // a ghost: what it will be and which lamp makes it (nothing runs through it yet)
      const n = extra?.chips?.[m.key]?.[0]
      return t(`${P}.ghost.describe`, { kind: kind(m), name: name(m), n: n === undefined ? '—' : String(n).padStart(2, '0') })
    },
    jack,
    jackTitle,
    peers,
    fieldName: prop,
    net,
    netTitle,
    flag,
    colName: (col) => t(`${P}.col.${col}`),
    colCount,
    fold,
    knobModel,
    knobBudget,
  }
}

/** The rack's words for this render (rebuilt when the model, the input or the language changes). */
export function useWords(model: Model | null, input: ModelInput | null, extra?: WordsExtra | null): Words | null {
  const t = useT()
  const lang = useLang() as 'en' | 'de'
  return useMemo(() => (model && input ? makeWords(t, lang, model, input, extra) : null), [t, lang, model, input, extra])
}
