import { createServer, type Server } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { coderServer } from '../../mcp/src/local-coder/server'
import { test, expect, openApp, uiEval, wsEval, reloadApp } from './fixtures'

function pdfFixture(text: string): Buffer {
  const stream = `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

test('local MCP: rejects a bad key, stores the valid key in the vault, runs a task and reconnects after reload', async ({ page, errors }) => {
  test.setTimeout(90000)
  errors.allow(/401|Unauthorized/)
  const key = 'one-coder-browser-test-key-with-more-than-32-chars'
  const requests: unknown[] = []
  const ollama = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/show') { for await (const _ of req) { /* consume */ }; return res.end(JSON.stringify({ system: 'Owner profile marker: prefer verified evidence.' })) }
  if (req.url === '/api/ps' || req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'test-coder' }] }))
    let body = ''
    for await (const c of req) body += c
    requests.push(JSON.parse(body))
    res.end(JSON.stringify({ message: { content: 'def add(a, b):\n    return a + b' } }))
  })
  const listen = (s: Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)))
  const port = await listen(ollama)
  const origin = new URL(test.info().project.use.baseURL!).origin
  const service = coderServer({ key: () => key, origins: [origin], model: 'test-coder', ollama: `http://127.0.0.1:${port}` })
  const url = `http://127.0.0.1:${await listen(service)}/mcp`
  try {
    await openApp(page)
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
    const card = page.getByTestId('settings-plate-local')
    await expect(card).toHaveClass('pplate')
    await card.getByRole('button', { name: 'Set up local model' }).click()
    const panel = page.getByTestId('local-coder')
    await panel.getByLabel('Local MCP address').fill(url)
    await panel.getByLabel('Your local API key', { exact: true }).fill('wrong-key-with-more-than-32-characters')
    await panel.getByRole('button', { name: 'Check & save connection' }).click()
    await expect(panel.getByRole('alert')).toContainText('rejected')
    await panel.getByLabel('Your local API key', { exact: true }).fill(key)
    await panel.getByRole('button', { name: 'Check & save connection' }).click()
    await expect(panel.getByRole('status')).toContainText('Connected')
    await expect(panel.getByLabel('Your local API key', { exact: true })).toHaveValue('')
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(key)
    const sealed = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('one-vault'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const values = await new Promise<any[]>(resolve => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => resolve(r.result) })
      db.close()
      return values.some(v => v?.data instanceof ArrayBuffer && v?.iv instanceof Uint8Array)
    })
    expect(sealed).toBe(true)
    await panel.getByLabel('Coding task', { exact: true }).fill('Implement add(a,b) in Python')
    await panel.getByLabel('Source code and context (optional)').fill('Use Python 3')
    const zip = zipSync({ 'src/add.py': strToU8('def add(a,b): return a+b # ZIP_SOURCE'), '.env': strToU8('NEVER_SEND_SECRET'), '../outside.txt': strToU8('NEVER_SEND_TRAVERSAL') })
    const docx = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>WORD_REQUIREMENT</w:t></w:r></w:p></w:body></w:document>') })
    const xlsx = zipSync({ 'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Data" r:id="s1"/></sheets></workbook>'), 'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>EXCEL_REQUIREMENT</t></is></c></row></sheetData></worksheet>') })
    await panel.getByTestId('local-coder-files').setInputFiles([
      { name: 'spec.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docx) },
      { name: 'data.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsx) },
      { name: 'requirements.pdf', mimeType: 'application/pdf', buffer: pdfFixture('PDF_REQUIREMENT add two numbers') },
      { name: 'source.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) },
      { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('LOCAL_NOTE Use Python 3') },
      { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('not text') },
    ])
    await expect(panel.getByText('source.zip/src/add.py', { exact: true })).toBeVisible()
    await expect(panel.getByText('This format cannot be read as text.', { exact: false })).toBeVisible()
    const folder = test.info().outputPath('folder-input')
    await mkdir(join(folder, 'src'), { recursive: true })
    await writeFile(join(folder, 'src', 'folder.ts'), '// FOLDER_SOURCE')
    await writeFile(join(folder, '.env'), 'NEVER_SEND_FOLDER_SECRET')
    await panel.getByTestId('local-coder-folder').setInputFiles(folder)
    await expect(panel.getByText('folder-input/src/folder.ts', { exact: true })).toBeVisible()
    await panel.getByText(/Context preview:/).click()
    await expect(panel.getByTestId('local-coder-context')).toContainText('PDF_REQUIREMENT')
    await expect(panel.getByTestId('local-coder-context')).toContainText('ZIP_SOURCE')
    await expect(panel.getByTestId('local-coder-context')).toContainText('WORD_REQUIREMENT')
    await expect(panel.getByTestId('local-coder-context')).toContainText('EXCEL_REQUIREMENT')
    await expect(panel.getByTestId('local-coder-context')).toContainText('FOLDER_SOURCE')
    await panel.getByRole('checkbox', { name: 'notes.md', exact: true }).uncheck()
    await expect(panel.getByTestId('local-coder-context')).not.toContainText('NEVER_SEND')
    await panel.getByRole('button', { name: 'Run locally', exact: true }).click()
    await expect(panel.getByTestId('local-coder-result')).toContainText('return a + b')
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0])).toContain('PDF_REQUIREMENT')
    expect(JSON.stringify(requests[0])).toContain('ZIP_SOURCE')
    expect(JSON.stringify(requests[0])).not.toContain('NEVER_SEND')
    expect(JSON.stringify(requests[0])).not.toContain('LOCAL_NOTE')
    expect(JSON.stringify(requests[0])).toContain('FOLDER_SOURCE')
    await reloadApp(page)
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
    await expect(card.getByRole('status')).toContainText('Saved · not checked')
    await card.getByRole('button', { name: 'Check (free)' }).click()
    await expect(card.getByRole('status')).toContainText('Connected')
    await card.getByRole('button', { name: 'Test coding' }).click()
    await panel.getByRole('button', { name: 'Forget connection' }).click()
    await expect(panel.getByRole('button', { name: 'Run locally' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    await expect(card.getByRole('status')).toContainText('Not set up')
    await wsEval(page, s => s.updateSettings({ language: 'de' }))
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height })
      for (const theme of ['light', 'dark']) {
        await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await card.scrollIntoViewIfNeeded()
        await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`local-card-${width}-${theme}.png`) })
        await card.getByRole('button', { name: 'Lokales Modell einrichten' }).click()
        await expect(panel.getByLabel('Lokale MCP-Adresse')).toBeVisible()
        await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`local-dialog-${width}-${theme}.png`) })
        await panel.getByTestId('local-coder-files').setInputFiles({ name: 'Aufgabe.md', mimeType: 'text/markdown', buffer: Buffer.from('Implementiere eine kleine Funktion. Prüfe das Ergebnis mit Tests.') })
        await panel.getByRole('group', { name: 'Dateien und Ordner' }).scrollIntoViewIfNeeded()
        await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`local-files-${width}-${theme}.png`) })
        await page.keyboard.press('Escape')
        await expect(panel).not.toBeVisible()
      }
    }
  } finally {
    await Promise.all([service, ollama].map(s => new Promise<void>(r => s.close(() => r()))))
  }
})
