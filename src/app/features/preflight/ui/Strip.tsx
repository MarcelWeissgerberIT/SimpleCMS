/**
 * The strip (§8.1, mock 2): the plate folded to one row — a pip per lamp (coloured when lit, red with the triangle
 * notch, grey hatched; a new one blinks like its cap), the small MASTER CAUTION key and the unfold chevron. Home's own
 * sections follow below it. Never lamp-tested.
 */
import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { useT } from '../../../i18n'
import { Screws } from '../../../ui/controls'
import { noteRender, unfold } from '../engine'
import { isLit } from '../lamps'
import { blinkOf } from '../blink'
import { usePreflight } from '../state'
import { useQueue } from '../queue/state'
import type { LampView } from '../types'
import { lampName } from './Cap'
import { MasterKey } from './MasterCaution'
import { PlateHead } from './Plate'

function Pip({ view, busy }: { view: LampView; busy: boolean }) {
  const t = useT()
  const lamp = lampName(view.legend)
  const lit = isLit(view.level)
  const blinks = lit && view.isNew && view.flash && !busy
  const blink = useMemo(() => (blinks ? blinkOf(`pip:${view.id}`, view.idsHash, 0) : { on: false, delay: 0 }), [blinks, view.id, view.idsHash])
  const title =
    view.level === 'grey'
      ? t('features.preflight.pip.grey', { lamp, why: t(view.why ?? 'features.preflight.grey.off') })
      : view.level === 'amber'
        ? t('features.preflight.pip.amber', { lamp, n: view.count })
        : view.level === 'red'
          ? t('features.preflight.pip.red', { lamp, n: view.count })
          : t('features.preflight.pip.dark', { lamp })
  return (
    <i
      className={`pf-pip${view.level !== 'dark' && !busy ? ` pf-pip--${view.level}` : ''}`}
      data-lamp={view.id}
      data-flash={blink.on || undefined}
      style={blink.on ? ({ ['--pf-flash-delay' as string]: `${Math.round(blink.delay)}ms` } as React.CSSProperties) : undefined}
      title={title}
    />
  )
}

export function Strip({ views, busy }: { views: LampView[]; busy: boolean }) {
  noteRender('strip')
  const t = useT()
  const pendingFocus = useQueue((s) => s.pendingFocus)
  const mcRef = useRef<HTMLDivElement>(null)
  const lit = usePreflight((s) => s.lit)

  // ⌘K "Preflight" with everything dark: the strip's MASTER CAUTION key takes the keyboard
  useEffect(() => {
    if (pendingFocus !== 'plate' || busy || lit > 0) return
    useQueue.setState({ pendingFocus: null })
    mcRef.current?.querySelector<HTMLElement>('.pf-mkey')?.focus()
  }, [pendingFocus, busy, lit])

  const dark = views.filter((v) => v.level === 'dark').length
  const parts = [
    ...views.filter((v) => isLit(v.level)).map((v) => t('features.preflight.strip.partLit', { lamp: lampName(v.legend), n: v.count })),
    ...(dark ? [t('features.preflight.strip.partDark', { n: dark })] : []),
    ...views.filter((v) => v.level === 'grey').map((v) => t('features.preflight.strip.partGrey', { lamp: lampName(v.legend), why: t(v.why ?? 'features.preflight.grey.off') })),
  ]
  return (
    <section className="pf pf--strip screw-plate" aria-label={t('features.preflight.title')} data-mode="strip" data-testid="pf-strip">
      <Screws seed="preflight" />
      <PlateHead strip />
      <div className="pf-strip">
        <div className="pf-pips" role="img" aria-label={t('features.preflight.strip.aria', { n: views.length, parts: parts.join(', ') })}>
          {views.map((v) => (
            <Pip key={v.id} view={v} busy={busy} />
          ))}
        </div>
        <div className="pf-strip__row" ref={mcRef}>
          <MasterKey small />
          <span className="pf-strip__sp" />
          {/* all dark: nothing to unfold (the panel folds whenever every lamp is dark) */}
          {lit > 0 && (
            <button type="button" className="pf-strip__fold" data-testid="pf-unfold" aria-label={t('features.preflight.strip.unfold')} title={t('features.preflight.strip.unfold')} onClick={() => unfold()}>
              <ChevronDown size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
