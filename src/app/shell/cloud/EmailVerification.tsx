import { useState } from 'react'
import { useCloud } from '../../cloud'
import { useLang, useT } from '../../i18n'
import { cloudApi } from './api'
import { errorText } from './errors'

export function EmailVerification() {
  const t = useT(), lang = useLang(), user = useCloud(s=>s.user)
  const [busy,setBusy] = useState(false), [sent,setSent] = useState(false), [error,setError] = useState('')
  if (!user || user.emailVerified !== false) return null
  return <section className="cl-card" aria-label={t('shell.cloud.inv.unverified')}>
    <strong>{t('shell.cloud.inv.unverified')}</strong>
    <p className="cl-fine">{t('shell.cloud.inv.verifyHint')}</p>
    <button className="btn" disabled={busy||sent} onClick={async()=>{
      setBusy(true);setError('')
      try {await cloudApi.cloudRequest('POST','api/me/verify-email',{lang});setSent(true)}
      catch(e){setError(errorText(e,t))}finally{setBusy(false)}
    }}>{t('shell.cloud.inv.verify')}</button>
    {sent && <p role="status">{t('shell.cloud.inv.verifySent')}</p>}
    {error && <p className="cl-err" role="alert">{error}</p>}
  </section>
}
