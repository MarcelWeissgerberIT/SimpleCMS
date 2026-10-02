import { BRAND } from '@/shared/brand'
import { logoMarkSvg } from '@/shared/logo'
import type { Ctx } from '../context'
import { esc } from '../util'
import { sectionHead } from './head'

export function renderOwn(ctx: Ctx): string {
  const { t } = ctx
  const steps = ['own.s1', 'own.s2', 'own.s3']
    .map((k, i) => `<li data-reveal><span class="own-n disp">${String(i + 1).padStart(2, '0')}</span><p>${esc(t(k))}</p></li>`)
    .join('')
  return `
<section id="own-it" class="sec sec-own tone-signal" data-tone="signal" aria-labelledby="own-it-h">
  <div class="wrap own-grid">
    <div class="own-copy">
      ${sectionHead('own-it', t('own.label'), t('own.title'), t('own.lead'))}
      <div class="own-ctas" data-reveal>
        <a class="btn btn-ink btn-lg" href="${BRAND.repoUrl}/fork" rel="noopener">${esc(t('own.fork'))}<span class="arr" aria-hidden="true">→</span></a>
        <a class="btn btn-line btn-lg" href="${BRAND.repoUrl}" rel="noopener">${esc(t('own.source'))}</a>
      </div>
    </div>
    <div class="own-side">
      <div class="own-timer" data-reveal aria-hidden="true">
        <span class="lbl">${esc(t('own.timer'))}</span>
        <span class="own-time disp">02:00</span>
      </div>
      <ol class="own-steps">${steps}</ol>
    </div>
  </div>
</section>`
}

export function renderFaq(ctx: Ctx): string {
  const { t, c } = ctx
  const items = c.faq
    .map(
      (f, i) => `
      <details class="faq-item" data-reveal>
        <summary><span class="lbl faq-n">Q.${String(i + 1).padStart(2, '0')}</span><span class="faq-q">${esc(f.q)}</span><span class="faq-pm" aria-hidden="true"></span></summary>
        <div class="faq-a"><span class="lbl faq-n">A.${String(i + 1).padStart(2, '0')}</span><p>${esc(f.a)}</p></div>
      </details>`,
    )
    .join('')
  return `
<section id="faq" class="sec sec-faq" data-tone="paper" aria-labelledby="faq-h">
  <div class="wrap faq-grid">
    <div class="faq-head">${sectionHead('faq', t('faq.label'), t('faq.title'))}</div>
    <div class="faq-list">${items}</div>
  </div>
</section>`
}

export function renderFooter(ctx: Ctx): string {
  const { t } = ctx
  const v = { version: BRAND.version }
  return `
<footer class="foot tone-carbon" data-tone="carbon">
  <div class="wrap">
    <div class="foot-top">
      <p class="lbl foot-end"><span class="led led-on" aria-hidden="true"></span>§ 08 — ${esc(t('footer.end'))}</p>
      <a class="lbl foot-up" href="#top">↑ ${esc(t('footer.top'))}</a>
    </div>
    <div class="foot-cols">
      <div class="foot-brand">
        <span class="foot-mark">${logoMarkSvg(40)}</span>
        <p>${esc(t('footer.armory'))}</p>
        <p class="foot-made">${esc(t('footer.made'))}</p>
      </div>
      <nav aria-label="${esc(t('footer.product'))}">
        <p class="lbl">${esc(t('footer.product'))}</p>
        <ul>
          <li><a href="${BRAND.appHref}">${esc(t('nav.open'))}</a></li>
          <li><a href="${BRAND.appHref}?import">${esc(t('hero.import'))}</a></li>
          <li><a href="#features">${esc(t('nav.features'))}</a></li>
          <li><a href="#compare">${esc(t('nav.compare'))}</a></li>
          <li><a href="#faq">${esc(t('nav.faq'))}</a></li>
        </ul>
      </nav>
      <nav aria-label="${esc(t('footer.project'))}">
        <p class="lbl">${esc(t('footer.project'))}</p>
        <ul>
          <li><a href="${BRAND.repoUrl}" rel="noopener">GitHub</a></li>
          <li><a href="${BRAND.repoUrl}/fork" rel="noopener">${esc(t('own.fork'))}</a></li>
          <li><a href="#own-it">${esc(t('sec.own'))}</a></li>
          <li><button type="button" class="foot-replay" data-replay><span aria-hidden="true">↻</span> ${esc(t('footer.replay'))}</button></li>
        </ul>
      </nav>
    </div>
    <p class="foot-word disp" aria-hidden="true">ONE<span class="dot">.</span></p>
    <div class="foot-base lbl">
      <span>${esc(BRAND.name)} · ${esc(t('footer.version', v))}</span>
      <span>${esc(t('readout.cost'))} · 0 ${esc(t('readout.servers'))} · 0 ${esc(t('readout.trackers'))}</span>
      <span>© ${new Date().getFullYear()}</span>
    </div>
  </div>
</footer>`
}
