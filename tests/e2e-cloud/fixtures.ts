/**
 * Helpers for the team-cloud suite. Mutating API calls run inside the page (the server checks
 * Origin / Sec-Fetch-Site), sign-in links come from the server's dev mailbox.
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'

export { expect }
export const test = base

let seq = 0
/** A unique address per call, so tests never share accounts. */
export const email = (name: string) => `${name}.${Date.now().toString(36)}${(seq++).toString(36)}@example.test`

/** POST/PATCH/DELETE from the app origin (same-origin fetch with the session cookie). */
export async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = text
      }
      return { status: res.status, json: json as never }
    },
    { method, path, body },
  )
}

/** The last sign-in / invite mail sent to `to` (dev mailbox). */
export async function lastMail(page: Page, to: string): Promise<{ subject: string; text: string; link: string }> {
  let mail: { subject: string; text: string; link: string } | undefined
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)
        const list = (await res.json()) as Array<{ subject: string; text: string; link: string }>
        mail = list.at(-1)
        return !!mail
      },
      { timeout: 10_000 },
    )
    .toBe(true)
  return mail!
}

/** Sign `page` in as `address` through the real magic-link flow (request → mailbox → link). */
export async function signIn(page: Page, address: string): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('/app/')
  const r = await api(page, 'POST', '/api/auth/request', { email: address, redirect: '/app/' })
  expect(r.status).toBeLessThan(300)
  const mail = await lastMail(page, address)
  await page.goto(mail.link)
  const me = await api<{ user: { email: string } }>(page, 'GET', '/api/me')
  expect(me.status).toBe(200)
  expect(me.json.user.email).toBe(address)
}

/** A second, independent browser (own cookies, own IndexedDB) — e.g. the invited colleague. */
export async function newPerson(context: BrowserContext): Promise<Page> {
  const ctx = await context.browser()!.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  })
  return ctx.newPage()
}
