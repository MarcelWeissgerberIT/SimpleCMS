/**
 * Full backups in the browser (e2e): Workspace settings → Data → Export workspace (whole workspace, full backup) and the
 * sidebar's Import (merge or replace).
 */
import { readFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { expect } from '../fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Workspace settings → Data → Export workspace → whole workspace, full backup → the parsed file. */
export async function exportBackup(page: Page, testInfo: TestInfo, name: string): Promise<{ file: string; json: AnyState }> {
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window.location.hash = '#/workspace/data'))
  const ws = page.getByTestId('workspace-page')
  await expect(ws).toHaveAttribute('data-section', 'data')
  await ws.getByRole('button', { name: 'Export workspace', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
  await dialog.getByRole('radio', { name: /Full backup/ }).click()
  const download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  const file = testInfo.outputPath(name)
  await (await download).saveAs(file)
  await page.keyboard.press('Escape')
  return { file, json: JSON.parse(readFileSync(file, 'utf8')) }
}

/**
 * The sidebar's Import → a backup file → merge or replace. `ai`: the backup's AI rules would loosen this workspace's —
 * the restore pauses on the loosening panel and takes this answer ('keep' = Keep mine, 'take' = Take the backup's).
 */
export async function importBackup(page: Page, file: string, mode: 'merge' | 'replace', ai?: 'keep' | 'take') {
  await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
  const dialog = page.getByRole('dialog')
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles([{ name: 'backup.json', mimeType: 'application/json', buffer: readFileSync(file) }])
  if (mode === 'replace') {
    await dialog.getByRole('radio', { name: /Replace workspace/ }).click()
    await dialog.getByRole('button', { name: 'Replace workspace' }).click()
    await dialog.getByRole('button', { name: 'Yes, replace everything' }).click()
  } else {
    await dialog.getByRole('radio', { name: /Merge into this workspace/ }).click()
    await dialog.getByRole('button', { name: 'Merge backup' }).click()
  }
  if (ai) {
    const panel = dialog.getByTestId('backup-ai-loosen')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: ai === 'keep' ? 'Keep mine' : 'Take the backup’s' }).click()
  }
  await expect(dialog.getByText(mode === 'replace' ? /Workspace restored/ : /Backup merged/).first()).toBeVisible()
  await page.keyboard.press('Escape')
}
