/**
 * The fuse plate (plan §3.5) — the tab panel of the fuse list (FuseList.tsx), under the rack. One plate per row kind:
 *
 *  - an open fuse (also a lapsed allowance): the ONLY orange plate on the page — LED + "FUSE F1 · OPEN PATH", right
 *    "read from the settings · no guard while it runs"; the three lamps ("All 3 conditions met"); the path as chips;
 *    the generated sentence; the facts row (mono) with what is already in place; the read tools a key would leave
 *    connected ("still connected"); a lapsed one says what changed; "Ctrl+Z in the Patchbay undoes every key"; and the
 *    key column ("Resolve — changes the real setting", FuseKeys.tsx — B10) at its right, under the body where the
 *    plate is narrow (measured);
 *  - an allowed fuse: neutral ink, a check stamp "ALLOWED", "Allowed by … · date", key 3 "Withdraw" (B10);
 *  - a fuse closed by key 1 / 2 in this visit: the closed plate in ink with its Undo (ClosedPlate.tsx — B10);
 *  - a path almost open (a near miss): ink, the lamps (one off — what closes it), the path, the sentence;
 *  - a part unknown here: ink, what cannot be seen and where — never read as safe.
 *
 * Its tab "F1" sits on the plate's top edge under the fuse's glyph (`data-pb-plate-tab`: the cable layer's dashed leader
 * ends there, Wires.tsx). The LED blinks 3× on the fuse's first appearance (per fuse key and signature, blink.ts).
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Check } from 'lucide-react'
import { useLang } from '../../../i18n'
import { blinkOf, blinkStyle } from '../blink'
import { unknownSay, nearSay } from '../fuses'
import type { FuseState, ModuleKey, UnknownPart } from '../types'
import type { FuseRow } from './fuseRows'
import { FuseFacts, FuseLamps, FusePath, FuseSentence, KindIcon, type PlateWords } from './plateParts'
import { SLOT, Slotted } from './slot'
import { usePbGlyphs } from './Wires'
import { ClosedPlate } from './ClosedPlate'
import { FuseKeys, UndoAllLine, useFuseKeys } from './FuseKeys'

const P = 'features.patchbay'

/** "12 Oct" / "12.10." */
const shortDate = (at: number, lang: string): string => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', lang === 'de' ? { day: '2-digit', month: '2-digit' } : { day: 'numeric', month: 'short' }).format(new Date(at))

/** The plate's tab under the fuse's glyph (bench coordinates → the plate's); none while the glyph is off the plate. */
function usePlateTab(plate: RefObject<HTMLElement | null>, fuseKey: string | null): number | null {
  const glyph = usePbGlyphs((s) => (fuseKey ? s[fuseKey] : undefined))
  const [x, setX] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = plate.current
    if (!el || !glyph) {
      setX(null)
      return
    }
    const place = () => {
      const bench = document.querySelector<HTMLElement>('.pb-bench')
      if (!bench) return setX(null)
      const b = bench.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const at = b.left + glyph.x - r.left
      // the tab sits on this plate only while the glyph is above it (with room for the tab itself)
      setX(at >= 18 && at <= r.width - 18 ? Math.round(at) : null)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [plate, glyph])
  return x
}

/** The plate's key column sits at its right from this width (× the text size); narrower, under the body. */
const KEYS_BESIDE = 820

/** Is the plate wide enough for the key column beside its body (measured)? */
function useWide(el: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true)
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    const measure = () => {
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')) || 1
      setWide(node.clientWidth >= KEYS_BESIDE * scale)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [el])
  return wide
}

function FuseBody({ row, pw }: { row: Extract<FuseRow, { kind: 'fuse' }>; pw: PlateWords }) {
  const t = pw.w.t
  const lang = useLang()
  const f: FuseState = row.fuse
  const ref = useRef<HTMLDivElement>(null)
  const tabX = usePlateTab(ref, f.key)
  const wide = useWide(ref)
  const keys = useFuseKeys(f, pw)
  const open = row.state !== 'allowed'
  // 3 blinks on the fuse's first appearance (per key and signature) in this tab, then steady
  const blink = useMemo(() => (open ? blinkOf(f.key, f.sig ?? f.key) : { on: false, delay: 0 }), [open, f.key, f.sig])
  const changed = (f.allowed?.changed ?? []).map((k: ModuleKey) => {
    const m = pw.model.modules.find((x) => x.key === k)
    return m ? pw.w.name(m) : k
  })
  return (
    <div className="pb-fplate pb-fplate--keys" ref={ref} data-state={row.state} data-pb-plate={f.key} data-wide={wide || undefined} data-testid="pb-fplate">
      <span className="pb-fplate__tab" data-pb-plate-tab={tabX !== null ? '' : undefined} style={{ left: tabX ?? 22 }} aria-hidden="true">
        {f.label}
      </span>
      <div className="pb-fplate__body">
        <div className="pb-fplate__h">
          <span className={open ? 'led led--on pb-fuse-led' : 'led pb-fuse-led'} data-blink={blink.on || undefined} style={blinkStyle(blink) as CSSProperties | undefined} aria-hidden="true" />
          <h2 className="label pb-fplate__title" id="pb-fplate-h" tabIndex={-1}>
            <FuseHead text={t(open ? `${P}.fuse.head` : `${P}.plate.headAllowed`, { f: SLOT })} label={f.label} />
          </h2>
          <span className="pb-fplate__sp" />
          <span className="label pb-fplate__static">{t(`${P}.fuse.static`)}</span>
        </div>
        {row.state === 'lapsed' && (
          <p className="pb-fplate__note pb-fplate__note--lapsed" data-testid="pb-lapsed">
            {t(`${P}.lapsed`, { names: changed.join(', ') || f.label })}
          </p>
        )}
        {row.state === 'allowed' && f.allowed && (
          <p className="pb-fplate__note" data-testid="pb-allowed">
            <span className="label pb-fplate__stamp" title={t(`${P}.allowed.stampTitle`)} data-testid="pb-allowed-stamp">
              <Check size={12} strokeWidth={2.2} aria-hidden="true" />
              {t(`${P}.allowedStamp`)}
            </span>{' '}
            {t(`${P}.allowed`, { name: pw.member(f.allowed.by) ?? t(`${P}.plate.someone`), date: shortDate(f.allowed.at, lang) })}
          </p>
        )}
        <FuseLamps lamps={f.lamps} pw={pw} head={t(`${P}.fuse.all3`)} />
        <FusePath chain={f.chain} pw={pw} hot={open} />
        <FuseSentence chain={f.chain} pw={pw} className="pb-fplate__say" />
        <FuseFacts facts={f.facts} mitigations={f.mitigations} pw={pw} />
        {f.residual && f.residual.length > 0 && (
          <p className="pb-fplate__residual" data-testid="pb-residual">
            {t(`${P}.stillConnected`, { tools: f.residual.join(', ') })}
          </p>
        )}
        <UndoAllLine pw={pw} />
      </div>
      <FuseKeys f={f} pw={pw} keys={keys} />
    </div>
  )
}

