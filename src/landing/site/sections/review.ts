import { BRAND } from '@/shared/brand'
import type { Ctx } from '../context'
import { agentSchematic } from '../figures'
import { CROPS, zoomButton } from '../frame'
import type { ReviewStep } from '../messages'
import { asset, esc } from '../util'
import { sectionHead } from './head'

/**
 * § 01 — Claude · Review: the gate between Claude and the workspace. Four checks (edits word by
 * word, memory proposals, a script's dry run, a version before every write) as vertical mode keys;
 * each one switches the screenshot in the frame (frame.ts bindFrameTabs: the wrapper is the
 * `[data-frame-tabs]` scope, so keys, panel, images and caption share one controller).
 */

/** The help article behind each check (public pages under /help/, German under /help/de/). */
const HELP: Record<ReviewStep['key'], string> = {
  edit: 'agent',
  memory: 'memory',
  dryrun: 'one-script',
  history: 'history',
}

/** A check's key: its title names the tab; the text (shown for the selected one) describes it. */
const key = (s: ReviewStep, i: number) => `
        <button type="button" class="rv-key" role="tab" id="rv-t${i}" aria-controls="rv-p" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${i}" aria-labelledby="rv-h${i}" aria-describedby="rv-d${i}">
          <span class="rv-key-n" aria-hidden="true">${String.fromCharCode(65 + i)}</span>
          <span class="rv-key-body">
            <span class="rv-key-h" id="rv-h${i}">${esc(s.title)}</span>
            <span class="lbl rv-key-spec">${esc(s.spec)}</span>
            <span class="rv-key-more"><span class="rv-key-p" id="rv-d${i}">${esc(s.text)}</span></span>
          </span>
          <span class="rv-key-led" aria-hidden="true"></span>
        </button>`

export function renderReview(ctx: Ctx): string {
  const { t, c, lang } = ctx
  const steps = c.review
  const help = (id: string) => `${BRAND.homeHref}help/${lang === 'de' ? 'de/' : ''}${id}/`
  const imgs = steps
    .map(
      (s, i) =>
        `<img class="frame-img${i === 0 ? ' is-on' : ''}" src="${asset(`assets/shots/${s.shot}.webp`)}" alt="${esc(s.fig)}" width="1600" height="1000" decoding="async" loading="lazy" data-shot="${i}"${i ? ' aria-hidden="true"' : ''} />`,
    )
    .join('')
  // the path of every change; "Reviewed" — the step that is yours — in the signal colour
  const chain = (['s1', 's2', 's3', 's4'] as const)
    .map((k) => `<li${k === 's2' ? ' class="is-you"' : ''}><span class="rv-chain-dot" aria-hidden="true"></span><span>${esc(t(`review.${k}`))}</span></li>`)
    .join('')
  const links = steps.map((s) => `<a href="${help(HELP[s.key])}">${esc(t(`review.help.${s.key}`))}</a>`).join('<span aria-hidden="true">·</span>')
  return `
<section id="review" class="sec sec-review" data-tone="paper" aria-labelledby="review-h">
  <div class="wrap">
    ${sectionHead('review', t('review.label'), t('review.title'), t('review.lead'))}
    <div class="rv" data-frame-tabs>
      <div class="rv-gate" data-reveal>
        <p class="lbl rv-gate-h"><span><span class="led led-on" aria-hidden="true"></span>${esc(t('review.gate'))}</span><span>${esc(t('review.checks', { n: steps.length }))}</span></p>
        <div class="rv-keys" role="tablist" aria-orientation="vertical" aria-label="${esc(t('review.keys'))}">${steps.map(key).join('')}
        </div>
        <ol class="lbl rv-chain" aria-label="${esc(t('review.chain'))}">${chain}</ol>
        <p class="lbl rv-help"><span>${esc(t('review.manual'))}</span>${links}</p>
      </div>
      <div class="rv-fig" data-reveal>
        <figure class="frame frame-tabs frame-review">
          <div class="frame-box">
            ${CROPS}
            <div class="frame-media" id="rv-p" role="tabpanel" aria-labelledby="rv-t0">
              <div class="frame-sk">${agentSchematic(lang, steps[0]?.fig ?? '')}</div>
              ${imgs}
              ${zoomButton(t('fig.enlarge'))}
            </div>
          </div>
          <figcaption class="frame-cap lbl"><span data-cap>${esc(steps[0]?.fig ?? '')}</span><span>1600 × 1000</span></figcaption>
        </figure>
      </div>
    </div>
  </div>
</section>`
}
