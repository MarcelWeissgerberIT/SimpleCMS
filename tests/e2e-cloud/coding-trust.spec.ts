/**
 * Coding pipeline in a team workspace: the worker on a device runs only task versions written or confirmed
 * on THAT device. A task's version covers its repo, branch and stage too — a stage moved past a gate on
 * another device (here: the same person's second browser, the Coding database is private) waits for
 * "Confirm on this device"; a move made here keeps the trust. No worker runs: the panel shows the rule.
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, waitOnline, createWorkspace } from './fixtures'
import { call, mockAgent, say } from '../e2e/helpers/terminal'

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

/** Move a task to a stage by its option name (a plain row write, like a board drag). */
const moveTo = (p: Page, id: string, name: string) =>
  wsEval(p, (s, a) => {
    const db = s.databases[s.pages[a.id].databaseId]
    const stage = db.properties.find((x: { name: string }) => x.name === 'Stage')
    s.setRowProperty(a.id, stage.id, stage.options.find((o: { name: string }) => o.name === a.name).id)
  }, { id, name })

const stageOf = (p: Page, id: string) =>
  wsEval(p, (s, id) => {
    const page = s.pages[id]
    if (!page) return null
    const stage = s.databases[page.databaseId].properties.find((x: { name: string }) => x.name === 'Stage')
    return (stage.options.find((o: { id: string }) => o.id === page.properties[stage.id])?.name ?? null) as string | null
  }, id)

