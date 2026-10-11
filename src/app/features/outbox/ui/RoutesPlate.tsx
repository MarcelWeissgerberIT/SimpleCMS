/**
 * SENDEWEGE / SEND ROUTES under a database's table: one key per route ("⌘ Reply in the ticket tool [OUT]"), each opening
 * the draft popover for the rows picked (the focused slip's row when nothing is picked), the help line, and the
 * logbook of the focused slip.
 */
import { Command } from 'lucide-react'
import type { ID } from '../../../store/types'
import { useT } from '../../../i18n'
import { HelpLink } from '../../../help'
import { useRoutesFor } from '../routes'
import { useOutbox } from '../store'
import { openDraft } from './draftState'
import { Logbook } from './Logbook'

export default function RoutesPlate({ dbId }: { dbId: ID }) {
  const t = useT()
  const routes = useRoutesFor(dbId)
  const focus = useOutbox((s) => (s.focus && s.slips[s.focus]?.target.dbId === dbId ? s.slips[s.focus] : null))
  if (!routes.length && !focus) return null
  const profiles = [...new Set(routes.map((r) => r.profileName))]
  return (
    <div className="obx-dbfoot">
      {routes.length > 0 && (
        <section className="obx-routes" aria-label={t('features.outbox.routes.title')} data-testid="outbox-routes">
          <div className="obx-routes__keys">
            <span className="label">
              {t('features.outbox.routes.title')} · {profiles.map((p) => t('features.outbox.routes.profile', { name: p })).join(' · ')}
            </span>
            {routes.map((r) => (
              <button
                key={`${r.ref.profileId}/${r.ref.routeId}`}
                type="button"
                className="btn obx-routekey"
                onClick={(e) => openDraft({ dbId, route: r.ref, rowIds: focus ? [focus.target.rowId] : [], anchor: e.currentTarget })}
              >
                <span className="obx-routekey__cmd" aria-hidden>
                  <Command size={11} />
                </span>
                {r.label}
                <span className="obx-out" title={t('features.outbox.routes.outTitle')}>
                  {t('features.outbox.routes.out')}
                </span>
              </button>
            ))}
          </div>
          <p className="obx-routes__hint">
            {t('features.outbox.routes.hint')}
            <HelpLink id="outbox" topic={t('features.outbox.title')} />
          </p>
        </section>
      )}
      {focus && <Logbook slip={focus} />}
    </div>
  )
}
