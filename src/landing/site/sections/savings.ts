import type { Ctx } from '../context'
import { NOTION_PRICING, formatUsd, notionYearly, type Billing, type NotionPlan } from '../pricing'
import { esc } from '../util'
import { sectionHead } from './head'

export interface CalcState {
  seats: number
  plan: NotionPlan
  billing: Billing
}

/** Calculator state survives language re-renders. */
export const calcState: CalcState = { seats: 10, plan: 'business', billing: 'annual' }

const MIN = 1
const MAX = 100

export function renderSavings(ctx: Ctx): string {
  const { t } = ctx
  const s = calcState
  const planKey = (p: NotionPlan) =>
    `<button type="button" class="key" data-plan="${p}" aria-pressed="${s.plan === p}">
      <span class="key-led" aria-hidden="true"></span>
      <span class="key-name">${esc(t(`savings.${p}`))}</span>
      <span class="key-note">${esc(t(p === 'business' ? 'savings.businessNote' : 'savings.plusNote'))}</span>
      <span class="key-price lbl" data-plan-price="${p}"></span>
    </button>`
  return `
<section id="savings" class="sec sec-savings" data-tone="paper" aria-labelledby="savings-h">
  <div class="wrap">
    ${sectionHead('savings', t('savings.label'), t('savings.title'), t('savings.lead'))}
    <div class="calc">
      <div class="panel" data-reveal role="group" aria-label="${esc(t('savings.title'))}">
        <i class="screw s-tl" aria-hidden="true"></i><i class="screw s-tr" aria-hidden="true"></i><i class="screw s-bl" aria-hidden="true"></i><i class="screw s-br" aria-hidden="true"></i>
        <div class="ctl ctl-team">
          <label class="lbl" for="seats">${esc(t('savings.team'))}</label>
          <div class="lcd tone-carbon" aria-hidden="true"><span class="lcd-num"><span class="lcd-val" data-seats-lcd>${String(s.seats).padStart(3, '0')}</span></span><span class="lbl lcd-unit">${esc(t('savings.seats'))}</span></div>
          <div class="stepper">
            <button type="button" class="key key-sq" data-step="-1" aria-label="${esc(t('savings.less'))}">−</button>
            <div class="range">
              <input id="seats" type="range" min="${MIN}" max="${MAX}" step="1" value="${s.seats}" />
              <div class="range-scale" aria-hidden="true"><span>1</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
            </div>
            <button type="button" class="key key-sq" data-step="1" aria-label="${esc(t('savings.more'))}">+</button>
          </div>
        </div>
        <fieldset class="ctl">
          <legend class="lbl">${esc(t('savings.plan'))}</legend>
          <div class="keys">${planKey('plus')}${planKey('business')}</div>
        </fieldset>
        <fieldset class="ctl">
          <legend class="lbl">${esc(t('savings.billing'))}</legend>
          <div class="toggle" data-billing-toggle>
            <button type="button" data-billing="monthly" aria-pressed="${s.billing === 'monthly'}">${esc(t('savings.monthly'))}</button>
            <button type="button" data-billing="annual" aria-pressed="${s.billing === 'annual'}">${esc(t('savings.annual'))}</button>
            <span class="toggle-thumb" aria-hidden="true"></span>
          </div>
        </fieldset>
        <div class="calc-result">
          <p class="lbl">${esc(t('savings.headline'))}</p>
          <p class="calc-big disp"><span data-total-big></span><span class="calc-per">${esc(t('savings.perYear'))}</span></p>
          <p class="lbl calc-five" data-five></p>
        </div>
      </div>
      <div class="printer" data-reveal>
        <div class="printer-head tone-carbon" aria-hidden="true"><span class="led led-on"></span><span class="lbl">TM-ONE · 58 MM</span><span class="printer-slot"></span></div>
        <div class="receipt-clip">
          <article class="receipt tone-print" data-receipt aria-live="polite" aria-label="${esc(t('savings.receipt'))}"></article>
        </div>
      </div>
    </div>
  </div>
</section>`
}

