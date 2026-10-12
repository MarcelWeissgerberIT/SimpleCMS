/**
 * What One costs, everywhere it is said: local and self-hosted free (a donation optional), the hosted Team Cloud
 * $99 / 99 € per user and year while in development. The numbers and the donate address live in
 * src/shared/pricing.ts; the Donate link appears only once DONATE_URL holds an address (specs show it with a test
 * address under ?e2e).
 */
import { test, expect, openApp, MOD } from './fixtures'
import { DONATE_TEST_KEY, DONATE_URL, ONE_PRICING, cloudPrice, donateHref } from '../../src/shared/pricing'
import { donateLink } from '../../src/landing/site/donate'

const TEST_URL = 'https://donate.example.org/one'
const shipped = donateHref(DONATE_URL)

test.describe('pricing: the numbers (Node)', () => {
  test('the Team Cloud costs 99 per user and year, written per page; local and self-hosted cost nothing', () => {
    expect(ONE_PRICING.cloudPerUserYear).toEqual({ eur: 99, usd: 99 })
    expect(ONE_PRICING.selfHosted).toBe(0)
    expect(cloudPrice('en')).toBe('$99')
    // a no-break space: running text never wraps between "99" and "€"
    expect(cloudPrice('de')).toBe('99\u00a0€')
  })

  test('a donate address becomes a link only when it is an https address', () => {
    expect(donateHref('')).toBeNull()
    expect(donateHref('   ')).toBeNull()
    expect(donateHref(TEST_URL)).toBe(TEST_URL)
    expect(donateHref('http://donate.example.org/one')).toBeNull()
    expect(donateHref('javascript:alert(1)')).toBeNull()
    expect(donateHref('https://user:pw@donate.example.org/')).toBeNull()
    expect(donateHref('not a url')).toBeNull()
    // no address → no link at all; an address → one link with that address and the label
    expect(donateLink(null, 'Donate', 'btn')).toBe('')
    const html = donateLink(TEST_URL, 'Spenden', 'btn btn-line')
    expect(html).toContain(`href="${TEST_URL}"`)
    expect(html).toContain('>Spenden</a>')
    expect(html).toContain('data-donate')
  })
})

