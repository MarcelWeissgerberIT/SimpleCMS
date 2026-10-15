/**
 * The rack's legend (plan §3.3): solid = reads · writes · starts, dashed = the AI decides, hatched = content from
 * outside, the run's dot, the net label, the dashed orange box of a fuse's path, "?" = guessed from tool names (only
 * when a jack was guessed); on the right the keys J · F · ↵ (§6 U21). Hidden while no cable exists (the empty rack).
 * The setup band (B12, mock-2) has its own: planned (dotted) · a module not created yet (the dotted box) · "04" made by
 * lamp 04 · "F1" on the path of a fuse — and on the right ↵ next lamp · Mod+Z profile back (only while the drop's Undo
 * is offered).
 */
import { Kbd, shortcutLabel } from '../../../ui/controls'
import { useRack } from './RackContext'

const P = 'features.patchbay'

export function Legend({ band }: { band?: { undo: boolean } | null } = {}) {
  const { model, words: w, marks } = useRack()
  const t = w.t
  if (band) {
    return (
      <div className="pb-legend" role="group" aria-label={t(`${P}.legend.aria`)} data-testid="pb-legend" data-band="">
        <ul className="pb-legend__list" role="list">
          <li className="pb-legend__i" role="listitem" data-item="planned">
            <svg viewBox="0 0 28 12" aria-hidden="true">
              <path className="pb-lg-line pb-lg-line--planned" d="M2 6h24" />
            </svg>
            <span className="label">{t(`${P}.setup.legend.planned`)}</span>
          </li>
          <li className="pb-legend__i" role="listitem" data-item="ghost">
            <svg viewBox="0 0 28 12" aria-hidden="true">
              <rect className="pb-lg-ghost" x="1" y="1" width="26" height="10" rx="2" />
            </svg>
            <span className="label">{t(`${P}.setup.legend.ghost`)}</span>
          </li>
          <li className="pb-legend__i" role="listitem" data-item="step">
            <span className="pb-step" aria-hidden="true">
              04
            </span>
            <span className="label">{t(`${P}.setup.legend.step`, { n: '04' })}</span>
          </li>
          {marks.open.length > 0 && (
            <li className="pb-legend__i" role="listitem" data-item="fuse">
              <span className="pb-tag pb-tag--f" aria-hidden="true">
                {marks.open[0].label}
              </span>
              <span className="label">{t(`${P}.setup.legend.fuse`)}</span>
            </li>
          )}
        </ul>
        <span className="pb-legend__keys">
          <Kbd>↵</Kbd>
          <span className="label">{t(`${P}.setup.legend.next`)}</span>
          {band.undo && (
            <>
              <Kbd>{shortcutLabel('Mod+Z')}</Kbd>
              <span className="label">{t(`${P}.setup.legend.undo`)}</span>
            </>
          )}
        </span>
      </div>
    )
  }
  const guessed = model.modules.some((m) => m.outJacks.some((j) => j.guessed))
  const item = (sample: React.ReactNode, label: string, key: string) => (
    <li className="pb-legend__i" role="listitem" data-item={key}>
      {sample}
      <span className="label">{label}</span>
    </li>
  )
  return (
    <div className="pb-legend" role="group" aria-label={t(`${P}.legend.aria`)} data-testid="pb-legend">
      <ul className="pb-legend__list" role="list">
        {item(
          <svg viewBox="0 0 28 12" aria-hidden="true">
            <path className="pb-lg-line" d="M1 6h26" />
          </svg>,
          t(`${P}.legend.solid`),
          'solid',
        )}
        {item(
          <svg viewBox="0 0 28 12" aria-hidden="true">
            <path className="pb-lg-line pb-lg-line--can" d="M1 6h26" />
          </svg>,
          t(`${P}.legend.can`),
          'can',
        )}
        {item(
          <svg viewBox="0 0 28 12" aria-hidden="true">
            <path className="pb-lg-line" d="M1 6h26" />
            <path className="pb-lg-ticks" d="M3 6h22" />
          </svg>,
          t(`${P}.legend.outside`),
          'outside',
        )}
        {item(
          <svg viewBox="0 0 28 12" aria-hidden="true">
            <path className="pb-lg-line" d="M1 6h26" />
            <circle className="pb-lg-knock" cx="17" cy="6" r="5.4" />
            <circle className="pb-lg-comet" cx="17" cy="6" r="3.6" />
          </svg>,
          t(`${P}.legend.run`),
          'run',
        )}
        {item(
          <svg viewBox="0 0 28 12" aria-hidden="true">
            <path className="pb-lg-flag" d="M1 1.5h20l6 4.5-6 4.5H1z" />
          </svg>,
          t(`${P}.legend.net`),
          'net',
        )}
        {marks.open.length > 0 &&
          item(
            <svg viewBox="0 0 28 12" aria-hidden="true">
              <rect className="pb-lg-path" x="1" y="1" width="26" height="10" rx="2" />
            </svg>,
            t(`${P}.legend.fusePath`),
            'path',
          )}
        {guessed &&
          item(
            <span className="pb-legend__q" aria-hidden="true">
              ?
            </span>,
            t(`${P}.legend.guessed`),
            'guessed',
          )}
      </ul>
      <span className="pb-legend__keys">
        <Kbd>J</Kbd>
        <span className="label">{t(`${P}.legend.find`)}</span>
        {marks.open.length > 0 && (
          <>
            <Kbd>F</Kbd>
            <span className="label">{t(`${P}.legend.next`)}</span>
          </>
        )}
        <Kbd>↵</Kbd>
        <span className="label">{t(`${P}.legend.open`)}</span>
      </span>
    </div>
  )
}
