/** Real shared-document sockets and real UI. Run with a root-base build:
 * BASE_PATH=/ npx vite build --outDir node_modules/.cache/block-authors-app
 * E2E_APP_DIR=node_modules/.cache/block-authors-app npx playwright test ...
 */
import { resolve } from 'node:path'
import * as Y from 'yjs'
import { test, expect, wsEval, gotoPage, waitForApp } from './fixtures'
import { startServer, signIn, openDoc, flushed, waitFor } from '../../server/test/helpers'

test('block editor plates toggle locally, show remote edits, persist the preference and work for viewers', async ({ page, context, browser, errors }) => {
  test.skip(!process.env.E2E_APP_DIR, 'needs a root-base app build (E2E_APP_DIR)')
  test.setTimeout(90_000)
  const s = await startServer({ APP_DIR: resolve(process.env.E2E_APP_DIR!) })
  const open: ReturnType<typeof openDoc>[] = []
  let viewerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    const alice = await signIn(s, 'alice@block-ui.test')
    const bob = await signIn(s, 'bob@block-ui.test')
    const viewer = await signIn(s, 'reader@block-ui.test')
    const ws = (await alice.post('/api/workspaces', { name: 'Block UI test' })).body.id
    for (const [client, role] of [[bob, 'member'], [viewer, 'viewer']] as const) {
      const inv = await alice.post(`/api/workspaces/${ws}/invites`, { role })
      await client.post(`/api/invites/${inv.body.link.split('#/invite/')[1]}/accept`)
    }
    await context.addCookies([...alice.cookies].map(([name, value]) => ({name, value, url:s.url})))
    await page.goto(`${s.url}/app/?e2e&w=${ws}`)
    await waitForApp(page)
    const id = await wsEval(page, state => {
      const id = state.createPage({title:'Shared block example'})
      state.setContent(id, {type:'doc',content:['One','Two'].map((text,i)=>({type:'paragraph',attrs:{id:`block${i}`},content:[{type:'text',text}]}))})
      return id
    })
    await gotoPage(page, id)
    await expect(page.locator('.ProseMirror').first()).toContainText('One')
    await expect(page.getByTestId('block-author')).toHaveCount(0)
    await page.getByRole('button', {name:'Page options',exact:true}).click()
    const toggle = page.getByRole('menuitemcheckbox', {name:'Show block editors'})
    await expect(toggle).toHaveAttribute('aria-checked','false')
    await toggle.click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('block-author')).toHaveCount(2)
    await expect(page.getByTestId('block-author').first()).toContainText('alice')
    const b = openDoc(s,bob,`ws:${ws}:p:${id}`); open.push(b); await b.synced
    const xml = b.doc.getXmlFragment('default')
    await waitFor(()=>xml.length>=2)
    const text = (xml.get(1) as Y.XmlElement).get(0) as Y.XmlText
    text.insert(0,'Bob changed: '); await flushed(b)
    await expect(page.getByTestId('block-author').nth(1)).toContainText('bob')
    await expect(page.getByTestId('block-author').first()).toContainText('alice')
    const stamps = JSON.stringify(b.doc.getMap('blockEditorsV1').toJSON())
    await page.reload(); await waitForApp(page)
    await expect(page.getByTestId('block-author').nth(1)).toContainText('bob')
    await page.getByRole('button', {name:'Page options',exact:true}).click()
    await page.getByRole('menuitemcheckbox', {name:'Show block editors'}).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('block-author')).toHaveCount(0)
    expect(JSON.stringify(b.doc.getMap('blockEditorsV1').toJSON())).toBe(stamps)
    // A fresh viewer browser sees the same author data but keeps an independent view preference.
    viewerContext = await browser.newContext({serviceWorkers:'block'})
    await viewerContext.addCookies([...viewer.cookies].map(([name,value])=>({name,value,url:s.url})))
    const v = await viewerContext.newPage()
    errors.watch(v)
    await v.goto(`${s.url}/app/?e2e&w=${ws}#/p/${id}`); await waitForApp(v)
    await v.getByRole('button', {name:'Page options',exact:true}).click()
    await v.getByRole('menuitemcheckbox', {name:'Show block editors'}).click()
    await v.keyboard.press('Escape')
    await expect(v.getByTestId('block-author').nth(1)).toContainText('bob')
    await v.screenshot({path:'test-results/block-authors-desktop.png',fullPage:true})
    await v.setViewportSize({width:390,height:844})
    await expect(v.locator('aside.sb')).not.toBeInViewport()
    await expect(v.getByTestId('block-author').first()).toBeVisible()
    await expect.poll(()=>v.getByTestId('block-author').first().evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})).toBe(true)
    await expect(page.getByTestId('block-author')).toHaveCount(0)
    await v.screenshot({path:'test-results/block-authors-mobile.png',fullPage:true})
  } finally { open.forEach(d=>d.destroy()); await viewerContext?.close(); await context.clearCookies(); await s.stop() }
})
