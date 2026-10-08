/**
 * The workspace page (#/workspace, #/workspace/<section>): what belongs to the workspace, in one place —
 * a spec plate (mark, name, LOCAL / TEAM · n MEMBERS, pages · databases · storage) and eight sections:
 * Overview · Look · People · Building blocks · Automation · Integrations · Data · Danger zone. A rail on the left (a
 * strip of tabs on narrow screens). Settings (the modal) keeps this device and the account.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Settings } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { useLang, useT } from '../../i18n'
import { Led, shortcutLabel } from '../../ui/controls'
import { logoMarkSvg } from '@/shared/logo'
import { fmtBytes, fmtNumber } from '../lib/format'
import { useInCloud, useWorkspaceTitle, roleLabel } from '../cloud/state'
import { useTeam, type TeamData } from '../cloud/Team'
import { useStorageEstimate, type StorageEstimate } from '../settings/data'
import { isWorkspaceSection, WORKSPACE_SECTIONS, type WorkspaceSection } from './open'
import { useWorkspaceStats, useAutomationCount, useKitCount } from './stats'
import { Overview } from './Overview'
import { LookSection } from './Look'
import { PeopleSection } from './People'
import { BlocksSection } from './Blocks'
import { AutomationSection } from './Automation'
import { IntegrationsSection } from './Integrations'
import { DataSection } from './Data'
import { DangerSection } from './Danger'
import './workspace.css'

export function WorkspacePage({ section }: { section?: string }) {
  const t = useT()
  const active: WorkspaceSection = isWorkspaceSection(section) ? section : 'overview'
  const team = useTeam()
  const est = useStorageEstimate()
  const mainRef = useRef<HTMLElement>(null)

  // a new section starts at its top (the plate stays where it is when it is in view)
  useEffect(() => {
    const el = mainRef.current
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
  }, [active])

  return (
    <div className="wsp" data-testid="workspace-page" data-section={active}>
      <div className="wsp__inner">
        <Plate team={team} est={est} />
        <div className="wsp__body">
          <SectionNav active={active} team={team} />
          <section ref={mainRef} className="wsp__main" aria-labelledby="wsp-section-title" data-testid={`ws-section-${active}`}>
            {active === 'overview' && <Overview team={team} est={est} />}
            {active === 'look' && <LookSection team={team} />}
            {active === 'people' && <PeopleSection team={team} />}
            {active === 'blocks' && <BlocksSection />}
            {active === 'automation' && <AutomationSection team={team} />}
            {active === 'integrations' && <IntegrationsSection />}
            {active === 'data' && <DataSection />}
            {active === 'danger' && <DangerSection team={team} />}
          </section>
        </div>
        <p className="wsp__foot label">{t('shell.ws.foot')}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the plate */

function Plate({ team, est }: { team: TeamData; est: StorageEstimate | null }) {
  const t = useT()
  const lang = useLang()
  const name = useWorkspaceTitle()
  const inCloud = useInCloud()
  const { role, status } = useCloud(useShallow((s) => ({ role: s.role, status: s.status })))
  const stats = useWorkspaceStats()
  const kind = inCloud
    ? team.members
      ? t('shell.ws.plate.teamN', { n: team.members.length, members: t(team.members.length === 1 ? 'shell.ws.plate.member' : 'shell.ws.plate.members') })
      : t('shell.ws.plate.team')
    : t('shell.ws.plate.local')
  const spec = [
    t(stats.pages === 1 ? 'shell.ws.plate.page' : 'shell.ws.plate.pages', { n: fmtNumber(stats.pages, lang) }),
    t(stats.databases === 1 ? 'shell.ws.plate.database' : 'shell.ws.plate.databases', { n: fmtNumber(stats.databases, lang) }),
    est ? fmtBytes(est.usage, lang) : null,
  ].filter(Boolean)
  return (
    <header className="wsp-plate">
      <div className="wsp-plate__meta label">
        <span>§ {t('shell.ws.code')}</span>
        <span className="wsp-plate__rule" aria-hidden />
        <button type="button" className="btn btn--sm btn--ghost wsp-plate__device" onClick={() => useUI.getState().openModal({ type: 'settings' })} data-testid="ws-device-settings">
          <Settings size={13} aria-hidden />
          {t('shell.ws.deviceSettings')}
          <span className="kbd" aria-hidden>
            {shortcutLabel('Mod+,')}
          </span>
        </button>
      </div>
      <div className="wsp-plate__id">
        <span className="wsp-plate__mark" aria-hidden dangerouslySetInnerHTML={{ __html: logoMarkSvg(44) }} />
        <div className="wsp-plate__text">
          <h1 className="display wsp-plate__name" data-testid="ws-name">
            {name}
          </h1>
          <div className="wsp-plate__spec label" data-testid="ws-spec">
            <span className="wsp-plate__kind">
              <Led state={inCloud ? (status === 'online' ? 'ok' : status === 'connecting' || status === 'checking' ? 'on' : 'off') : 'ok'} />
              {kind}
              {inCloud && role ? ` · ${roleLabel(t, role).toUpperCase()}` : ''}
            </span>
            {spec.map((s) => (
              <span key={s} className="wsp-plate__item">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ section rail / strip */

function SectionNav({ active, team }: { active: WorkspaceSection; team: TeamData }) {
  const t = useT()
  const people = useWorkspace((s) => s.people.length)
  const inCloud = useInCloud()
  const automation = useAutomationCount()
  const kit = useKitCount()
  const integrations = useWorkspace((s) => s.integrations?.length ?? 0)
  const stripRef = useRef<HTMLUListElement>(null)
  const counts: Partial<Record<WorkspaceSection, number>> = useMemo(
    () => ({ people: inCloud && team.members ? Math.max(people, team.members.length) : people, blocks: kit, automation, integrations }),
    [people, inCloud, team.members, kit, automation, integrations],
  )

  // phones: the strip scrolls sideways — keep the active tab in view (the strip only)
  useEffect(() => {
    const strip = stripRef.current
    const el = strip?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!strip || !el || strip.scrollWidth <= strip.clientWidth) return
    const left = el.offsetLeft - strip.offsetLeft
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 12)
  }, [active])

  return (
    <nav className="wsp__nav" aria-label={t('shell.ws.nav')}>
      <ul ref={stripRef} className="wsp-tabs">
        {WORKSPACE_SECTIONS.map((id, i) => (
          <li key={id}>
            <a className="wsp-tab" href={id === 'overview' ? '#/workspace' : `#/workspace/${id}`} aria-current={active === id ? 'page' : undefined} data-section={id} data-danger={id === 'danger' || undefined}>
              <span className="wsp-tab__n">{String(i + 1).padStart(2, '0')}</span>
              <span className="wsp-tab__label">{t(`shell.ws.sec.${id}`)}</span>
              {counts[id] !== undefined && <span className="wsp-tab__count">{String(counts[id]).padStart(2, '0')}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
