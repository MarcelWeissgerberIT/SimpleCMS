import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { atLeast, type Role, type Repo, type UserRow } from '../repo.ts'
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
  test_access?: number
}

export interface TestAccess {
  session_id: string
  source_session_id: string
  actor_id: string
  source_workspace_id: string
  workspace_id: string
  target_user_id: string | null
  target_name: string
  target_email: string
  target_role: Role
  guest: number
  expires_at: number
}

export interface Auth {
  testAccess?: TestAccess
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
    const testAccess = this.testAccess(session.id)
    if ((session.test_access && !testAccess) || (testAccess && !this.validTest(testAccess))) return null
    return { session, user: testAccess
      ? { id: `test_${session.id}`, email: testAccess.target_email, name: `${testAccess.target_name} (Test)`, created_at: session.created_at, last_seen_at: null }
      : { id: row.user_id, email: u_email, name: u_name, created_at: u_created_at, last_seen_at: u_last_seen_at }, ...(testAccess ? { testAccess } : {}) }
  }

  isValid(sessionId: string): boolean {
    const session = this.repo.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', sessionId, Date.now())
    if (!session) return false
    const t = this.testAccess(sessionId)
    return session.test_access ? !!t && this.validTest(t) : !t
  }

  testAccess(sessionId: string): TestAccess | undefined {
    return this.repo.db.get<TestAccess>('SELECT * FROM test_access_sessions WHERE session_id = ?', sessionId)
  }

  private validTest(t: TestAccess): boolean {
    if (t.expires_at <= Date.now()) return false
    const source = this.repo.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', t.source_session_id, Date.now())
    if (!source || source.user_id !== t.actor_id || this.testAccess(source.id)) return false
    for (const id of [t.workspace_id, t.source_workspace_id]) {
      const role = this.repo.memberRole(id, t.actor_id)
      if (!role || !atLeast(role, 'admin') || this.repo.workspaceById(id)?.personal_of) return false
    }
    if (t.target_user_id) {
      const m = this.repo.members(t.workspace_id).find(m => m.id === t.target_user_id)
      if (!m || m.role !== t.target_role || m.guest !== t.guest) return false
    }
    return true
  }

  role(auth: Auth, workspaceId: string): Role | undefined {
    return auth.testAccess ? (auth.testAccess.workspace_id === workspaceId && this.validTest(auth.testAccess) ? 'viewer' : undefined) : this.repo.memberRole(workspaceId, auth.user.id)
  }

  roleForSession(sessionId: string, workspaceId: string): Role | undefined {
    if (!this.isValid(sessionId)) return undefined
    const t = this.testAccess(sessionId)
    if (t) return t.workspace_id === workspaceId ? 'viewer' : undefined
    const s = this.repo.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', sessionId)
    return s ? this.repo.memberRole(workspaceId, s.user_id) : undefined
  }

  /** Slides the expiry forward (at most once per REFRESH_EVERY). Returns true when the cookie should be re-sent. */
  touch(session: SessionRow): boolean {
    const now = Date.now()
    if (this.testAccess(session.id)) return false
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

