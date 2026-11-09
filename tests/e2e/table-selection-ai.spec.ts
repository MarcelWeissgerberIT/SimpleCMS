import type { Editor } from '@tiptap/core'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, doc, para, MOD } from './fixtures'
import { mockClaudeScript, text } from './helpers/providers'

const cell = (value: string, header = false) => ({ type: header ? 'tableHeader' : 'tableCell', content: [para(value)] })
const fixture = () => doc(para('Outside selection'), {
  type: 'table', content: [
    { type: 'tableRow', content: [cell('Field', true), cell('Value', true), cell('Note', true)] },
    { type: 'tableRow', content: [cell('Volume'), cell('4.0'), cell('Required')] },
    { type: 'tableRow', content: [cell('Speed'), cell('99'), cell('Optional')] },
  ],
})

for (const scenario of [
  { name: 'row', start: 'Volume', end: 'Required', includes: ['Volume', '4.0', 'Required'], excludes: ['Speed', 'Optional'] },
  { name: 'column', start: '4.0', end: '99', includes: ['4.0', '99'], excludes: ['Volume', 'Speed', 'Required', 'Optional'] },
  { name: 'reverse rectangle', start: 'Optional', end: '4.0', includes: ['4.0', 'Required', '99', 'Optional'], excludes: ['Volume', 'Speed'] },
  { name: 'single cell via shortcut', start: 'Volume', end: 'Volume', includes: ['Volume'], excludes: ['4.0', 'Required', 'Speed'], shortcut: true },
]) {
  test(`Ask AI uses the selected table ${scenario.name}`, async ({ page, context }) => {
    const mock = await mockClaudeScript(context, [text('Selection received.')])
    await openApp(page)
    await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'Table selection', content: fixture() })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.getByText('Volume', { exact: true }).click()
    await ed.evaluate((root, { start, end }) => {
      const editor = (root as HTMLElement & { editor: Editor }).editor
      const positions: Record<string, number> = {}
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions[node.textContent] = pos
      })
      editor.chain().focus().setCellSelection({ anchorCell: positions[start], headCell: positions[end] }).run()
    }, scenario)
    await expect(ed.locator('.selectedCell')).not.toHaveCount(0)
    const before = await ed.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())
    if (scenario.shortcut) await page.keyboard.press(`${MOD}+Shift+j`)
    else await page.getByRole('toolbar', { name: 'Table tools' }).getByRole('button', { name: 'Ask AI', exact: true }).click()
    const terminal = page.getByRole('region', { name: 'AI terminal' })
    await expect(terminal).toBeVisible()
    const ref = terminal.locator('.term-chip[data-kind="ref"]')
    await expect(ref).toHaveCount(1)
    const markdown = await ref.getAttribute('title')
    for (const value of scenario.includes) expect(markdown).toContain(value)
    for (const value of [...scenario.excludes, 'Outside selection']) expect(markdown).not.toContain(value)
    expect(mock.requests).toHaveLength(0)
    const prompt = terminal.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('Explain the selected cells.')
    await prompt.press('Enter')
    await expect(terminal).toContainText('Selection received.')
    for (const value of scenario.includes) expect(JSON.stringify(mock.requests[0].body.messages)).toContain(value)
    expect(await ed.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(before)
  })
}
