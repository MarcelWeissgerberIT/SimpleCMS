import { BookOpen, LogIn, LogOut, Plus, UserPlus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { openInviteSettings, useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import type { MenuEntry } from '../../ui/Menu'
import { Led } from '../../ui/controls'
import { useT } from '../../i18n'
import { BRAND } from '@/shared/brand'
import { cloudApi } from './api'
import { Avatar } from './Avatar'
import { canAdmin, openCloudDialog, roleLabel } from './state'

export const SELF_HOSTING_URL = `${BRAND.repoUrl}/blob/main/docs/SELF_HOSTING.md`

/**
 * The workspace part of the sidebar-header menu: this browser's local workspace, every cloud
 * workspace (LED = the one on screen), "New team workspace…", and the account. Without a server
 * (GitHub Pages) an honest teaser points to the self-hosting guide instead.
 */
export function useWorkspaceEntries(): MenuEntry[] {
  const t = useT()
  const { available, user, workspaces, active, status, role } = useCloud(
    useShallow((s) => ({ available: s.available, user: s.user, workspaces: s.workspaces, active: s.active, status: s.status, role: s.role })),
  )
  const isLocal = active.kind === 'local'
  // the local workspace's name is known while it is open
  const localName = useWorkspace((x) => (isLocal ? x.settings.workspaceName.trim() : ''))
  const entries: MenuEntry[] = [
    { kind: 'section', label: t('shell.cloud.switcher.workspaces') },
    {
      id: 'ws-local',
      label: localName ? `${localName} · ${t('shell.cloud.switcher.local')}` : t('shell.cloud.switcher.local'),
      icon: <Led state={isLocal ? 'ok' : 'off'} />,
      checked: isLocal,
      onSelect: () => !isLocal && cloudApi.switchWorkspace({ kind: 'local', id: 'local' }),
    },
    ...workspaces.map(
      (w): MenuEntry => ({
        id: `ws-${w.id}`,
        label: w.name,
        icon: <Led state={active.id === w.id ? (status === 'online' ? 'ok' : 'on') : 'off'} />,
        hint: roleLabel(t, w.role).toUpperCase(),
        checked: active.id === w.id,
        keywords: 'team cloud',
        onSelect: () => active.id !== w.id && cloudApi.switchWorkspace({ kind: 'cloud', id: w.id }),
      }),
    ),
  ]

  if (!available) {
    entries.push(
      { kind: 'separator' },
      { kind: 'section', label: t('shell.cloud.switcher.teaser') },
      {
        id: 'cloud-selfhost',
        label: t('shell.cloud.switcher.selfHost'),
        icon: <BookOpen size={15} />,
        hint: `${t('shell.cloud.switcher.guide').toUpperCase()} ↗`,
        onSelect: () => window.open(SELF_HOSTING_URL, '_blank', 'noopener'),
      },
    )
    return entries
  }

  // the open team workspace's admins: straight to Workspace settings → People → Invite people
  if (user && active.kind === 'cloud' && canAdmin(role)) {
    entries.push({ id: 'cloud-invite', label: t('shell.cloud.inv.entry'), icon: <UserPlus size={15} />, keywords: 'invite link members einladen', onSelect: () => openInviteSettings() })
  }
  entries.push({
    id: 'cloud-new',
    label: t('shell.cloud.switcher.new'),
    icon: <Plus size={15} />,
    onSelect: () => openCloudDialog(user ? 'new-workspace' : 'sign-in'),
  })
  entries.push({ kind: 'separator' })
  if (user) {
    entries.push(
      {
        kind: 'custom',
        render: () => (
          <div className="cl-sw-acct">
            <Avatar name={user.name} email={user.email} id={user.id} size={24} />
            <span className="cl-sw-acct__text">
              <span className="cl-sw-acct__name">{user.name || user.email.split('@')[0]}</span>
              <span className="cl-sw-acct__mail">{user.email}</span>
            </span>
          </div>
        ),
      },
      {
        id: 'cloud-signout',
        label: t('shell.cloud.switcher.signOut'),
        icon: <LogOut size={15} />,
        // asks first: on a shared computer the team workspace copies should leave this browser too
        onSelect: () => openCloudDialog('sign-out'),
      },
    )
  } else {
    entries.push({ id: 'cloud-signin', label: t('shell.cloud.switcher.signIn'), icon: <LogIn size={15} />, onSelect: () => openCloudDialog('sign-in') })
  }
  return entries
}

/** Second line under the workspace name: "LOCAL WORKSPACE" or "● TEAM · ADMIN". */
export function HeaderSub() {
  const t = useT()
  const { kind, role, status } = useCloud(useShallow((s) => ({ kind: s.active.kind, role: s.role, status: s.status })))
  if (kind === 'local') return <>{t('shell.cloud.sub.local')}</>
  return (
    <>
      <Led state={status === 'online' ? 'ok' : status === 'connecting' || status === 'checking' ? 'on' : 'off'} />
      {t('shell.cloud.sub.team', { role: roleLabel(t, role) || '—' })}
    </>
  )
}
