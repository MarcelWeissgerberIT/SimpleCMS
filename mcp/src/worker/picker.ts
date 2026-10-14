/**
 * one-worker — the setup page's "Choose a folder…" key: a browser never tells a page the real path of a folder the
 * person picks, so the worker opens this computer's own folder dialog instead — macOS `osascript` (choose folder),
 * Windows PowerShell (FolderBrowserDialog, by its path in System32, in front of the browser, the path as UTF-8),
 * Linux `zenity`. Always a program with a FIXED argument list: nothing the page sends goes into it; the page only asks
 * for the dialog, the picked path goes through the same checks as a typed one (setup.ts `add`). ONE_WORKER_PICKER: a
 * program to use instead (prints the folder on stdout; looked up like the person's own commands, exec.ts) · "none":
 * no dialog (the page says so and the folder can still be typed).
 */
import { execFileSafe, systemTool, type Allow } from './exec.ts'

export interface PickCommand {
  cmd: string
  args: string[]
  /** the built-in dialogs are programs; ONE_WORKER_PICKER is the person's own command */
  allow?: Allow
}

export type PickResult = { path: string } | { cancelled: true } | { none: true }

const PROMPT = 'One worker — pick the folder of a git repository'

/** The folder dialog of this computer (null: none — headless, or switched off). */
export function pickerCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): PickCommand | null {
  const custom = (env.ONE_WORKER_PICKER ?? '').trim()
  if (custom === 'none') return null
  if (custom) return { cmd: custom, args: [], allow: 'person' }
  if (platform === 'darwin') {
    // `tell me to activate` brings the dialog in front of the browser
    return { cmd: 'osascript', args: ['-e', 'tell me to activate', '-e', `POSIX path of (choose folder with prompt "${PROMPT}" default location (path to documents folder))`] }
  }
  if (platform === 'win32') {
    // UTF-8 out (the console's code page would garble "Übung"); a TopMost owner puts the dialog in front of the browser
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$d.Description = '${PROMPT.replace('—', '-')}'`,
      "if ($d.ShowDialog($o) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
      '$o.Dispose()',
    ].join('; ')
    return { cmd: systemTool('powershell', env, platform), args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], allow: 'exe' }
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null
  return { cmd: 'zenity', args: ['--file-selection', '--directory', `--title=${PROMPT}`] }
}

/** Open the dialog and wait for the person (≤ 5 min). */
export async function pickFolder(env: NodeJS.ProcessEnv = process.env): Promise<PickResult> {
  const how = pickerCommand(env)
  if (!how) return { none: true }
  const r = await execFileSafe(how.cmd, how.args, { timeoutMs: 5 * 60_000, maxBuffer: 64 * 1024, windowsHide: false, allow: how.allow ?? 'exe' })
  // osascript ends a folder's POSIX path with "/"
  const out = r.stdout.trim()
  const path = out.length > 1 ? out.replace(/[\\/]+$/, '') : out
  if (path && !r.timedOut) return { path }
  // no such program (or one the worker does not start): no dialog here
  if (r.why) return { none: true }
  return { cancelled: true }
}
