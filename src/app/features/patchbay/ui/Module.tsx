/**
 * One module on the rack (plan §3.3 anatomy, §3.9 semantics): `[in jacks] [body] [window] [out jacks]`, a 2U agent with
 * its read-only knobs row. The body is the kind line (LED · mono label · tags · net tags · "F1"), the name and a mono
 * sub-line; the window a plain chip (runs today on this device). Four corner screws.
 *
 * Semantics: a focusable `role="group"` ("module"), labelled kind + name, described by its strand sentence (plain.ts
 * describe), `aria-keyshortcuts="Enter Space J"`; never a button. Pointer grammar (§6 U5): hover lights its cables in
 * ink; a click selects it (its chains light, the rest dims) and shows "Open ↵"; a double-click or that key opens its
 * editor. The keyboard: ↵ opens, Space selects without scrolling (its Klartext sentence lights in place), the arrows rove
 * (Rack.tsx — the module is one stop, `data-stop`, of a single tab stop); its jacks take the keyboard only through J.
 *
 * Variants: `data-path` (on an open fuse's path: the dashed signal frame — the only orange frame), blocked (hatched),
 * unknown here (a grey "?"), 2U (`data-u="2"`), dimmed while another module is selected.
 */
import { memo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { fmtUsd as fmt } from '../../../lib/money'
import { typing } from '../../../ui/keys'
import type { Module as ModuleT } from '../types'
import { buttonLabelIn } from './buttonLabel'
import { useFitTier } from './fit'
import { Jack } from './Jack'
import { edgesAt } from './lit'
import { canOpen, openModule } from './open'
import { useRack } from './RackContext'
import { announce, selectModule, setCursor, setHover, usePbUI } from './store'

const P = 'features.patchbay'

/** A button block's label, read from its page (the model keeps ids only). */
function useButtonLabel(m: ModuleT): string | null {
  const ref = m.ref.kind === 'button' ? m.ref : null
  return useWorkspace((s) => (ref ? buttonLabelIn(s.pages[ref.page]?.content, ref.block) : null))
}

function Knob({ v, ticks, label, value, onOpen, title }: { v: number; ticks: number; label: string; value: string; onOpen: () => void; title: string }) {
  const ang = (x: number) => ((-135 + 270 * x) * Math.PI) / 180
  const a = ang(v)
  return (
    <button type="button" className="pb-knob" onClick={onOpen} title={title} tabIndex={-1}>
      <svg viewBox="-12 -12 24 24" aria-hidden="true">
        {Array.from({ length: ticks }, (_, i) => {
          const tv = ticks === 1 ? 0.5 : i / (ticks - 1)
          const ta = ang(tv)
          return <line key={i} x1={Math.sin(ta) * 10.2} y1={-Math.cos(ta) * 10.2} x2={Math.sin(ta) * 12} y2={-Math.cos(ta) * 12} className={Math.abs(tv - v) < 0.001 ? 'pb-k-tick pb-k-tick--on' : 'pb-k-tick'} />
        })}
        <circle r="8.6" className="pb-k-face" />
        <circle r="5.6" className="pb-k-cap" />
        <line x1={Math.sin(a) * 2} y1={-Math.cos(a) * 2} x2={Math.sin(a) * 7.6} y2={-Math.cos(a) * 7.6} className="pb-k-ptr" />
      </svg>
      <span className="pb-knob__t">
        <span className="label">{label}</span>
        <b>{value}</b>
      </span>
    </button>
  )
}

function ModuleView({ m, row, span, descId }: { m: ModuleT; row: number; span: 1 | 2; descId: string }) {
  const { model, input, words: w, marks, lit, runs, costs, entry } = useRack()
  const t = w.t
  const selected = usePbUI((s) => s.selected === m.key)
  const ref = useRef<HTMLDivElement>(null)
  const buttonLabel = useButtonLabel(m)
  const fuses = marks.modules.get(m.key) ?? []
  const name = w.name(m)
  const kind = w.kind(m)
  const sub = m.ref.kind === 'button' ? null : w.sub(m)
  const tags = w.tags(m)
  const unknown = m.tags.includes('unknownHere')
  const blocked = !!m.blocked || m.tags.includes('blocked')
  const off = m.idle || blocked || unknown || m.tags.includes('disabled') || m.tags.includes('byHand') || m.tags.includes('ghost')
  const dim = !!lit && lit.mode !== 'hover' && !lit.modules.has(m.key)
  const isLit = !!lit && lit.modules.has(m.key)
  const n = runs[m.key] ?? 0
  const cost = costs[m.key]

  const open = () => {
    if (canOpen(m)) openModule(m, ref.current)
  }
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('button')) return
    e.stopPropagation()
    selectModule(m.key)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || typing() || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      open()
    } else if (e.key === ' ') {
      // Space selects in place — never a scroll (its Klartext strand lights where it is, Plain.tsx)
      e.preventDefault()
      toggle()
    }
  }
  const toggle = () => {
    const on = usePbUI.getState().selected !== m.key
    selectModule(on ? m.key : null)
    if (on) announce(t(`${P}.selected`, { name }))
  }
  const jackKeys = {
    open,
    select: toggle,
    back: () => ref.current?.focus(),
  }
  const roleLabel = t(`${P}.a11y.jack`)
  const onEnter = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setHover(m.key)
  }
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && usePbUI.getState().hover === m.key) setHover(null)
  }

  // reads without a cable — "everything" is said by the EVERYTHING jack already
  const readNets = m.nets.filter((x) => !('everything' in x.place))
  const nets = readNets.slice(0, 1)
  const moreNets = readNets.length - nets.length
  // the kind line never wraps: the net chip goes first, then the mode tags shorten, then they go — the kind, "?" and
  // the F tags stay (what went is in the module's description and the chip's title)
  const kRef = useRef<HTMLDivElement>(null)
  const fit = useFitTier(kRef, 3, `${w.lang}|${kind}|${tags.map((x) => x.text).join()}|${readNets.length}|${fuses.join()}`)
  const knobs = m.u === 2 && m.knobs
  const model1 = knobs ? w.knobModel(m) : null
  const budget = knobs ? w.knobBudget(m) : null

  return (
    <div
      ref={ref}
      className="pb-mod"
      role="group"
      aria-roledescription={t(`${P}.a11y.module`)}
      aria-label={`${kind} ${buttonLabel ?? name}`}
      aria-describedby={descId}
      aria-keyshortcuts="Enter Space J"
      tabIndex={entry === m.key ? 0 : -1}
      data-stop={m.key}
      data-key={m.key}
      data-kind={m.kind}
      data-u={m.u}
      data-path={fuses.length ? '' : undefined}
      data-selected={selected || undefined}
      data-dim={dim || undefined}
      data-lit={isLit || undefined}
      data-blocked={blocked || undefined}
      data-unknown={unknown || undefined}
      data-testid="pb-module"
      style={{ gridColumn: m.col * 2 - 1, gridRow: `${row + 1} / span ${span}` }}
      onClick={onClick}
      onDoubleClick={open}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target === e.currentTarget && setCursor(m.key)}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <i className="pb-sc pb-sc--tl" aria-hidden="true" />
      <i className="pb-sc pb-sc--tr" aria-hidden="true" />
      <i className="pb-sc pb-sc--bl" aria-hidden="true" />
      <i className="pb-sc pb-sc--br" aria-hidden="true" />
      <div className="pb-mod__in">
        {m.inJacks.map((j) => (
          <Jack key={j.key} jack={j} label={w.jack(j, m)} title={w.jackTitle(j, m, w.peers(j.key))} roleLabel={roleLabel} keys={jackKeys} lit={!!lit && edgesAt(model, j.key).some((e) => lit.edges.has(e.id))} />
        ))}
      </div>
      <div className="pb-mod__body">
        <div className="pb-mod__k" ref={kRef} data-fit={fit || undefined}>
          <span className={`led${off ? '' : ' pb-led--ok'}`} aria-hidden="true" />
          <span className="label pb-mod__kind">{kind}</span>
          {tags.slice(0, 2).map((x) => (
            <span key={x.tag} className="pb-tag" data-tag={x.tag} title={x.text}>
              {x.text}
            </span>
          ))}
          {unknown && (
            <span className="pb-tag pb-tag--q" title={t(`${P}.tag.unknownTitle`)}>
              ?
            </span>
          )}
          {fuses.map((f) => (
            <span key={f} className="pb-tag pb-tag--f" title={t(`${P}.tag.fuseTitle`, { f })}>
              {f}
            </span>
          ))}
          {/* the profile's id sits on what it matched (the server); the modules it touches carry it in the filter */}
          {m.profile && m.kind === 'server' && <span className="pb-tag">{m.profile.toUpperCase()}</span>}
          {nets.map((x, i) => (
            <span key={i} className="pb-net" data-tainted={x.tainted || undefined} title={m.nets.map((y) => w.netTitle(y, m)).join(' · ')}>
              <span className="pb-net__t">{w.net(x, m)}</span>
              {moreNets > 0 && <span className="pb-net__more">{t(`${P}.net.more`, { n: moreNets })}</span>}
            </span>
          ))}
        </div>
        <div className="pb-mod__n" title={buttonLabel ?? name}>
          {m.ref.kind === 'button' && buttonLabel !== null ? (
            <>
              {buttonLabel} <span className="pb-mod__q">{t(`${P}.sub.onPage`, { page: (m.ref.kind === 'button' && input.pages[m.ref.page]?.title.trim()) || t(`${P}.untitled`) })}</span>
            </>
          ) : (
            name
          )}
        </div>
        {sub && <div className="pb-mod__s">{sub}</div>}
      </div>
      {n > 0 && (
        <span className="pb-win" title={t(n === 1 ? `${P}.win.runsTitle.one` : `${P}.win.runsTitle`, { n })}>
          {t(`${P}.win.runs`, { n })}
          {cost && cost.usd > 0 && <small>{`${cost.estimate ? '≈ ' : ''}${fmt(cost.usd, w.lang)}`}</small>}
        </span>
      )}
      <div className="pb-mod__out">
        {m.outJacks.map((j) => (
          <Jack key={j.key} jack={j} label={w.jack(j, m)} title={w.jackTitle(j, m, w.peers(j.key))} roleLabel={roleLabel} keys={jackKeys} guessedTitle={t(`${P}.jack.guessed`)} lit={!!lit && edgesAt(model, j.key).some((e) => lit.edges.has(e.id))} />
        ))}
      </div>
      {model1 && budget && (
        <div className="pb-knobs">
          <Knob v={model1.v} ticks={model1.ticks} label={t(`${P}.knob.model`)} value={model1.label} onOpen={open} title={t(`${P}.knob.edit`)} />
          <Knob v={budget.v} ticks={budget.ticks} label={t(`${P}.knob.budget`)} value={budget.label} onOpen={open} title={t(`${P}.knob.edit`)} />
        </div>
      )}
      {selected && canOpen(m) && (
        <button type="button" className="pb-mod__open" onClick={open} title={t(`${P}.openTitle`)} tabIndex={-1} data-testid="pb-open">
          {t(`${P}.open`)}
          <CornerDownLeft size={11} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
      <span id={descId} className="visually-hidden">
        {w.describe(m)}
      </span>
    </div>
  )
}

export const Module = memo(ModuleView)
