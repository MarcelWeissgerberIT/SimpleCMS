import { BRAND } from '@/shared/brand'
import { logoMarkSvg } from '@/shared/logo'
import { SECTIONS, type Ctx } from '../context'
import { esc } from '../util'

/** Top bar: brand, anchors, language switch, CTA — plus the radio-dial section scale. */
export function renderTopbar({ t, lang }: Ctx): string {
  // Plain words here: five of eight section numbers would read like missing items.
  // The § numbers live on the dial and in the section labels.
  const anchors = [
    ['savings', 'nav.savings'],
    ['features', 'nav.features'],
    ['mcp', 'nav.mcp'],
    ['compare', 'nav.compare'],
    ['own-it', 'nav.cloud'],
    ['faq', 'nav.faq'],
  ]
  const n = SECTIONS.length - 1
  const marks = SECTIONS.map(
    (s, i) =>
      `<a class="dial-mark" href="#${s.id}" style="--p:${(i / n).toFixed(4)}" data-dial="${s.id}" aria-label="§ ${s.num} ${esc(t(s.key))}"><span>${s.num}</span></a>`,
  ).join('')
  const sheet = SECTIONS.map(
    (s) => `<li><a href="#${s.id}" data-sheet-link><span class="lbl">§ ${s.num}</span>${esc(t(s.key))}</a></li>`,
  ).join('')
  return `
<header class="tb tone-carbon" data-tb data-tone="carbon">
  <div class="tb-row wrap">
    <a class="tb-brand" href="#top" aria-label="${esc(t('nav.home'))}">
      <span class="tb-mark">${logoMarkSvg(26)}</span>
      <span class="tb-word"><span class="tb-word-long">SimpleCMS</span><b>One</b></span>
    </a>
    <nav class="tb-nav" aria-label="${esc(t('nav.label'))}">
      ${anchors.map(([id, key]) => `<a href="#${id}">${esc(t(key))}</a>`).join('')}
    </nav>
    <div class="tb-tools">
      <div class="lang-switch" role="group" aria-label="${esc(t('nav.lang'))}">
        <button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button><button type="button" data-lang="de" aria-pressed="${lang === 'de'}">DE</button>
      </div>
      <a class="btn btn-sig tb-cta" href="${BRAND.appHref}"><span class="tb-cta-long">${esc(t('nav.open'))}</span><span class="tb-cta-short">${esc(t('nav.openShort'))}</span><span class="arr" aria-hidden="true">→</span></a>
      <button type="button" class="tb-menu" aria-expanded="false" aria-controls="tb-sheet" data-menu>
        <span aria-hidden="true">§</span><span class="sr">${esc(t('nav.menu'))}</span>
      </button>
    </div>
  </div>
  <div class="dial" role="navigation" aria-label="${esc(t('dial.label'))}">
    <div class="dial-scale">
      ${marks}
      <span class="dial-needle" data-needle aria-hidden="true"></span>
    </div>
  </div>
  <div class="tb-sheet" id="tb-sheet" hidden>
    <p class="lbl">${esc(t('nav.menu'))}</p>
    <ol>${sheet}</ol>
  </div>
</header>`
}
