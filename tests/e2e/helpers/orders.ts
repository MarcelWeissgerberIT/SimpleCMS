/**
 * Work orders on the plate — what a person does before ↵ Kette starten can act (B8, spec §1.5 "seen in full"): every
 * station scrolled through (its top and its bottom edge on screen), every page that goes along opened, the server's
 * Kontext box read to its end. Shared by the orders specs.
 */
import type { Page } from '@playwright/test'
import { expect } from '../fixtures'

/**
 * Read the chain's card on the plate in full (Fix 2): the step as it will run and its Grundlage — both open — scrolled
 * through to their ends; then its ↵ can act.
 */
export async function readCard(page: Page): Promise<void> {
  const card = page.getByTestId('order-plate').getByTestId('order-chain-card')
  await expect(card).toBeVisible()
  await page.keyboard.press('Shift')
  const edges = card.locator('.orc-edge')
  const n = await edges.count()
  for (let i = 0; i < n; i++) await edges.nth(i).scrollIntoViewIfNeeded()
}

/** Read the plan in Kette bereit in full, as a person does (a key first: the page column lets its scroll hold go). */
export async function readPlan(page: Page): Promise<void> {
  const ready = page.getByTestId('order-plate').getByTestId('order-ready')
  await expect(ready).toBeVisible()
  await page.keyboard.press('Shift')
  const edges = ready.locator('.orc-edge')
  const n = await edges.count()
  for (let i = 0; i < n; i++) await edges.nth(i).scrollIntoViewIfNeeded()
  const folds = ready.getByTestId('order-plan-ref')
  const m = await folds.count()
  for (let i = 0; i < m; i++) {
    const fold = folds.nth(i)
    if ((await fold.getAttribute('open')) === null) await fold.locator('summary').first().click()
    await expect(fold).toHaveAttribute('data-seen', '')
  }
}
