type Level = 'debug' | 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

export interface Logger {
  debug(msg: string, fields?: Fields): void
  info(msg: string, fields?: Fields): void
  warn(msg: string, fields?: Fields): void
  error(msg: string, fields?: Fields): void
}

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/** One line per event: `2026-10-03T10:00:00.000Z INFO  message key=value …` — readable in `docker logs`. */
export function createLogger(min: Level = (process.env.LOG_LEVEL as Level) || 'info'): Logger {
  const write = (level: Level, msg: string, fields?: Fields) => {
    if (RANK[level] < (RANK[min] ?? 1)) return
    const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), msg]
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (v === undefined) continue
      const s = v instanceof Error ? v.stack ?? v.message : typeof v === 'string' ? v : JSON.stringify(v)
      parts.push(`${k}=${/\s/.test(s) && !(v instanceof Error) ? JSON.stringify(s) : s}`)
    }
    ;(level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(parts.join(' ') + '\n')
  }
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  }
}
