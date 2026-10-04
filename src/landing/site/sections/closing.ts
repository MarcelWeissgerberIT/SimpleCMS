import { BRAND } from '@/shared/brand'
import { logoMarkSvg } from '@/shared/logo'
import type { Ctx } from '../context'
import { asset, esc } from '../util'
import { sectionHead } from './head'

/** Repository docs, linked on GitHub (the site itself only serves the app). */
const SELF_HOSTING = `${BRAND.repoUrl}/blob/main/docs/SELF_HOSTING.md`

export function renderOwn(ctx: Ctx): string {
  const { t } = ctx
  const steps = ['own.s1', 'own.s2', 'own.s3']
    .map((k, i) => `<li><span class="own-n disp">${String(i + 1).padStart(2, '0')}</span><p>${esc(t(k))}</p></li>`)
    .join('')
  const points = (keys: string[]) => `<ul class="plate-pts">${keys.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ul>`
  const head = (id: string, model: string, name: string, status: string, where: string, live: boolean) => `
        <header class="plate-head">
          <p class="lbl plate-model">${esc(t(model))}</p>
          <p class="lbl plate-status"><span class="plate-led${live ? ' is-on' : ''}" aria-hidden="true"></span>${esc(t(status))}</p>
          <h3 id="${id}" class="plate-name disp">${esc(t(name))}</h3>
          <p class="lbl plate-where">${esc(t(where))}</p>
        </header>`
  const timer = (time: string, label: string) =>
    `<p class="plate-timer" aria-hidden="true"><span class="lbl">${esc(t(label))}</span><span class="plate-time disp">${time}</span></p>`
  return `
<section id="own-it" class="sec sec-own tone-signal" data-tone="signal" aria-labelledby="own-it-h">
  <div class="wrap">
    ${sectionHead('own-it', t('own.label'), t('own.title'), t('own.lead'))}
    <div class="plates">
      <article class="plate plate-local" data-reveal aria-labelledby="own-local-h">
        <i class="screw s-tl" aria-hidden="true"></i><i class="screw s-tr" aria-hidden="true"></i><i class="screw s-bl" aria-hidden="true"></i><i class="screw s-br" aria-hidden="true"></i>
        ${head('own-local-h', 'own.local.model', 'own.local.name', 'own.local.status', 'own.local.where', true)}
        ${points(['own.local.p1', 'own.local.p2', 'own.local.p3'])}
        ${timer('02:00', 'own.local.time')}
        <ol class="own-steps">${steps}</ol>
        <div class="plate-ctas">
          <a class="btn btn-ink" href="${BRAND.repoUrl}/fork" rel="noopener">${esc(t('own.fork'))}<span class="arr" aria-hidden="true">→</span></a>
          <a class="btn btn-line" href="${BRAND.repoUrl}" rel="noopener">${esc(t('own.source'))}</a>
        </div>
      </article>
      <article class="plate plate-cloud" data-reveal aria-labelledby="own-cloud-h">
        <i class="screw s-tl" aria-hidden="true"></i><i class="screw s-tr" aria-hidden="true"></i><i class="screw s-bl" aria-hidden="true"></i><i class="screw s-br" aria-hidden="true"></i>
        ${head('own-cloud-h', 'own.cloud.model', 'own.cloud.name', 'own.cloud.status', 'own.cloud.where', false)}
        ${points(['own.cloud.p1', 'own.cloud.p2', 'own.cloud.p3', 'own.cloud.p4', 'own.cloud.p5', 'own.cloud.p6'])}
        ${timer('30:00', 'own.cloud.time')}
        <div class="plate-ctas">
          <a class="btn btn-ink" href="${SELF_HOSTING}" rel="noopener" data-selfhost>${esc(t('own.guide'))}<span class="arr" aria-hidden="true">→</span></a>
        </div>
      </article>
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
      <p class="lbl foot-end"><span class="led led-on" aria-hidden="true"></span>§ 09 — ${esc(t('footer.end'))}</p>
      <a class="lbl foot-up" href="#top">↑ ${esc(t('footer.top'))}</a>
    </div>
    <div class="foot-cols">
      <div class="foot-brand">
        <span class="foot-mark">${logoMarkSvg(40)}</span>
        <p>${esc(t('footer.armory'))}</p>
        <p class="foot-made">${esc(t('footer.made'))}</p>
        <button type="button" class="foot-replay" data-replay>
          <img src="${asset('assets/icons/hammer.webp')}" alt="" width="56" height="56" loading="lazy" decoding="async" onerror="this.remove()" />
          <span class="foot-replay-txt"><span class="foot-replay-h">↻ ${esc(t('footer.replay'))}</span><span class="lbl">${esc(t('footer.replayNote'))}</span></span>
        </button>
      </div>
      <nav aria-label="${esc(t('footer.product'))}">
        <p class="lbl">${esc(t('footer.product'))}</p>
        <ul>
          <li><a href="${BRAND.appHref}">${esc(t('nav.open'))}</a></li>
          <li><a href="${BRAND.appHref}?import">${esc(t('hero.import'))}</a></li>
          <li><a href="#features">${esc(t('nav.features'))}</a></li>
          <li><a href="#mcp">${esc(t('sec.mcp'))}</a></li>
          <li><a href="#compare">${esc(t('nav.compare'))}</a></li>
          <li><a href="#faq">${esc(t('nav.faq'))}</a></li>
          <li><a href="${BRAND.homeHref}help/${ctx.lang === 'de' ? 'de/' : ''}">${esc(t('footer.help'))}</a></li>
        </ul>
      </nav>
      <nav aria-label="${esc(t('footer.project'))}">
        <p class="lbl">${esc(t('footer.project'))}</p>
        <ul>
          <li><a href="${BRAND.repoUrl}" rel="noopener">GitHub</a></li>
          <li><a href="${BRAND.repoUrl}/fork" rel="noopener">${esc(t('own.fork'))}</a></li>
          <li><a href="#own-it">${esc(t('sec.own'))}</a></li>
          <li><a href="${SELF_HOSTING}" rel="noopener">${esc(t('footer.selfhost'))}</a></li>
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
