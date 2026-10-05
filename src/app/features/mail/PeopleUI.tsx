/**
 * Contacts, companies, conversations — the UI: Settings → Mail § C (the switch, the three databases with
 * "Merge…", the freemail domains) and the merge dialog (also behind the "Merge…" key in a directory's
 * header, MailStatus.tsx).
 */
import { useId, useMemo, useState } from 'react'
import { ArrowUpRight, Building2, Contact, GitMerge, MessageSquare, Plus, X } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { openPage } from '../../lib/router'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { cleanFreemail, MAX_FREEMAIL, setPeople, useMailSettings } from './settings'
import { PEOPLE_KINDS, keyPropOf, keysOf, mergeRows, peopleDbId, type PeopleKind } from './people'
import { linkNow } from './service'
import { MlField, Panel, SwitchRow } from './parts'

const ICONS = { contacts: Contact, companies: Building2, conversations: MessageSquare }

/* ------------------------------------------------------------------ merge */

/** "Merge … into …": two rows of a directory; the first goes to the trash, everything moves to the second. */
export function MergeDialog({ dbId, kind, from, onClose }: { dbId: ID; kind: PeopleKind; from?: ID; onClose: () => void }) {
  const t = useT()
  const uid = useId()
  const pages = useWorkspace((s) => s.pages)
  const db = useWorkspace((s) => s.databases[dbId])
  const rows = useMemo(() => {
    const key = db ? keyPropOf(kind, db) : undefined
    return Object.values(pages)
      .filter((p) => p.databaseId === dbId && !p.trashed)
      .map((p) => ({ id: p.id, title: p.title.trim() || t('common.untitled'), keys: kind === 'conversations' ? '' : keysOf(key ? p.properties[key] : undefined).join(', ') }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [pages, db, dbId, kind, t])
  const [a, setA] = useState(from ?? '')
  const [b, setB] = useState('')
  const ok = !!a && !!b && a !== b
  const label = (r: (typeof rows)[number]) => (r.keys ? `${r.title} — ${r.keys}` : r.title)
  const pick = (id: string, value: string, set: (v: string) => void, other: string, text: string) => (
    <MlField label={text} htmlFor={id}>
      <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">{t('features.mail.people.merge.pick')}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id} disabled={r.id === other}>
            {label(r)}
          </option>
        ))}
      </select>
    </MlField>
  )
  return (
    <Modal
      open
      onClose={onClose}
      label={t(`features.mail.people.${kind}.title`).toUpperCase()}
      title={t('features.mail.people.merge.title')}
      width={480}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!ok} onClick={() => ok && mergeRows(dbId, a, b) && onClose()}>
            <GitMerge size={14} /> {t('features.mail.people.merge.confirm')}
          </button>
        </>
      }
    >
      <div className="ml-merge" data-testid="mail-merge">
        {pick(`${uid}-a`, a, setA, b, t('features.mail.people.merge.from'))}
        {pick(`${uid}-b`, b, setB, a, t('features.mail.people.merge.into'))}
        <p className="ml-field__hint">{t(`features.mail.people.merge.hint.${kind}`)}</p>
      </div>
    </Modal>
  )
}

/** The "Merge…" key of a directory (Settings → Mail, the database's header). */
export function MergeKey({ dbId, kind, compact }: { dbId: ID; kind: PeopleKind; compact?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={compact ? 'ml-led ml-merge-key' : 'btn btn--sm'} onClick={() => setOpen(true)} aria-label={`${t('features.mail.people.merge.open')} — ${t(`features.mail.people.${kind}.title`)}`}>
        <GitMerge size={13} /> {t('features.mail.people.merge.open')}
      </button>
      {open && <MergeDialog dbId={dbId} kind={kind} onClose={() => setOpen(false)} />}
    </>
  )
}

/* ------------------------------------------------------------------ Settings → Mail § C */

