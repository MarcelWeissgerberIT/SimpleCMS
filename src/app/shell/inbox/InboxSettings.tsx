/** Inbox settings: browser notifications on / off (this device) + the browser's permission state. */
import { useState } from 'react'
import { useT } from '../../i18n'
import { Popover, type PopoverAnchor } from '../../ui/Popover'
import { Switch } from '../../ui/controls'
import { notifyPermission, requestNotifyPermission, setNotify, useInbox, type NotifyPermission } from '../../features'

export function InboxSettings({ anchor, onClose }: { anchor: PopoverAnchor; onClose: () => void }) {
  const t = useT()
  const on = useInbox((s) => s.data.notify)
  const [perm, setPerm] = useState<NotifyPermission>(notifyPermission)
  const toggle = async (next: boolean) => {
    if (!next) return void setNotify(false)
    // the only place that asks: an explicit click
    const p = await requestNotifyPermission()
    setPerm(p)
    if (p === 'granted') void setNotify(true)
  }
  const shown = on && perm === 'granted'
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-end" className="ibx-set" role="dialog" aria-label={t('shell.inbox.settings')}>
      <div className="label ibx-set__head">§ — {t('shell.inbox.settings')}</div>
      <div className="ibx-set__row">
        <span className="ibx-set__name">{t('shell.inbox.notify')}</span>
        <Switch checked={shown} label={t('shell.inbox.notify')} disabled={perm === 'unsupported' || perm === 'denied'} onChange={(v) => void toggle(v)} />
      </div>
      <p className="ibx-set__hint">{t('shell.inbox.notify.hint')}</p>
      <div className="ibx-set__perm" data-perm={perm}>
        <span className={`led${perm === 'granted' ? ' led--ok' : perm === 'denied' ? ' led--on' : ''}`} aria-hidden />
        <span className="label">{t('shell.inbox.perm')}</span>
        <span className="ibx-set__state">{t(`shell.inbox.perm.${perm}`)}</span>
      </div>
    </Popover>
  )
}
