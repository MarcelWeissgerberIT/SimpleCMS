import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { migrations } from './migrations.ts'

export type Param = SQLInputValue

/** Thin wrapper: cached prepared statements, typed rows, transactions. */
export class Db {
  readonly raw: DatabaseSync
  private readonly cache = new Map<string, StatementSync>()

  constructor(file: string) {
    this.raw = new DatabaseSync(file)
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `)
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql)
    if (!s) {
      s = this.raw.prepare(sql)
      this.cache.set(sql, s)
    }
    return s
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...params) as T[]
  }

  run(sql: string, ...params: Param[]): number {
    return Number(this.stmt(sql).run(...params).changes)
  }

  /** Runs fn inside BEGIN IMMEDIATE … COMMIT; nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.raw.isTransaction) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (err) {
      this.raw.exec('ROLLBACK')
      throw err
    }
  }

  close(): void {
    this.cache.clear()
    if (this.raw.isOpen) this.raw.close()
  }
}

export function openDb(file: string): Db {
  const db = new Db(file)
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  db.raw.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
  const applied = new Set(db.all<{ version: number }>('SELECT version FROM migrations').map((r) => r.version))
  const latest = Math.max(0, ...migrations.map((m) => m.version))
  const newest = Math.max(0, ...applied)
  if (newest > latest) throw new Error(`database schema v${newest} is newer than this server (v${latest}); refusing to start — upgrade the server`)
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    db.tx(() => {
      db.raw.exec(m.sql)
      db.run('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)', m.version, m.name, Date.now())
    })
  }
}
