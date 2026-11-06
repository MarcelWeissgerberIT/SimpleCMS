/** Read-only access tests. Never authenticate as a real participant or expose their private resources. */
import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import type { TestAccess } from '../auth/sessions.ts'
import { forbidden, notFound } from '../errors.ts'
import { body } from '../http/util.ts'
import { atLeast, type Role } from '../repo.ts'
import { WelcomeStore } from '../welcome/store.ts'
import { access } from './access.ts'

const RETURN_COOKIE = 'one_test_return'
const RETURN_PATH = '/api/auth/test-access'
export const TEST_ACCESS_TTL = 20 * 60_000
interface Target { id: string; name: string; email: string; workspaceId: string; workspaceName: string; role: Role; guest: boolean; prepared: boolean; userId: string | null }

function targets(s: Services, workspaceId: string, actorId: string): Target[] {
  const ws = s.repo.workspaceById(workspaceId)!
  const list: Target[] = s.repo.members(workspaceId).filter(m => m.id !== actorId).map(m => ({ id: `member:${m.id}`, name: m.name || m.email, email: m.email, workspaceId, workspaceName: ws.name, role: m.role, guest: !!m.guest, prepared: false, userId: m.id }))
  for (const r of new WelcomeStore(s).read(workspaceId, actorId)?.recipients ?? []) {
    const w = s.repo.workspaceById(r.workspaceId), role = s.repo.memberRole(r.workspaceId, actorId)
    if (!w || w.personal_of || !role || !atLeast(role, 'admin')) continue
    const member = s.repo.members(r.workspaceId).find(m => m.email === r.email)
    if (list.some(t => t.email === r.email && t.workspaceId === r.workspaceId)) continue
    list.push({ id: `welcome:${r.id}`, name: r.name || r.email, email: r.email, workspaceId: w.id, workspaceName: w.name, role: member?.role ?? r.role, guest: member ? !!member.guest : r.guest, prepared: !member, userId: member?.id ?? null })
  }
  return list
}

/** Fail closed, including bearer API routes: a test cookie cannot perform any action. */
export function guardTestAccess(c: Context<AppEnv>, t: TestAccess): Response | undefined {
  const p = c.req.path
  if (c.req.method === 'POST' && p === '/api/auth/test-access/stop') return
  if (c.req.method !== 'GET') throw forbidden('test_access_readonly', 'Test access is read-only. Return to your account to make changes.')
  if (['/api/health', '/api/config', '/api/session', '/api/me', '/api/auth/test-access'].includes(p)) return
  const prefix = `/api/workspaces/${t.workspace_id}/`
  if (p === `${prefix}welcome-access`) return c.json([])
  if (p === `${prefix}members` || (p.startsWith(`${prefix}files/`) && p.slice(`${prefix}files/`.length).indexOf('/') === -1)) return
  throw forbidden('test_access_readonly', 'This resource is unavailable in test access.')
}

export function testAccessRoutes(s: Services) {
  const app = new Hono<AppEnv>()
  const cookieOptions = { path: RETURN_PATH, httpOnly: true, sameSite: 'Strict' as const, secure: s.sessions.secure }
  const source = (c: Context<AppEnv>) => {
    const a = s.sessions.resolve(getCookie(c, RETURN_COOKIE))
    return a && !a.testAccess ? a : null
  }
  app.get('/auth/test-access', c => {
    const actor = source(c)
    const t = c.get('auth')?.testAccess
    return c.json({ active: !!t, canReturn: !!actor, actorName: actor?.user.name || actor?.user.email || null, ...(t ? { name: t.target_name, guest: !!t.guest, role: t.target_role, workspaceId: t.workspace_id, expiresAt: t.expires_at } : {}) })
  })
  app.get('/workspaces/:id/test-access/targets', c => {
    const { auth, workspace } = access(s, c, 'admin')
    if (workspace.personal_of || auth.testAccess) throw forbidden('test_access_unavailable', 'Choose a shared workspace.')
    return c.json(targets(s, workspace.id, auth.user.id).map(({userId, ...t}) => t))
  })
  app.post('/workspaces/:id/test-access', async c => {
    const { auth, workspace } = access(s, c, 'admin')
    if (workspace.personal_of || auth.testAccess) throw forbidden('test_access_unavailable', 'Choose a shared workspace.')
    const input = await body(c, z.object({ target: z.string().min(1).max(150) }).strict())
    const target = targets(s, workspace.id, auth.user.id).find(t => t.id === input.target)
    if (!target) throw notFound('target_not_found', 'Test target not found')
    const previous = source(c)
    if (previous) throw forbidden('test_access_active', 'Return to your account before starting another test.')
    const { token, session } = s.sessions.create(auth.user.id, c.req.header('user-agent') ?? null)
    const expires = Math.min(auth.session.expires_at, Date.now() + TEST_ACCESS_TTL)
    s.db.tx(() => {
      s.db.run('UPDATE sessions SET expires_at = ?, test_access = 1 WHERE id = ?', expires, session.id)
      s.db.run('INSERT INTO test_access_sessions(session_id,source_session_id,actor_id,source_workspace_id,workspace_id,target_user_id,target_name,target_email,target_role,guest,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', session.id, auth.session.id, auth.user.id, workspace.id, target.workspaceId, target.userId, target.name, target.email, target.role, Number(target.guest), expires)
    })
    setCookie(c, RETURN_COOKIE, s.sessions.readCookie(c)!, { ...cookieOptions, maxAge: Math.max(1, Math.floor((auth.session.expires_at - Date.now()) / 1000)) })
    s.sessions.setCookie(c, token)
    s.collab.closeSession(auth.session.id, 'role-changed')
    s.coding.closeSession(auth.session.id, 'role-changed')
    s.log.info('test access started', { actor: auth.user.id, session: session.id, workspace: target.workspaceId })
    return c.json({ workspaceId: target.workspaceId, expiresAt: expires })
  })
  app.post('/auth/test-access/stop', c => {
    const actor = source(c)
    if (!actor) throw forbidden('test_access_return_expired', 'Your original session expired. Sign in again.')
    const current = c.get('auth')
    const t = current?.testAccess
    // An expired test cookie may already have been cleared; source-session binding still identifies its tests.
    const tests = s.db.all<{session_id:string; source_workspace_id:string}>('SELECT session_id,source_workspace_id FROM test_access_sessions WHERE source_session_id = ?', actor.session.id)
    if (t && t.source_session_id !== actor.session.id) throw forbidden('test_access_mismatch', 'The return session does not match.')
    const ws = t?.source_workspace_id ?? tests[0]?.source_workspace_id
    for (const row of tests) {
      s.collab.closeSession(row.session_id, 'role-changed')
      s.coding.closeSession(row.session_id, 'role-changed')
      s.sessions.revoke(row.session_id)
    }
    s.sessions.setCookie(c, getCookie(c, RETURN_COOKIE)!)
    deleteCookie(c, RETURN_COOKIE, cookieOptions)
    s.log.info('test access ended', { actor: actor.user.id, workspace: ws ?? null })
    return c.json({ workspaceId: ws ?? null })
  })
  return app
}
