/**
 * Gmail → a "Mails" database (features/mail) — re-exported by features/index.ts.
 *  - startMail(): background service (main.tsx, after the workspace loaded): schedule, "Load images"
 *  - MailTab: Settings → Mail · MailSyncLed { databaseId }: the Mails database's header read-out
 *  - openMailSettings() / consumeMailSettingsRequest(): open Settings on the Mail tab
 *  - syncNow({ connect? }) / organiseEarlier(): run a sync / "Organise with Claude" now (database commands)
 */
// One Script's mail.send through Gmail (registered at boot; a draft without Gmail)
import './scriptMail'

export { startMail, stopMail, openMailSettings, consumeMailSettingsRequest, useMail, syncNow, organiseEarlier } from './service'
export { MailTab } from './MailTab'
export { MailSyncLed } from './MailStatus'