test.describe('pricing: landing page', () => {
  test('hero, calculator, compare, own-it and FAQ name the Team Cloud price; no donate link without an address', async ({ page }) => {
    await page.goto('./?skip')
    await expect(page.locator('.readout')).toContainText('Local, forever')
    await expect(page.locator('.readout')).not.toContainText(/per seat/i)
    // the cost dial starts on Notion's seat-year (USD on both pages, motion.ts) and its unit says so while it does
    await expect(page.locator('.readout-unit[data-from-unit]')).toHaveAttribute('data-from-unit', 'Notion · seat / year')
    await expect(page.locator('.readout-unit[data-from-unit]')).toHaveText('Local, forever')

    // calculator: 10 seats, Business, annual = $2,400 at Notion; the Team Cloud $990 → you would keep $1,410
    // (conditional: the cloud is planned, nobody can sign up yet)
    const calc = page.locator('#savings')
    await calc.scrollIntoViewIfNeeded()
    await expect(calc.locator('.calc-result')).toContainText('With the planned One Team Cloud you would keep')
    await expect(calc.locator('[data-total-big]')).toHaveText('$1,410')
    await expect(calc.locator('[data-five]')).toHaveText('Over five years: $7,050')
    // self-hosting keeps the whole Notion bill at most — the server is the team's own cost
    await expect(calc.locator('[data-self]')).toHaveText('Self-hosted: you keep up to $2,400 a year, minus your server')
    await expect(calc.locator('.calc-cloud')).toHaveText('One Team Cloud: $99 per user / year · in development')
    const receipt = calc.locator('[data-receipt]')
    await expect(receipt).toContainText('$2,400.00')
    await expect(receipt).toContainText('10 × $99.00')
    await expect(receipt).toContainText('$990.00')
    await expect(receipt.locator('[data-total-receipt]')).toHaveText('$1,410.00')
    await expect(receipt.locator('[data-self-receipt]')).toHaveText('$2,400.00')
    await expect(receipt.locator('.r-self')).toContainText('One self-hosted²')
    await expect(receipt.locator('.r-self')).toContainText('Saved before server')
    await expect(receipt).toContainText('the server you run it on is yours to pay')
    await expect(receipt).not.toContainText(/One local/i)
    await expect(receipt).toContainText('In development — there is no sign-up yet.')
    await expect(receipt).toContainText('Source: notion.com/pricing')
    // one seat more: Business annual $240 − $99 = $141 more kept
    await calc.getByRole('button', { name: 'One seat more' }).click()
    await expect(calc.locator('[data-total-big]')).toHaveText('$1,551')
    // Plus, monthly: 11 × $12 × 12 = $1,584 − 11 × $99 = $1,089 → $495
    await calc.getByRole('button', { name: /^Plus/ }).click()
    await calc.getByRole('button', { name: 'Monthly' }).click()
    await expect(calc.locator('[data-total-big]')).toHaveText('$495')
    await expect(calc.locator('[data-self]')).toHaveText('Self-hosted: you keep up to $1,584 a year, minus your server')
    // the screen-reader sentence says the same, in the same tense
    await expect(calc.locator('[data-calc-live]')).toHaveText(
      '11 seats, Notion Plus, billed monthly: with the planned One Team Cloud you would keep $495 a year; self-hosted, up to $1,584 minus your server.',
    )

    const price = page.locator('#compare tbody tr').filter({ hasText: 'Price' })
    await expect(price.locator('td').nth(1)).toContainText('hosted team cloud $99 per user/year, in development')

    const own = page.locator('#own-it')
    await expect(own.locator('[data-cloud-price]')).toContainText('$99')
    await expect(own.locator('.sec-lead')).toContainText('it will cost $99 per user per year')
    await expect(own.locator('[data-self-free]')).toContainText('a donation is welcome — never required')

    const faq = page.locator('#faq .faq-item').filter({ hasText: 'Will the team cloud cost money?' })
    await faq.locator('summary').click()
    await expect(faq).toContainText('$99 per user per year once it opens')
    await expect(faq).toContainText('nothing to sign up for yet')

    // the shipped address (empty today): wording without a link
    const donate = page.locator('#site [data-donate]')
    if (shipped) await expect(donate.first()).toHaveAttribute('href', shipped)
    else await expect(donate).toHaveCount(0)
    await expect(page.locator('footer')).not.toContainText(/Ninja|Armory|Jack/)
    await expect(page.locator('footer')).toContainText('Free in your browser and on your own server.')
  })

  test('with an address (test seam, ?e2e only) a Donate link appears in the plate and the footer', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [DONATE_TEST_KEY, TEST_URL])
    // a normal visit never reads the test address
    await page.goto('./?skip')
    if (!shipped) await expect(page.locator('#site [data-donate]')).toHaveCount(0)
    await page.goto('./?skip&e2e')
    const plate = page.locator('#own-it .plate-cloud')
    await expect(plate.getByRole('link', { name: 'Donate' })).toHaveAttribute('href', TEST_URL)
    await expect(page.locator('footer').getByRole('link', { name: 'Donate' })).toHaveAttribute('href', TEST_URL)
  })

  test.describe('German visitor', () => {
    test.use({ locale: 'de-DE' })
    test('99 € on the German page; the calculator counts in USD and says so; Spenden with an address', async ({ page }) => {
      await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [DONATE_TEST_KEY, TEST_URL])
      await page.goto('./?skip&e2e')
      await expect(page.locator('html')).toHaveAttribute('lang', 'de')
      // the headline makes no price claim the Team Cloud contradicts: no Notion subscription (the English page's
      // "Minus the bill." — Notion's), never "no subscription" at all
      await expect(page).toHaveTitle('SimpleCMS One — Notion, neu gebaut. Ohne Notion-Abo.')
      await expect(page.locator('#hero-h .line-in').nth(1)).toHaveText('Ohne Notion-Abo.')
      await expect(page.locator('#site')).not.toContainText(/Ohne Abo|kein Abo/i)
      await expect(page.locator('.readout-unit[data-from-unit]')).toHaveAttribute('data-from-unit', 'Notion · Platz / Jahr')
      await expect(page.locator('.readout-unit[data-from-unit]')).toHaveText('Lokal, für immer')
      const own = page.locator('#own-it')
      await expect(own.locator('[data-cloud-price]')).toContainText('99 €')
      await expect(own.locator('.sec-lead')).toContainText('99 € pro Nutzer und Jahr')
      await expect(own.getByRole('link', { name: 'Spenden' })).toHaveAttribute('href', TEST_URL)
      const calc = page.locator('#savings')
      await expect(calc.locator('.calc-cloud')).toContainText('99 € pro Nutzer / Jahr')
      await expect(calc.locator('.calc-cloud')).toContainText('gerechnet in USD wie Notion: 99 $')
      await expect(calc.locator('[data-total-big]')).toHaveText(/^1\.410\s\$$/)
      await expect(calc.locator('.calc-result')).toContainText('Mit der geplanten One Team-Cloud blieben dir')
      await expect(calc.locator('[data-self]')).toHaveText(/^Selbst gehostet: bis zu 2\.400\s\$ pro Jahr, abzüglich deines Servers$/)
      await expect(calc.locator('[data-receipt] .r-self')).toContainText('Gespart vor Serverkosten')
      await expect(calc.locator('[data-receipt]')).toContainText('hier in USD gerechnet, weil Notion in USD abrechnet')
      const faq = page.locator('#faq .faq-item').filter({ hasText: 'Wird die Team-Cloud etwas kosten?' })
      await faq.locator('summary').click()
      await expect(faq).toContainText('99 € pro Nutzer und Jahr, sobald sie startet')
      await expect(page.locator('#compare tbody tr').filter({ hasText: 'Preis' }).locator('td').nth(1)).toContainText('99 € pro Nutzer/Jahr')
    })
  })
})

test.describe('pricing: Settings → About', () => {
  async function openAbout(page: import('@playwright/test').Page) {
    await page.keyboard.press(`${MOD}+,`)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: /About/ }).click()
    return dialog
  }

  test('names the licences and what it costs; the Donate key only with an address', async ({ page }) => {
    await openApp(page)
    const dialog = await openAbout(page)
    await expect(dialog.locator('.about__spec')).toContainText('MIT · server AGPL-3.0')
    await expect(dialog.locator('.about')).not.toContainText(/Ninja|Armory/)
    await expect(dialog.getByTestId('about-price')).toContainText('it will cost $99 per user per year')
    await expect(dialog.getByTestId('about-price')).toContainText('a donation is welcome — never required')
    if (shipped) await expect(dialog.getByTestId('about-donate')).toHaveAttribute('href', shipped)
    else await expect(dialog.getByTestId('about-donate')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [DONATE_TEST_KEY, TEST_URL])
    await openApp(page)
    const again = await openAbout(page)
    await expect(again.getByTestId('about-donate')).toHaveAttribute('href', TEST_URL)
    await expect(again.getByTestId('about-donate')).toHaveText('Donate')
  })
})