function NearBody({ row, pw }: { row: Extract<FuseRow, { kind: 'near' }>; pw: PlateWords }) {
  const t = pw.w.t
  const n = row.near
  const lamps = n.chain.lamps
  const on = lamps ? [lamps.outside, lamps.private, lamps.out].filter((w) => w.on).length : 0
  return (
    <div className="pb-fplate" data-state="near" data-testid="pb-fplate">
      <div className="pb-fplate__h">
        <span className="pb-ring" aria-hidden="true" />
        <h2 className="label pb-fplate__title" id="pb-fplate-h" tabIndex={-1}>
          {t(`${P}.plate.near.head`)}
        </h2>
        <span className="pb-fplate__sp" />
        <span className="label pb-fplate__static">{t(`${P}.fuse.static`)}</span>
      </div>
      <p className="pb-fplate__note" data-testid="pb-near-why">
        {t(`${P}.plate.near.closes`, { why: pw.say(nearSay(n)) })}
      </p>
      {lamps && <FuseLamps lamps={lamps} pw={pw} head={t(on === 1 ? `${P}.plate.near.lamps.one` : `${P}.plate.near.lamps`, { n: on })} />}
      <FusePath chain={n.chain} pw={pw} hot={false} />
      <FuseSentence chain={n.chain} pw={pw} className="pb-fplate__say" />
    </div>
  )
}

function UnknownBody({ row, pw }: { row: Extract<FuseRow, { kind: 'unknown' }>; pw: PlateWords }) {
  const t = pw.w.t
  const u = row.part
  const m = pw.model.modules.find((x) => x.key === u.module)
  // a member we cannot name reads as "another member" (the generic sentence), never as an id
  const named = u.who ? pw.member(u.who) : null
  const say = u.what === 'otherBrowser' && !named ? { key: `${P}.unknown.otherBrowserAnyone` } : unknownSay(u)
  return (
    <div className="pb-fplate" data-state="unknown" data-testid="pb-fplate">
      <div className="pb-fplate__h">
        <span className="pb-tag pb-tag--q" aria-hidden="true">
          ?
        </span>
        <h2 className="label pb-fplate__title" id="pb-fplate-h" tabIndex={-1}>
          {t(`${P}.plate.unknown.head`)}
        </h2>
      </div>
      <p className="pb-fplate__say">{pw.say(say)}</p>
      {onlyVisibleIn(u, pw) && (
        <p className="pb-fplate__note" data-testid="pb-only-visible">
          {onlyVisibleIn(u, pw)}
        </p>
      )}
      {m && (
        <ol className="pb-path" aria-label={t(`${P}.plate.unknown.where`)}>
          <li className="pb-pn" data-key={m.key}>
            <KindIcon m={m} input={pw.input} />
            <span className="pb-pn__n">{pw.w.name(m)}</span>
            <span className="label pb-pn__s">{pw.w.kind(m)}</span>
          </li>
        </ol>
      )}
      <p className="pb-fplate__note">{t(`${P}.plate.unknown.never`)}</p>
    </div>
  )
}

/**
 * Owners and admins, a path only another member's browser can see (§1.9, Q3): "Fuse visible only in Mara's browser —
 * Mara can close it with key 1 or 2" (null: not that case, or the member cannot be named).
 */
export function onlyVisibleIn(u: UnknownPart, pw: PlateWords): string | null {
  const { ctx } = pw.input
  if (u.what !== 'otherBrowser' || !u.who || !ctx.team || (ctx.role !== 'owner' && ctx.role !== 'admin')) return null
  const name = pw.member(u.who)
  return name ? pw.w.t(`${P}.onlyVisibleIn`, { name }) : null
}

/** "FUSE F1 · OPEN PATH": the words in ink-2, the label bold — signal ink on an open or lapsed plate, ink when allowed. */
export function FuseHead({ text, label }: { text: string; label: string }) {
  return (
    <Slotted text={text}>
      <b className="pb-fhead__f">{label}</b>
    </Slotted>
  )
}

/** The selected row's plate. */
export function FusePlate({ row, pw }: { row: FuseRow; pw: PlateWords }) {
  if (row.kind === 'fuse') return <FuseBody key={row.key} row={row} pw={pw} />
  if (row.kind === 'near') return <NearBody key={row.key} row={row} pw={pw} />
  if (row.kind === 'closed') return <ClosedPlate key={row.key} done={row.done} pw={pw} />
  return <UnknownBody key={row.key} row={row} pw={pw} />
}
