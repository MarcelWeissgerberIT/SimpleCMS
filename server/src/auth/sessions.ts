import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Repo, UserRow } from '../repo.ts'
import { DAY, newId, randomToken } from '../tokens.ts'

export const SESSION_COOKIE = 'one_session'
export const SESSION_TTL = 30 * DAY
/** Sliding expiry is written at most this often per session (and re-sent as a cookie). */
const REFRESH_EVERY = DAY

export interface SessionRow {
  id: string
  token_hash: string
  user_id: string
  created_at: number
  expires_at: number
  user_agent: string | null
  last_used_at: number
}

export interface Auth {
  session: SessionRow
  user: UserRow
}

export class Sessions {
  private readonly repo: Repo
  readonly secure: boolean

  constructor(repo: Repo, secure: boolean) {
    this.repo = repo
    this.secure = secure
  }

  create(userId: string, userAgent: string | null): { token: string; session: SessionRow } {
    const token = randomToken()
    const now = Date.now()
    const session: SessionRow = {
      id: newId(),
      token_hash: this.repo.hash(token),
      user_id: userId,
      created_at: now,
      expires_at: now + SESSION_TTL,
      user_agent: userAgent?.slice(0, 300) ?? null,
      last_used_at: now,
    }
    this.repo.db.run(
      'INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, user_agent, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      session.id, session.token_hash, session.user_id, session.created_at, session.expires_at, session.user_agent, session.last_used_at,
    )
    this.repo.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', now, userId)
    return { token, session }
  }

  resolve(token: string | undefined | null): Auth | null {
    if (!token || token.length > 100) return null
    const row = this.repo.db.get<SessionRow & { u_email: string; u_name: string | null; u_created_at: number; u_last_seen_at: number | null }>(
      `SELECT s.*, u.email AS u_email, u.name AS u_name, u.created_at AS u_created_at, u.last_seen_at AS u_last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
      this.repo.hash(token),
      Date.now(),
    )
    if (!row) return null
    const { u_email, u_name, u_created_at, u_last_seen_at, ...session } = row
    return { session, user: { id: row.user_id, email: u_email, name: u_name, created_at: u_created_at, last_seen_at: u_last_seen_at } }
  }

  isValid(sessionId: string): boolean {
    return !!this.repo.db.get('SELECT 1 FROM sessions WHERE id = ? AND expires_at > ?', sessionId, Date.now())
  }

  /** Slides the expiry forward (at most once per REFRESH_EVERY). Returns true when the cookie should be re-sent. */
  touch(session: SessionRow): boolean {
    const now = Date.now()
    if (now - session.last_used_at < REFRESH_EVERY) return false
    session.last_used_at = now
    session.expires_at = now + SESSION_TTL
    this.repo.db.run('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?', now, session.expires_at, session.id)
    this.repo.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', now, session.user_id)
    return true
  }

  revoke(sessionId: string) {
    this.repo.db.run('DELETE FROM sessions WHERE id = ?', sessionId)
  }

  revokeAllForUser(userId: string): number {
    return this.repo.db.run('DELETE FROM sessions WHERE user_id = ?', userId)
  }

  readCookie(c: Context): string | undefined {
    return getCookie(c, SESSION_COOKIE)
  }

  setCookie(c: Context, token: string) {
    setCookie(c, SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: this.secure,
      maxAge: Math.floor(SESSION_TTL / 1000),
    })
  }

  clearCookie(c: Context) {
    deleteCookie(c, SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'Lax', secure: this.secure })
  }
}

/** Minimal Cookie header parser for the WebSocket upgrade (no Hono context there). */
export function cookieFromHeader(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim()
      try {
        return decodeURIComponent(v)
      } catch {
        return v
      }
    }
  }
  return undefined
}

