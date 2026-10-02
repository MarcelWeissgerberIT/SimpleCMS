import type { Ctx } from '../context'
import type { Mark } from '../messages'
import { NOTION_PRICING } from '../pricing'
import { esc } from '../util'
import { sectionHead } from './head'

const GLYPH: Record<Mark, string> = { yes: '✓', no: '✗', partial: '◐' }

function cell(ctx: Ctx, [mark, note]: [Mark, string?], col: string): string {
  const label = ctx.t(`compare.${mark}`)
  return `<td class="cmp-cell" data-col="${esc(col)}">
    <span class="mk mk-${mark}" role="img" aria-label="${esc(label)}">${GLYPH[mark]}</span>
    <span class="mk-txt">${esc(note ?? label)}</span>
  </td>`
}

export function renderCompare(ctx: Ctx): string {
  const { t, c, lang } = ctx
  const rows = c.compare
    .map(
      (r, i) => `
      <tr data-reveal>
        <th scope="row"><span class="lbl cmp-n">${String(i + 1).padStart(2, '0')}</span>${esc(r.param)}</th>
        ${cell(ctx, r.notion, t('compare.notion'))}
        ${cell(ctx, r.one, t('compare.one'))}
      </tr>`,
    )
    .join('')
  return `
<section id="compare" class="sec sec-compare" data-tone="paper" aria-labelledby="compare-h">
  <div class="wrap">
    ${sectionHead('compare', t('compare.label'), t('compare.title'), t('compare.lead'))}
    <div class="sheet">
      <table class="spec">
        <caption class="sr">${esc(t('compare.title'))}</caption>
        <thead>
          <tr>
            <th scope="col" class="lbl">${esc(t('compare.param'))}</th>
            <th scope="col" class="cmp-notion"><span class="lbl">A</span>${esc(t('compare.notion'))}</th>
            <th scope="col" class="cmp-one"><span class="lbl">B</span>${esc(t('compare.one'))}<span class="dot">.</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="lbl sheet-foot">
        <span><span class="mk mk-yes" aria-hidden="true">✓</span> ${esc(t('compare.yes'))}</span>
        <span><span class="mk mk-partial" aria-hidden="true">◐</span> ${esc(t('compare.partial'))}</span>
        <span><span class="mk mk-no" aria-hidden="true">✗</span> ${esc(t('compare.no'))}</span>
        <span class="sheet-src">${esc(t('compare.asOf', { asOf: NOTION_PRICING.asOf[lang] }))}</span>
      </p>
    </div>
  </div>
</section>`
}
