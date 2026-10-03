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

/* ------------------------------------------------------------------ */
/* App in a cloud workspace                                            */
/* ------------------------------------------------------------------ */

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Wait until the app booted (test hook present, boot screen gone). */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one, null, { timeout: 30_000 })
  await expect(page.locator('#boot')).toHaveCount(0)
}

/** Open the app with the test hook; `ws` opens that cloud workspace in this tab (?w=). */
export async function openApp(page: Page, ws?: string, hash = ''): Promise<void> {
  await page.goto(`/app/?e2e${ws ? `&w=${ws}` : ''}${hash ? `#${hash.replace(/^#/, '')}` : ''}`)
  await waitForApp(page)
}

/** Run a function against the workspace store state in the page. */
export async function wsEval<R, A = undefined>(page: Page, fn: (s: AnyState, arg: A) => R, arg?: A): Promise<R> {
  return page.evaluate(
    ({ src, arg }) => {
      const s = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
      // eslint-disable-next-line no-new-func
      return new Function('s', 'arg', `return (${src})(s, arg)`)(s, arg)
    },
    { src: fn.toString(), arg: arg as A },
  ) as Promise<R>
}

/** Run a function against the cloud state (useCloud) in the page. */
export async function cloudEval<R, A = undefined>(page: Page, fn: (c: AnyState, arg: A) => R, arg?: A): Promise<R> {
  return page.evaluate(
    ({ src, arg }) => {
      const c = (window as unknown as { __one: { cloud: { useCloud: { getState: () => AnyState } } } }).__one.cloud.useCloud.getState()
      // eslint-disable-next-line no-new-func
      return new Function('c', 'arg', `return (${src})(c, arg)`)(c, arg)
    },
    { src: fn.toString(), arg: arg as A },
  ) as Promise<R>
}

export const cloudStatus = (page: Page) => cloudEval(page, (c) => c.status as string)

/** Wait until the open cloud workspace is connected and in sync. */
export async function waitOnline(page: Page): Promise<void> {
  await expect.poll(() => cloudStatus(page), { timeout: 20_000 }).toBe('online')
}

/** Navigate (hash routing) to a page and wait for its editor. */
export async function gotoPage(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    window.location.hash = `#/p/${id}`
  }, id)
  await expect(editorOf(page, id)).toBeVisible()
}

export function editorOf(page: Page, id: string) {
  return page.locator(`.ProseMirror[data-page-id="${id}"]`)
}

/** Create a team workspace via the API (as the signed-in user of `page`). */
export async function createWorkspace(page: Page, name: string): Promise<string> {
  const ws = await api<{ id: string }>(page, 'POST', '/api/workspaces', { name })
  expect(ws.status).toBe(201)
  return ws.json.id
}

/** Invite + accept: `guest` (signed in) joins `wsId` with `role`. */
export async function join(owner: Page, guest: Page, wsId: string, role: 'admin' | 'member' | 'viewer' = 'member'): Promise<void> {
  const inv = await api<{ link: string }>(owner, 'POST', `/api/workspaces/${wsId}/invites`, { role })
  expect(inv.status).toBe(201)
  const token = inv.json.link.split('#/invite/')[1]
  const acc = await api<{ workspaceId: string }>(guest, 'POST', `/api/invites/${token}/accept`, {})
  expect(acc.status).toBe(200)
  expect(acc.json.workspaceId).toBe(wsId)
}
