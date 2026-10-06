/**
 * Workspace page § 02 — People. Local workspace: every person of the workspace with their colour, where they
 * are used (click → the rows and pages), add, rename, recolour, merge two people, remove someone nobody uses;
 * "You" marks the local user. Team workspace: the members with their roles and the invites (admins), then
 * the people without an account here — with the same tools for everyone who may write. Viewers read.
 */
import { useId, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, ChevronDown, MoreHorizontal, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import { COLOR_NAMES, type ColorName, type ID, type Person } from '../../store/types'
import { useCloud } from '../../cloud'
import { localPerson } from '../../database'
import { navigate } from '../../lib/router'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useLang, useT } from '../../i18n'
import type { Lang, Translate } from '@/shared/i18n'
import { fmtNumber } from '../lib/format'
import { toggleMenu } from '../lib/menu'
import { goToPage } from '../lib/actions'
import { useInCloud, useReadOnly } from '../cloud/state'
import { TeamInvites, TeamMembers, type TeamData } from '../cloud/Team'
import { addPerson, checkPersonName, mergePeople, mergeTargets, peopleUsage, recolourPerson, removeUnusedPerson, renamePerson, usedCount, PERSON_NAME_MAX, type NameCheck, type PersonUse, type UseRef } from './people'
import { PersonAvatar, SectionHead, SubHead } from './parts'

const LIST_MAX = 60

function usePeopleUsage(): Map<ID, PersonUse> {
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  return useMemo(() => peopleUsage(pages, databases), [pages, databases])
}

/** The person id of "you": the signed-in member (team) or the local user's own person. */
function useYou(): ID | null {
  const t = useT()
  const { team, userId } = useCloud(useShallow((c) => ({ team: c.active.kind === 'cloud', userId: c.user?.id ?? null })))
  const people = useWorkspace((s) => s.people)
  const name = useWorkspace((s) => s.settings.userName)
  if (team) return userId
  return localPerson({ me: { id: null, name }, people, labels: { you: t('database.actor.you') } })?.id ?? null
}

const nameError = (t: Translate, p: NameCheck) => t(`shell.ws.people.err.${p}`)

export function PeopleSection({ team }: { team: TeamData }) {
  const t = useT()
  const inCloud = useInCloud()
  const readOnly = useReadOnly()
  const people = useWorkspace((s) => s.people)
  const usage = usePeopleUsage()
  const you = useYou()

  if (inCloud) {
    const memberIds = new Set((team.members ?? []).map((m) => m.user.id))
    const others = team.members ? people.filter((p) => !memberIds.has(p.id)) : []
    return (
      <>
        <SectionHead n="02" title={t('shell.ws.sec.people')} lead={t('shell.ws.people.leadTeam')} help="members-roles" />
        <SubHead label={t('shell.cloud.team.members')} count={team.members?.length} />
        <TeamMembers team={team} onLeft={() => navigate({ name: 'home' })} aside={(id) => <MemberUse use={usage.get(id)} name={people.find((p) => p.id === id)?.name ?? ''} />} />
        <SubHead label={t('shell.cloud.team.invites')} count={team.admin ? team.invites.length : undefined} />
        <TeamInvites team={team} />
        <SubHead label={t('shell.ws.people.others')} count={team.members ? others.length : undefined} />
        <p className="wsp-note">{t('shell.ws.people.othersBody')}</p>
        {!readOnly && <AddPerson />}
        {team.members && <PeopleList people={others} all={people} usage={usage} you={you} editable={!readOnly} empty={t('shell.ws.people.othersEmpty')} />}
      </>
    )
  }

  return (
    <>
      <SectionHead n="02" title={t('shell.ws.sec.people')} lead={t('shell.ws.people.lead')} help="workspace" />
      {!readOnly && <AddPerson />}
      <SubHead label={t('shell.ws.people.everyone')} count={people.length} />
      <PeopleList people={people} all={people} usage={usage} you={you} editable={!readOnly} empty={t('shell.ws.people.empty')} />
    </>
  )
}

/* ------------------------------------------------------------------ add */

function AddPerson() {
  const t = useT()
  const id = useId()
  const [name, setName] = useState('')
  const [error, setError] = useState<NameCheck | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = addPerson(name)
    if (r === 'empty' || r === 'long' || r === 'taken') return setError(r)
    setName('')
    setError(null)
  }
  return (
    <form className="wsp-add" onSubmit={submit} data-testid="ws-add-person">
      <label className="label wsp-add__label" htmlFor={id}>
        {t('shell.ws.people.addLabel')}
      </label>
      <div className="wsp-add__row">
        <input
          id={id}
          className="input"
          value={name}
          maxLength={PERSON_NAME_MAX}
          placeholder={t('shell.ws.people.addPh')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setName(e.target.value)
            if (error) setError(null)
          }}
        />
        <button type="submit" className="btn">
          <Plus size={14} aria-hidden />
          {t('shell.ws.people.add')}
        </button>
      </div>
      {error && (
        <p className="cl-err" id={`${id}-err`} role="alert">
          <AlertTriangle size={13} aria-hidden />
          {nameError(t, error)}
        </p>
      )}
    </form>
  )
}

