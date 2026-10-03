/** Account, workspaces, members and invites — the REST side of the public API, keeping useCloud current. */
import { useWorkspace } from '../store/store'
import {
  delInvite,
  delMember,
  delWorkspace,
  getInvitePreview,
  getInvites,
  getMembers,
  patchMember,
  patchWorkspace,
  postAcceptInvite,
  postInvite,
  postLogout,
  postSignIn,
  postWorkspace,
} from './api'
import { refreshMe, SIGNED_IN_PARAM, switchWorkspaceImpl } from './boot'
import { writeSession } from './env'
import { useCloud, type CloudWorkspace, type Invite, type InvitePreview, type Member, type Role } from './state'
import { activeCloud, renameActive, setNameEverywhere, updateProfileImpl } from './workspace'

const lang = () => useWorkspace.getState().settings.language

/** Where the magic link brings the person back: this very view (an invite link keeps its hash). */
function returnPath(): string {
  try {
    // (keeps ?w=<id>: back into the workspace that asked for the sign-in)
    const url = new URL(window.location.href)
    url.searchParams.set(SIGNED_IN_PARAM, '1')
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/app/'
  }
}

export async function requestSignInImpl(email: string, opts?: { invite?: string; lang?: string }): Promise<void> {
  await postSignIn({ email: email.trim(), redirect: returnPath(), lang: opts?.lang ?? lang(), ...(opts?.invite ? { invite: opts.invite } : {}) })
}

export async function signOutImpl(): Promise<void> {
  try {
    await postLogout()
  } finally {
    writeSession(null)
  }
  if (useCloud.getState().active.kind === 'cloud') {
    // the cloud workspace can't sync without a session: back to this browser's own workspace
    switchWorkspaceImpl({ kind: 'local', id: 'local' })
    return
  }
  useCloud.setState({ user: null, workspaces: [] })
}

export async function createWorkspaceImpl(name: string): Promise<CloudWorkspace> {
  const ws = await postWorkspace(name.trim())
  useCloud.setState((s) => ({ workspaces: [...s.workspaces.filter((w) => w.id !== ws.id), ws] }))
  void refreshMe()
  return ws
}

export async function renameWorkspaceImpl(id: string, name: string): Promise<void> {
  if (activeCloud()?.ws.id === id) return renameActive(name.trim())
  const ws = await patchWorkspace(id, { name: name.trim() })
  setNameEverywhere(id, ws.name)
}

export async function deleteWorkspaceImpl(id: string): Promise<void> {
  await delWorkspace(id)
  useCloud.setState((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) }))
  void refreshMe()
  if (useCloud.getState().active.kind === 'cloud' && useCloud.getState().active.id === id) switchWorkspaceImpl({ kind: 'local', id: 'local' })
}

export function listMembersImpl(wsId: string): Promise<Member[]> {
  return getMembers(wsId)
}

export async function setMemberRoleImpl(wsId: string, userId: string, role: Role): Promise<void> {
  await patchMember(wsId, userId, role)
  // an ownership transfer (or a change of one's own role) changes what this person may do
  if (role === 'owner' || userId === useCloud.getState().user?.id) {
    const me = await refreshMe()
    const ws = me?.workspaces.find((w) => w.id === wsId)
    const c = useCloud.getState()
    if (ws && c.active.kind === 'cloud' && c.active.id === wsId) useCloud.setState({ role: ws.role, readOnly: ws.role === 'viewer' })
  }
}

export async function removeMemberImpl(wsId: string, userId: string): Promise<void> {
  await delMember(wsId, userId)
  const c = useCloud.getState()
  if (userId !== c.user?.id) return
  // left the workspace
  useCloud.setState((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== wsId) }))
  if (c.active.kind === 'cloud' && c.active.id === wsId) switchWorkspaceImpl({ kind: 'local', id: 'local' })
}

export function createInviteImpl(wsId: string, role: Role, email?: string): Promise<Invite> {
  return postInvite(wsId, role, email?.trim() || undefined, lang())
}

export function listInvitesImpl(wsId: string): Promise<Invite[]> {
  return getInvites(wsId)
}

export function revokeInviteImpl(wsId: string, inviteId: string): Promise<void> {
  return delInvite(wsId, inviteId)
}

export function previewInviteImpl(token: string): Promise<InvitePreview> {
  return getInvitePreview(token)
}

export async function acceptInviteImpl(token: string): Promise<{ workspaceId: string; role?: Role }> {
  const r = await postAcceptInvite(token)
  await refreshMe()
  return r
}

export const updateProfile = updateProfileImpl
