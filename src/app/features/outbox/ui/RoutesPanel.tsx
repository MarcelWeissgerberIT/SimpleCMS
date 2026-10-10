/** SENDEWEGE / SEND ROUTES on #/outbox: every active route by profile — label, tool, what it checks, the path, OUT. */
import { Route } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useListRoutes } from '../routes'
import { HelpLink } from '../../../help'

export function RoutesPanel() {
  const t = useT()
  const routes = useListRoutes()
  const profiles = useWorkspace((s) => s.integrations ?? [])
  const byProfile = new Map<string, typeof routes>()
  for (const r of routes) byProfile.set(r.ref.profileId, [...(byProfile.get(r.ref.profileId) ?? []), r])
  return (
    <section className="obx-rpanel" aria-label={t('features.outbox.routes.title')} data-testid="outbox-routes-panel">
      <h2 className="obx-side__head label">
        <Route size={13} aria-hidden />
        {t('features.outbox.routes.title')}
        <span className="obx-bin__rule" aria-hidden />
      </h2>
      {!routes.length && <p className="obx-rpanel__none">{t('features.outbox.empty.noRoutes')}</p>}
      {[...byProfile.entries()].map(([pid, list]) => (
        <div key={pid} className="obx-rpanel__profile">
          <span className="label">{t('features.outbox.routes.profile', { name: list[0].profileName })}</span>
          {list.map((r) => {
            const check = profiles.find((p) => p.id === pid)?.sends?.find((x) => x.id === r.ref.routeId)?.check
            return (
              <div key={r.ref.routeId} className="obx-rpanel__route">
                <div className="obx-rpanel__line">
                  <b>{r.label}</b>
                  <span className="obx-sp" />
                  <span className="label obx-rpanel__path">{r.usable.path === 'hand' ? t('features.outbox.routes.byHand') : t('features.outbox.routes.directOnly')}</span>
                  <span className="obx-out" title={t('features.outbox.routes.outTitle')}>
                    {t('features.outbox.routes.out')}
                  </span>
                </div>
                <span className="obx-rpanel__tool">
                  {r.tool}
                  {check?.fields.length ? ` · ${t('features.outbox.routes.checks', { fields: check.fields.join(', ') })}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      ))}
      <p className="obx-rpanel__foot">
        {t('features.outbox.routes.footer')}
        <HelpLink id="outbox" topic={t('features.outbox.title')} />
      </p>
    </section>
  )
}
