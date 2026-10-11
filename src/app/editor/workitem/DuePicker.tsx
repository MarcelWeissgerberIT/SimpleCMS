/**
 * Task block — the due picker: the date mention's editor (date, time, reminder; features/inbox) with Clear, and in a
 * team workspace who the reminder rings for. A draft until written:
 *  - a task without a date opens on today as its STARTING POINT only — Esc or a press outside writes nothing;
 *  - Done (or Enter in a field) writes what it shows, even untouched ("+ DATE → Done" = today);
 *  - a press outside / Tab out writes only a changed draft; Esc never writes; Clear removes date + reminder.
 */
import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { useShallow } from 'zustand/react/shallow'
import { DateReminderEditor, type DateReminderValue } from '../../features'
import { audienceText, useMemberIds } from '../../features/workitems'
import { Popover } from '../../ui/Popover'
import { HelpLink } from '../../help'
import { useLang, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import type { PickerCtx } from './ItemPickers'

export function DuePicker({ ctx }: { ctx: PickerCtx }) {
  const t = useT()
  const lang = useLang()
  const a = ctx.attrs
  const [draft, setDraft] = useState<DateReminderValue>(() => ({ iso: a.due ?? format(new Date(), 'yyyy-MM-dd'), reminder: a.due ? a.reminder : null }))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const touched = useRef(false)
  const { team, me } = useCloud(useShallow((c) => ({ team: c.active.kind === 'cloud', me: c.user?.id ?? null })))
  const members = useMemberIds()
  const people = useWorkspace((s) => s.people)
  const audience = audienceText(a.people, { team, me, members }, (id) => people.find((p) => p.id === id)?.name ?? null, t, lang)

  const write = () => ctx.commit({ due: draftRef.current.iso, reminder: draftRef.current.reminder })
  const onClose = () => {
    if (ctx.escaped()) return ctx.close()
    const d = draftRef.current
    if (touched.current && (d.iso !== a.due || d.reminder !== a.reminder)) return void write()
    ctx.close()
  }
  return (
    <Popover open anchor={ctx.anchor} onClose={onClose} placement="bottom-start" offset={6} className="dme-pop wi-pop wi-due" role="dialog" aria-label={t('editor.workItem.duePicker')}>
      <DateReminderEditor
        value={draft}
        onChange={(v) => {
          touched.current = true
          draftRef.current = v
          setDraft(v)
        }}
        onDone={write}
        footer={
          <>
            <HelpLink id="tasks" topic={t('features.workItems.help')} />
            {a.due && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => ctx.commit({ due: null })}>
                {t('editor.workItem.clear')}
              </button>
            )}
          </>
        }
      />
      {audience && <p className="wi-due__audience">{audience}</p>}
    </Popover>
  )
}