/* ------------------------------------------------------------------ the list */

function PeopleList({ people, all, usage, you, editable, empty }: { people: Person[]; all: Person[]; usage: Map<ID, PersonUse>; you: ID | null; editable: boolean; empty: string }) {
  const t = useT()
  if (!people.length) return <p className="tm-empty">{empty}</p>
  return (
    <ul className="tm-list wsp-people" aria-label={t('shell.ws.sec.people')}>
      {people.map((p) => (
        <PersonRow key={p.id} person={p} all={all} use={usage.get(p.id)} you={p.id === you} editable={editable} />
      ))}
    </ul>
  )
}

function PersonRow({ person, all, use, you, editable }: { person: Person; all: Person[]; use: PersonUse | undefined; you: boolean; editable: boolean }) {
  const t = useT()
  const lang = useLang()
  const menu = useMenu()
  const [renaming, setRenaming] = useState(false)
  const [merging, setMerging] = useState<ID | null>(null)
  const [open, setOpen] = useState(false)
  const listId = useId()
  const used = usedCount(use)
  const targets = mergeTargets(all, person.id)
  const into = merging ? all.find((p) => p.id === merging) : undefined

  const entries: MenuEntry[] = [
    { id: 'rename', label: t('shell.ws.people.rename'), onSelect: () => setRenaming(true) },
    {
      id: 'colour',
      label: t('shell.ws.people.colour'),
      submenu: COLOR_NAMES.filter((c) => c !== 'default').map((c: ColorName) => ({
        id: `colour-${c}`,
        label: t(`color.${c}`),
        checked: person.color === c,
        icon: <span className="wsp-swatch" style={{ background: `var(--c-${c}-bg)`, color: `var(--c-${c}-text)` }} aria-hidden />,
        onSelect: () => recolourPerson(person.id, c),
      })),
    },
    {
      id: 'merge',
      label: t('shell.ws.people.mergeInto'),
      disabled: !targets.length,
      submenu: targets.map((p) => ({ id: `merge-${p.id}`, label: p.name, onSelect: () => setMerging(p.id) })),
    },
    { kind: 'separator' },
    used
      ? { id: 'remove', label: t('shell.ws.people.remove'), disabled: true, hint: t('shell.ws.people.inUse').toUpperCase() }
      : { id: 'remove', label: t('shell.ws.people.remove'), danger: true, onSelect: () => removeUnusedPerson(person.id) },
  ]

  return (
    <li className="tm-row wsp-person" data-testid="ws-person" data-person={person.name}>
      <PersonAvatar person={person} size={28} />
      <div className="tm-row__who">
        {renaming ? (
          <RenameField person={person} onDone={() => setRenaming(false)} />
        ) : (
          <span className="tm-row__name">
            <span>{person.name}</span>
            {you && <span className="tm-you">{t('shell.cloud.team.youTag')}</span>}
          </span>
        )}
        <UseLine use={use} name={person.name} open={open} onToggle={() => setOpen((o) => !o)} listId={listId} />
      </div>
      <div className="tm-row__ctl">
        {editable && !renaming && (
          <>
            <button type="button" className="icon-btn" aria-label={t('shell.ws.people.actionsFor', { name: person.name })} aria-haspopup="menu" aria-expanded={menu.open} onClick={toggleMenu(menu)}>
              <MoreHorizontal size={16} />
            </button>
            <Menu {...menu.props} entries={entries} width={232} />
          </>
        )}
      </div>
      {open && use && <UsedIn id={listId} use={use} />}
      {into && (
        <div className="tm-confirm" data-tone="signal" role="group" aria-label={t('shell.ws.people.mergeTitle', { from: person.name, into: into.name })}>
          <p className="tm-confirm__q">
            <strong>{t('shell.ws.people.mergeTitle', { from: person.name, into: into.name })}</strong> {used ? t('shell.ws.people.mergeBody', { from: person.name, into: into.name, what: useText(t, lang, use) }) : t('shell.ws.people.mergeBodyUnused', { from: person.name })}
          </p>
          <div className="tm-confirm__actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMerging(null)} autoFocus>
              {t('shell.cloud.team.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ink"
              onClick={() => {
                setMerging(null)
                void mergePeople(person.id, into.id)
              }}
            >
              {t('shell.ws.people.mergeDo')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function RenameField({ person, onDone }: { person: Person; onDone: () => void }) {
  const t = useT()
  const id = useId()
  const [v, setV] = useState(person.name)
  const [error, setError] = useState<NameCheck | null>(null)
  const commit = () => {
    if (v.trim() === person.name) return onDone()
    const problem = checkPersonName(v, person.id)
    if (problem) return setError(problem)
    renamePerson(person.id, v)
    onDone()
  }
  return (
    <span className="wsp-rename">
      <input
        id={id}
        className="input"
        value={v}
        autoFocus
        maxLength={PERSON_NAME_MAX}
        aria-label={t('shell.ws.people.renameLabel', { name: person.name })}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          setV(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onDone()
          }
        }}
        onBlur={() => (checkPersonName(v, person.id) && v.trim() !== person.name ? onDone() : commit())}
      />
      {error && (
        <span className="cl-err wsp-rename__err" id={`${id}-err`} role="alert">
          <AlertTriangle size={13} aria-hidden />
          {nameError(t, error)}
        </span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ where they are used */

/** "12 rows · 3 mentions" (+ "5 created or edited" in a team workspace). */
function useParts(t: Translate, lang: Lang, use: PersonUse | undefined, team = false): string[] {
  return [
    use?.rows.length ? t(use.rows.length === 1 ? 'shell.ws.people.row' : 'shell.ws.people.rows', { n: fmtNumber(use.rows.length, lang) }) : null,
    use?.mentions.length ? t(use.mentions.length === 1 ? 'shell.ws.people.mention' : 'shell.ws.people.mentions', { n: fmtNumber(use.mentions.length, lang) }) : null,
    team && use?.authored ? t('shell.ws.people.authored', { n: fmtNumber(use.authored, lang) }) : null,
  ].filter((x): x is string => !!x)
}

const useText = (t: Translate, lang: Lang, use: PersonUse | undefined) => useParts(t, lang, use).join(' · ')

/** "12 ROWS · 3 MENTIONS ▾" — opens the list of rows and pages; "NOT USED" when nobody points at them. */
function UseLine({ use, name, team, open, onToggle, listId }: { use: PersonUse | undefined; name: string; team?: boolean; open: boolean; onToggle: () => void; listId: string }) {
  const t = useT()
  const lang = useLang()
  const n = usedCount(use)
  const parts = useParts(t, lang, use, team)
  if (!n)
    return (
      <span className="wsp-use" data-testid="ws-use" data-used="0">
        {parts.length ? parts.join(' · ') : t('shell.ws.people.unused')}
      </span>
    )
  return (
    <button
      type="button"
      className="wsp-use wsp-use--key"
      data-testid="ws-use"
      data-used={n}
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-label={t('shell.ws.people.usedBy', { name, what: parts.join(' · ') })}
      onClick={onToggle}
    >
      {parts.join(' · ')}
      <ChevronDown size={12} aria-hidden className="wsp-use__chev" />
    </button>
  )
}

/** A member's uses (team): the read-out and its list, inside the member's row. */
function MemberUse({ use, name }: { use: PersonUse | undefined; name: string }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  return (
    <>
      <UseLine use={use} name={name} team open={open} onToggle={() => setOpen((o) => !o)} listId={listId} />
      {open && use && <UsedIn id={listId} use={use} />}
    </>
  )
}

function UsedIn({ id, use }: { id: string; use: PersonUse }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const title = (pid: ID) => pages[pid]?.title.trim() || t('common.untitled')
  const refs: Array<UseRef & { kind: 'row' | 'mention' }> = [...use.rows.map((r) => ({ ...r, kind: 'row' as const })), ...use.mentions.map((r) => ({ ...r, kind: 'mention' as const }))]
  const shown = refs.slice(0, LIST_MAX)
  return (
    <ul className="wsp-usedin" id={id} data-testid="ws-used-in">
      {shown.map((r) => (
        <li key={`${r.kind}:${r.pageId}`}>
          <a
            href={`#/p/${r.pageId}`}
            className="wsp-usedin__link"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              goToPage(r.pageId)
            }}
          >
            <span className="wsp-usedin__kind">{r.kind === 'row' ? t('shell.ws.people.kindRow') : t('shell.ws.people.kindMention')}</span>
            {r.dbId && <span className="wsp-usedin__db">{title(r.dbId)} ›</span>}
            <span className="wsp-usedin__title">{title(r.pageId)}</span>
            {r.hidden && <span className="wsp-usedin__tag">{t(`shell.ws.people.in.${r.hidden}`)}</span>}
          </a>
        </li>
      ))}
      {refs.length > shown.length && <li className="wsp-usedin__more label">{t('shell.ws.people.more', { n: refs.length - shown.length })}</li>}
    </ul>
  )
}