function receiptHtml(ctx: Ctx, s: CalcState): string {
  const { t, lang } = ctx
  const price = NOTION_PRICING.perSeatMonth[s.plan][s.billing]
  const total = notionYearly(s.plan, s.billing, s.seats)
  const money = (v: number) => formatUsd(v, lang)
  const planName = `${t(`savings.${s.plan}`)}${s.plan === 'business' ? ' + AI' : ''}`
  const d = new Date()
  const date = d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const row = (a: string, b: string, cls = '') => `<div class="r-row ${cls}"><span>${a}</span><span>${b}</span></div>`
  const barcode = Array.from({ length: 46 }, (_, i) => `<i style="width:${1 + ((i * 7 + s.seats) % 3)}px"></i>`).join('')
  return `
    <header class="r-head">
      <p class="r-shop">${esc(t('r.shop'))}</p>
      <p>${esc(t('r.sub'))}</p>
    </header>
    <div class="r-rule r-stars" aria-hidden="true"></div>
    ${row(esc(t('r.date')), esc(date))}
    ${row(esc(t('r.term')), esc(t('r.term12')))}
    ${row(esc(t('r.seats')), String(s.seats))}
    ${row(esc(t('r.billing')), esc(t(s.billing === 'annual' ? 'savings.annual' : 'savings.monthly')))}
    <div class="r-rule" aria-hidden="true"></div>
    <div class="r-item">
      ${row(esc(t('r.notion', { plan: planName })), money(total))}
      <p class="r-calc">${esc(t('r.calc', { seats: s.seats, price: money(price) }))}</p>
    </div>
    ${row(esc(t('r.one')), money(0))}
    ${row(esc(t('r.hosting')), money(0))}
    ${row(esc(t('r.accounts')), money(0))}
    ${row(esc(t('r.ai')), esc(t('r.aiValue')))}
    <div class="r-rule r-double" aria-hidden="true"></div>
    ${row(esc(t('r.saved')), `<b data-total-receipt>${money(total)}</b>`, 'r-total')}
    ${row(esc(t('r.five')), money(total * 5), 'r-five')}
    <p class="r-stamp" aria-hidden="true"><span>${esc(t('r.paid'))}</span></p>
    <div class="r-rule" aria-hidden="true"></div>
    <p class="r-note">${esc(t('r.foot'))}</p>
    <p class="r-note">${esc(t('r.source', { asOf: NOTION_PRICING.asOf[lang] }))}</p>
    <div class="r-barcode" aria-hidden="true">${barcode}</div>
    <p class="r-thanks">${esc(t('r.thanks'))}</p>`
}

/** Wire the controls. `onChange(first)` lets the motion layer animate re-prints. */
export function bindSavings(root: HTMLElement, ctx: Ctx, hooks: { onReprint?: (receipt: HTMLElement) => void } = {}): void {
  const sec = root.querySelector<HTMLElement>('#savings')
  if (!sec) return
  const range = sec.querySelector<HTMLInputElement>('#seats')!
  const lcd = sec.querySelector<HTMLElement>('[data-seats-lcd]')!
  const receipt = sec.querySelector<HTMLElement>('[data-receipt]')!
  const big = sec.querySelector<HTMLElement>('[data-total-big]')!
  const five = sec.querySelector<HTMLElement>('[data-five]')!
  const { t, lang } = ctx

  sec.querySelectorAll<HTMLElement>('[data-plan-price]').forEach((el) => {
    const p = el.dataset.planPrice as NotionPlan
    el.textContent = t('savings.perSeat', { price: formatUsd(NOTION_PRICING.perSeatMonth[p][calcState.billing], lang, false) })
  })

  const update = (reprint: boolean) => {
    const s = calcState
    range.value = String(s.seats)
    range.style.setProperty('--fill', `${((s.seats - MIN) / (MAX - MIN)) * 100}%`)
    lcd.textContent = String(s.seats).padStart(3, '0')
    const total = notionYearly(s.plan, s.billing, s.seats)
    big.textContent = formatUsd(total, lang, false)
    five.textContent = t('savings.fiveYears', { amount: formatUsd(total * 5, lang, false) })
    sec.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plan === s.plan)))
    sec.querySelectorAll<HTMLButtonElement>('[data-billing]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.billing === s.billing)))
    sec.querySelector('[data-billing-toggle]')?.setAttribute('data-state', s.billing)
    sec.querySelectorAll<HTMLElement>('[data-plan-price]').forEach((el) => {
      const p = el.dataset.planPrice as NotionPlan
      el.textContent = t('savings.perSeat', { price: formatUsd(NOTION_PRICING.perSeatMonth[p][s.billing], lang, false) })
    })
    receipt.innerHTML = receiptHtml(ctx, s)
    if (reprint) hooks.onReprint?.(receipt)
  }

  const setSeats = (n: number) => {
    const v = Math.max(MIN, Math.min(MAX, Math.round(n)))
    if (v === calcState.seats) return
    calcState.seats = v
    update(true)
  }

  range.addEventListener('input', () => setSeats(Number(range.value)))
  sec.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
    let hold = 0
    let rep = 0
    const step = () => setSeats(calcState.seats + Number(b.dataset.step))
    const stop = () => {
      window.clearTimeout(hold)
      window.clearInterval(rep)
    }
    b.addEventListener('click', (e) => {
      // Keyboard / simple clicks. Pointer-held repeats are handled below.
      if ((e as PointerEvent).detail === 0) step()
    })
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      step()
      hold = window.setTimeout(() => (rep = window.setInterval(step, 70)), 380)
    })
    b.addEventListener('pointerup', stop)
    b.addEventListener('pointerleave', stop)
    b.addEventListener('pointercancel', stop)
  })
  sec.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = b.dataset.plan as NotionPlan
      if (p === calcState.plan) return
      calcState.plan = p
      update(true)
    }),
  )
  sec.querySelectorAll<HTMLButtonElement>('[data-billing]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.billing as Billing
      if (v === calcState.billing) return
      calcState.billing = v
      update(true)
    }),
  )
  update(false)
}

