import nodemailer, { type Transporter } from 'nodemailer'
import type { Config } from '../config.ts'
import type { Logger } from '../log.ts'
import type { RenderedMail } from './templates.ts'

export interface OutgoingMail extends RenderedMail {
  to: string
  /** The one action link in the mail (for the dev mailbox and logs). */
  link: string
}

export interface StoredMail {
  to: string
  subject: string
  text: string
  link: string
  created_at: string
}

export interface Mailer {
  readonly mode: 'smtp' | 'dev'
  send(mail: OutgoingMail): Promise<void>
  /** Newest first; only filled in dev-mail mode or with DEV_MODE=1. */
  mailbox(): StoredMail[]
  verify(): Promise<void>
  close(): void
}

const MAILBOX_SIZE = 50

/**
 * SMTP_URL set → nodemailer transport. Without it the server runs in dev-mail mode: mails are kept in
 * memory and their links are logged, so a self-hoster can still sign in by reading the server log.
 */
export function createMailer(config: Config, log: Logger): Mailer {
  const keep = config.devMode || !config.smtpUrl
  const box: StoredMail[] = []
  const transport: Transporter | null = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null

  return {
    mode: transport ? 'smtp' : 'dev',
    async send(mail) {
      if (keep) {
        box.unshift({ to: mail.to, subject: mail.subject, text: mail.text, link: mail.link, created_at: new Date().toISOString() })
        box.length = Math.min(box.length, MAILBOX_SIZE)
        log.info('mail (dev)', { to: mail.to, subject: mail.subject, link: mail.link })
      }
      if (transport) {
        await transport.sendMail({ from: config.mailFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html })
      }
    },
    mailbox: () => box.slice(),
    async verify() {
      if (!transport) return
      try {
        await transport.verify()
        log.info('smtp ready')
      } catch (err) {
        log.error('smtp connection failed — sign-in mails will not be delivered', { error: (err as Error).message })
      }
    },
    close() {
      transport?.close()
    },
  }
}