function Directory({ kind }: { kind: PeopleKind }) {
  const t = useT()
  const id = useWorkspace(() => peopleDbId(kind))
  const title = useWorkspace((s) => (id ? s.pages[id]?.title.trim() : ''))
  const count = useWorkspace((s) => {
    if (!id) return 0
    let n = 0
    for (const p of Object.values(s.pages)) if (p.databaseId === id && !p.trashed) n++
    return n
  })
  const Icon = ICONS[kind]
  const name = title || t(`features.mail.people.${kind}.title`)
  return (
    <li className="ml-dir" data-testid={`mail-dir-${kind}`}>
      <Icon size={14} aria-hidden className="ml-dir__icon" />
      <span className="ml-dir__name">{name}</span>
      <span className="ml-dir__count label">{id ? t(count === 1 ? 'features.mail.people.rows.one' : 'features.mail.people.rows', { n: count }) : t('features.mail.people.later')}</span>
      {id && (
        <span className="ml-dir__keys">
          {kind !== 'conversations' && <MergeKey dbId={id} kind={kind} />}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => openPage(id)} aria-label={`${t('common.open')} — ${name}`}>
            <ArrowUpRight size={13} /> {t('common.open')}
          </button>
        </span>
      )}
    </li>
  )
}

function Freemail() {
  const t = useT()
  const uid = useId()
  const list = useMailSettings().people.freemail
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState(false)
  const add = () => {
    const d = cleanFreemail(draft)
    if (!d) return setErr(true)
    if (!list.includes(d)) setPeople({ freemail: [...list, d] })
    setDraft('')
    setErr(false)
  }
  return (
    <details className="ml-setup ml-free" data-testid="mail-freemail">
      <summary className="ml-setup__sum">
        <span className="label">{t('features.mail.people.freemail')}</span>
        <span className="ml-setup__time">{t('features.mail.people.freemailCount', { n: list.length })}</span>
      </summary>
      <div className="ml-free__body">
        <p className="ml-field__hint ml-free__hint">{t('features.mail.people.freemailHint')}</p>
        <div className="ml-chips">
          {list.map((d) => (
            <span key={d} className="ml-tag ml-mono">
              {d}
              <button type="button" className="ml-tag__x" onClick={() => setPeople({ freemail: list.filter((x) => x !== d) })} aria-label={t('features.mail.people.freemailRemove', { name: d })}>
                <X size={11} />
              </button>
            </span>
          ))}
          {list.length < MAX_FREEMAIL && (
            <span className="ml-tagadd">
              <input
                id={`${uid}-free`}
                className="input ml-tagadd__input ml-mono"
                value={draft}
                placeholder={t('features.mail.people.freemailAdd')}
                aria-label={t('features.mail.people.freemailAdd')}
                aria-invalid={err}
                aria-describedby={err ? `${uid}-free-err` : undefined}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setDraft(e.target.value)
                  setErr(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    add()
                  }
                }}
              />
              <button type="button" className="btn btn--sm" onClick={add} disabled={!draft.trim()} aria-label={t('common.add')}>
                <Plus size={13} />
              </button>
            </span>
          )}
        </div>
        {err && (
          <p className="ml-msg ml-msg--err" id={`${uid}-free-err`} role="alert">
            {t('features.mail.people.freemailInvalid')}
          </p>
        )}
      </div>
    </details>
  )
}

export function PeoplePanel() {
  const t = useT()
  const uid = useId()
  const on = useMailSettings().people.enabled
  return (
    <Panel id={uid} code="§ C" title={t('features.mail.people.title')} state={on ? 'ok' : 'off'} stateText={on ? t('features.mail.claude.on') : t('features.mail.claude.off')}>
      <SwitchRow
        label={t('features.mail.people.switch')}
        hint={t('features.mail.people.switchHint')}
        checked={on}
        onChange={(v) => {
          setPeople({ enabled: v })
          if (v) void linkNow()
        }}
      />
      {on && (
        <>
          <ul className="ml-dirs" aria-label={t('features.mail.people.directories')}>
            {PEOPLE_KINDS.map((kind) => (
              <Directory key={kind} kind={kind} />
            ))}
          </ul>
          <Freemail />
        </>
      )}
    </Panel>
  )
}
