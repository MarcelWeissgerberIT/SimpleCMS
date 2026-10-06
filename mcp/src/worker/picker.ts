/**
 * one-worker — the setup page's "Choose a folder…" key: a browser never tells a page the real path of a folder the
 * person picks, so the worker opens this computer's own folder dialog instead — macOS `osascript` (choose folder),
 * Windows PowerShell (FolderBrowserDialog), Linux `zenity`. Always a program with a FIXED argument list: nothing
 * the page sends goes into it; the page only asks for the dialog, the picked path goes through the same checks as a
 * typed one (setup.ts `add`). ONE_WORKER_PICKER: a program to use instead (prints the folder on stdout) · "none":
 * no dialog (the page says so and the folder can still be typed).
 */
import { execFile } from 'node:child_process'

export interface PickCommand {
  cmd: string
  args: string[]
}

export type PickResult = { path: string } | { cancelled: true } | { none: true }

const PROMPT = 'One worker — pick the folder of a git repository'

/** The folder dialog of this computer (null: none — headless, or switched off). */
export function pickerCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): PickCommand | null {
  const custom = (env.ONE_WORKER_PICKER ?? '').trim()
  if (custom === 'none') return null
  if (custom) return { cmd: custom, args: [] }
  if (platform === 'darwin') {
    // `tell me to activate` brings the dialog in front of the browser
    return { cmd: 'osascript', args: ['-e', 'tell me to activate', '-e', `POSIX path of (choose folder with prompt "${PROMPT}" default location (path to documents folder))`] }
  }
  if (platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${PROMPT.replace('—', '-')}'; if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`
    return { cmd: 'powershell', args: ['-NoProfile', '-STA', '-Command', script] }
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null
  return { cmd: 'zenity', args: ['--file-selection', '--directory', `--title=${PROMPT}`] }
}

/** Open the dialog and wait for the person (≤ 5 min). */
export function pickFolder(env: NodeJS.ProcessEnv = process.env): Promise<PickResult> {
  const how = pickerCommand(env)
  if (!how) return Promise.resolve({ none: true })
  return new Promise((resolve) => {
    execFile(how.cmd, how.args, { timeout: 5 * 60_000, maxBuffer: 64 * 1024, windowsHide: false }, (err, stdout) => {
      // osascript ends a folder's POSIX path with "/"
      const out = String(stdout ?? '').trim()
      const path = out.length > 1 ? out.replace(/[\\/]+$/, '') : out
      if (path) return resolve({ path })
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return resolve({ none: true })
      resolve({ cancelled: true })
    })
  })
}
