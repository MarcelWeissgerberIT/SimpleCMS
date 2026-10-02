import { BRAND } from '@/shared/brand'
import type { Ctx } from '../context'
import { HERO_CALLOUTS, heroSchematic } from '../figures'
import { frame } from '../frame'
import { esc } from '../util'

/** "Notion, rebuilt." → "Notion, rebuilt<span class=dot>.</span>" (orange full stop). */
export function dotted(s: string): string {
  return s.endsWith('.') ? `${esc(s.slice(0, -1))}<span class="dot">.</span>` : esc(s)
}

export function renderHero(ctx: Ctx): string {
  const { t, lang } = ctx
  const v = { version: BRAND.version }
  const parts = (['A', 'B', 'C', 'D'] as const).map((id) => [id, t(`hero.part${id}`)])

  // Balloons + leader lines over the drawing (coordinates in drawing units 1600×1000).
  const leaders = HERO_CALLOUTS.map(
    (c) =>
      `<line class="leader" x1="${c.bx}" y1="${c.by}" x2="${c.tx}" y2="${c.ty}"/><circle class="leader-dot" cx="${c.tx}" cy="${c.ty}" r="5"/>`,
  ).join('')
  const balloons = HERO_CALLOUTS.map(
    (c) =>
      `<span class="balloon" style="left:${(c.bx / 16).toFixed(3)}%;top:${(c.by / 10).toFixed(3)}%" aria-hidden="true">${c.id}</span>`,
  ).join('')
  const overlay = `<svg class="leaders" viewBox="0 0 1600 1000" preserveAspectRatio="none" aria-hidden="true">${leaders}</svg>${balloons}`

  const readout = [
    { val: t('readout.cost'), from: lang === 'de' ? 2880 : 2880, unit: t('readout.costUnit'), kind: 'cost' },
    { val: '0', from: 12, unit: t('readout.servers'), kind: 'n' },
    { val: '0', from: 37, unit: t('readout.trackers'), kind: 'n' },
    { val: '∞', from: 0, unit: t('readout.pages'), kind: 'inf' },
  ]

  return `
<section id="top" class="hero tone-carbon" data-tone="carbon" aria-labelledby="hero-h">
  <div class="hero-grid wrap" aria-hidden="true">${'<i></i>'.repeat(13)}</div>
  <div class="wrap hero-in">
    <div class="hero-meta">
      <p class="lbl hero-label"><span class="led" aria-hidden="true"></span><span data-type>${esc(t('hero.label'))}</span><span class="type-caret" aria-hidden="true"></span></p>
      <p class="lbl hero-plate">${esc(t('hero.plate', v))}</p>
    </div>
    <h1 id="hero-h" class="hero-h disp">
      <span class="line"><span class="line-in">${dotted(t('hero.h1'))}</span></span>
      <span class="line"><span class="line-in">${dotted(t('hero.h2'))}</span></span>
    </h1>
    <div class="hero-body">
      <div class="hero-copy">
        <p class="hero-sub">${esc(t('hero.sub'))}</p>
        <div class="hero-ctas">
          <a class="btn btn-sig btn-lg" href="${BRAND.appHref}">${esc(t('hero.cta'))}<span class="arr" aria-hidden="true">→</span></a>
          <a class="btn btn-ghost btn-lg" href="${BRAND.appHref}?import">${esc(t('hero.import'))}</a>
        </div>
        <p class="lbl hero-fine">${esc(t('hero.fine'))}</p>
        <div class="bom">
          <p class="lbl bom-h"><span>${esc(t('hero.bom'))}</span><span>Qty</span></p>
          <ol>${parts.map(([id, name]) => `<li><span class="bom-id">${id}</span><span class="bom-name">${esc(name)}</span><span class="bom-q">1</span></li>`).join('')}</ol>
        </div>
      </div>
      <div class="hero-fig">
        ${frame({
          shot: 'assets/shots/hero.webp',
          alt: t('hero.alt'),
          schematic: heroSchematic(lang, t('hero.schematicAlt')),
          caption: t('hero.fig'),
          meta: t('hero.dwg', v),
          overlay,
          outside: '<div class="dim dim-h" aria-hidden="true"><span>1600</span></div><div class="dim dim-v" aria-hidden="true"><span>1000</span></div>',
          eager: true,
          extraClass: 'frame-hero',
        })}
      </div>
    </div>
    <ul class="readout" aria-label="${esc(t('readout.label'))}">
      ${readout
        .map(
          (r) =>
            `<li class="readout-cell"><span class="readout-val" data-count="${r.kind}" data-from="${r.from}" data-final="${esc(r.val)}">${esc(r.val)}</span><span class="lbl readout-unit">${esc(r.unit)}</span></li>`,
        )
        .join('')}
    </ul>
  </div>
</section>`
}
