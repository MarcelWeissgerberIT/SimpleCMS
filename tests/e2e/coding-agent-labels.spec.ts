import { test, expect, openApp, gotoPage, wsEval } from './fixtures'
import { seedPipeline, waitPreflight, flushLamps } from './helpers/preflightStory.mjs'

// Display fixtures only: no model, command or worker is started.
for (const lang of ['en', 'de'] as const) for (const agent of ['claude', 'codex', 'local', 'minimax', 'ollama'] as const) {
  test(`${lang}: ${agent} names its question and permission; the overview stays neutral`, async ({ page }) => {
    await openApp(page)
    await waitPreflight(page)
    await wsEval(page, (s, language) => s.updateSettings({ language }), lang)
    const pipe = await seedPipeline(page)
    const id = pipe.tasks[1]!
    await gotoPage(page, id)
    await page.getByTestId('coding-agent-select').selectOption(agent)
    const name = agent === 'claude' ? 'Claude Code' : agent === 'codex' ? 'Codex' : agent === 'minimax' ? 'MiniMax · API' : agent === 'ollama' ? 'Ollama Cloud' : lang === 'de' ? 'Lokal · Ollama' : 'Local · Ollama'
    await page.evaluate((id) => {
      const p = (window as any).__onePreflight
      p.stores.codingLocal.setState((s: any) => ({ tasks: { ...s.tasks, [`local:local|${id}`]: { state: 'question', question: 'Which source should I use?', at: Date.now() } } }))
    }, id)
    await expect(page.getByTestId('coding-panel')).toContainText(`${name} ${lang === 'de' ? 'fragt' : 'asks'}`)
    await page.evaluate(() => { window.location.hash = '#/' })
    await flushLamps(page)
    const cap = page.locator('.pf-cap[data-lamp="question"]')
    await expect(cap).toHaveAttribute('data-lit', 'amber')
    await cap.focus()
    await page.keyboard.press('Enter')
    const card = page.locator('.pf-q article.pf-card[data-current]')
    await expect(card).not.toHaveAttribute('aria-busy', 'true')
    await expect(card).toContainText(`${name} ${lang === 'de' ? 'fragt' : 'asks'}`)
    const permission = page.locator('.pf-cap[data-lamp="permission"]')
    // Save an overview picture before returning to the task.
    for (const [width, height, theme] of agent === 'codex' && lang === 'de' ? [[1440, 900, 'light'], [1440, 900, 'dark'], [390, 844, 'light'], [390, 844, 'dark']] as const : []) {
      await page.setViewportSize({ width, height })
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await page.screenshot({ path: `/tmp/one-agent-labels-${width}-${theme}.png`, animations: 'disabled' })
    }
    await gotoPage(page, id)
    await page.evaluate((id) => {
      const p = (window as any).__onePreflight
      const ask = { id: 'a1b2c3d4e5f6a7b8c9d0e1f2', tool: 'Read', kind: 'read', what: 'Read the selected project document', rule: null, repo: 'fixture', at: Date.now(), until: Date.now() + 900000 }
      p.stores.coding.setState({ asks: { [id]: ask }, busy: [{ taskId: id, repo: 'fixture', stageId: 'fixture-stage', since: Date.now(), ask }] })
      p.stores.codingLocal.setState((s: any) => ({ tasks: { ...s.tasks, [`local:local|${id}`]: { state: 'running', at: Date.now() } } }))
    }, id)
    await expect(page.getByTestId('coding-permission')).toContainText(`${name} ${lang === 'de' ? 'möchte' : 'wants'}`)
    await page.evaluate(() => { window.location.hash = '#/' })
    await flushLamps(page)
    await expect(permission).toContainText('Agent')
    await expect(permission).not.toContainText('Claude')
  })
}