test.describe('team cloud — coding tasks', () => {
  test('a stage moved on another device waits for "Confirm on this device"; a move made here stays trusted', async ({ page: a, context }) => {
    watch(a, 'ada')
    const ada = email('ada')
    await signIn(a, ada)
    const wsId = await createWorkspace(a, 'Coding team')
    await openApp(a, wsId)
    await waitOnline(a)

    // a task made here with New task: trusted on this device
    await a.evaluate(() => (window.location.hash = '#/coding'))
    await a.getByTestId('coding-new').click()
    await a.getByTestId('coding-new-title').fill('Ship the footer')
    await a.getByTestId('coding-new-repo').fill('website')
    await a.getByTestId('coding-new-goal').fill('Write footer.txt.')
    await a.getByTestId('coding-create').click()
    await expect(a.getByTestId('coding-panel')).toBeVisible()
    const id = await a.evaluate(() => window.location.hash.replace('#/p/', ''))
    const box = a.locator('.ctk-box--trust')
    const panel = a.getByTestId('coding-panel')
    await expect(a.locator('.ctk-code')).toContainText(/website · Ready/i)
    await expect(panel).toHaveAttribute('data-trust', 'yes')
    await expect(box).toHaveCount(0)

    // a move made here (like a board drag): still trusted
    await moveTo(a, id, 'Approve plan')
    await expect(a.locator('.ctk-code')).toContainText(/· Approve plan/i)
    await expect(a.getByTestId('coding-approve')).toBeVisible()
    await expect(panel).toHaveAttribute('data-trust', 'yes')
    await expect(box).toHaveCount(0)

    // the same person's second browser moves it past the gate, straight to Ship
    const b = await newPerson(context)
    watch(b, 'ada-2')
    await signIn(b, ada)
    await openApp(b, wsId)
    await waitOnline(b)
    await expect.poll(() => stageOf(b, id), { timeout: 20_000 }).toBe('Approve plan')
    await moveTo(b, id, 'Ship')

    // here: the change came from the server — the worker on this device would not take it
    await expect.poll(() => stageOf(a, id), { timeout: 20_000 }).toBe('Ship')
    await expect(panel).toHaveAttribute('data-trust', 'no')
    await expect(box).toContainText('written or changed on another device')
    await box.getByRole('button', { name: 'Confirm on this device' }).click()
    await expect(box).toHaveCount(0)
    // confirmed versions stay confirmed after a reload
    await a.reload()
    await expect(a.locator('.ctk-code')).toContainText(/· Ship/i)
    await expect(panel).toHaveAttribute('data-trust', 'yes')
    await expect(box).toHaveCount(0)
  })

  test('the AI terminal: an approval of a task moved on another device is refused ("Confirm … first") and never trusts it; a task the terminal created is trusted here', async ({ page: a, context }) => {
    watch(a, 'ada')
    const ada = email('ada')
    await signIn(a, ada)
    const wsId = await createWorkspace(a, 'Coding team')
    await openApp(a, wsId)
    await waitOnline(a)
    await wsEval(a, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    // a task made here, then moved to the gate on the second browser: it waits for Confirm here
    await a.evaluate(() => (window.location.hash = '#/coding'))
    await a.getByTestId('coding-new').click()
    await a.getByTestId('coding-new-title').fill('Ship the footer')
    await a.getByTestId('coding-new-repo').fill('website')
    await a.getByTestId('coding-new-goal').fill('Write footer.txt.')
    await a.getByTestId('coding-create').click()
    await expect(a.getByTestId('coding-panel')).toBeVisible()
    const id = await a.evaluate(() => window.location.hash.replace('#/p/', ''))
    const b = await newPerson(context)
    watch(b, 'ada-2')
    await signIn(b, ada)
    await openApp(b, wsId)
    await waitOnline(b)
    await expect.poll(() => stageOf(b, id), { timeout: 20_000 }).toBe('Ready')
    await moveTo(b, id, 'Approve plan')
    await expect.poll(() => stageOf(a, id), { timeout: 20_000 }).toBe('Approve plan')
    const panel = a.getByTestId('coding-panel')
    await expect(panel).toHaveAttribute('data-trust', 'no')

    await mockAgent(context, [
      call('toolu_ap', 'task_action', { id, action: 'approve' }),
      call('toolu_ct', 'create_task', { title: 'Footer links', repo: 'website', goal: 'Add the links to footer.txt.' }),
      say('Staged.'),
    ])
    await a.keyboard.press('Control+j')
    const term = a.getByRole('region', { name: 'AI terminal' })
    await term.getByRole('textbox', { name: 'Task for the agent' }).fill('Approve the footer plan and add a links task')
    await term.getByRole('textbox', { name: 'Task for the agent' }).press('Enter')
    await expect(term.locator('.term-answer')).toContainText('Staged.')
    const approve = term.locator('.term-change').first()
    await expect(approve.getByTestId('term-tag-confirm')).toHaveText('CONFIRM FIRST')
    await approve.getByRole('button', { name: 'Apply #1' }).click()
    await expect(approve).toHaveAttribute('data-status', 'failed')
    await expect(approve.locator('.term-change__error')).toContainText('Confirm the task on its page first')
    expect(await stageOf(a, id)).toBe('Approve plan')
    // still not trusted: the panel asks as before
    await expect(panel).toHaveAttribute('data-trust', 'no')

    // the task created from the terminal (its whole page was in the review): trusted on this device
    await term.locator('.term-change').nth(1).getByRole('button', { name: 'Apply #2' }).click()
    await expect(term.locator('.term-change').nth(1)).toHaveAttribute('data-status', 'applied')
    const made = await wsEval(a, (s) => (Object.values(s.pages) as Array<{ id: string; title: string; databaseId?: string }>).find((p) => p.title === 'Footer links' && p.databaseId)?.id ?? null)
    expect(made).toBeTruthy()
    await a.keyboard.press('Control+j')
    await a.evaluate((id) => (window.location.hash = `#/p/${id}`), made!)
    await expect(a.getByTestId('coding-panel')).toHaveAttribute('data-trust', 'yes')

    // Confirm here, then the refused approval applies
    await a.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
    await a.locator('.ctk-box--trust').getByRole('button', { name: 'Confirm on this device' }).click()
    await a.keyboard.press('Control+j')
    await approve.getByRole('button', { name: 'Apply #1' }).click()
    await expect(approve).toHaveAttribute('data-status', 'applied')
    expect(await stageOf(a, id)).toBe('Implement')
  })
})
