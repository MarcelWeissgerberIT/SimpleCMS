/**
 * One Script's mail.send through Gmail (registered with the script area's registerEffect at boot — this
 * module is imported by mail/index.ts). When Gmail is set up on this device (a client and a connected
 * account), a script's mail is SENT from that account, after the run's confirmation (which lists every
 * mail, marked "via Gmail · <account>"). The first time, Google asks for the extra permission to send
 * (gmail.send — incremental consent through the same token client; read access stays as it was). The
 * access token lives in memory only (auth.ts); nothing here stores it. Without Gmail: the core's default,
 * a ready draft in the person's mail program (mailto:).
 *
 * The message is RFC 822 / MIME: UTF-8 text/plain, base64 body, the subject as RFC 2047 encoded words when
 * it is not plain ASCII, header values without line breaks (no header injection).
 */
import { t } from '../../i18n'
import { mailtoUrl, registerEffect, type EffectImpl, type MailInput } from '../script'
import { AuthError, currentToken, requestToken, tokenHasScope } from './auth'
import { effectiveClient } from './builtin'
import { GMAIL_SCOPE, GMAIL_SEND_SCOPE, readMail } from './settings'
import { useMail } from './service'

/* ------------------------------------------------------------------ the message */

const utf8 = (s: string) => new TextEncoder().encode(s)

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** base64url without padding (Gmail's `raw`). */
export const base64url = (s: string) => base64(utf8(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** One header line's value: no CR / LF, no other control characters. */
const clean = (s: string) => s.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim()

/**
 * A header value as RFC 2047 encoded words ("=?UTF-8?B?…?=", each ≤ 75 characters, folded) when it has
 * non-ASCII characters; plain ASCII stays as it is.
 */
export function encodeHeader(value: string): string {
  const v = clean(value)
  if (/^[\x20-\x7e]*$/.test(v)) return v
  const words: string[] = []
  let chunk = ''
  // 45 bytes → 60 base64 characters + 12 for "=?UTF-8?B?" and "?=": within 75; never split a character
  for (const ch of v) {
    if (utf8(chunk + ch).length > 45) {
      words.push(chunk)
      chunk = ''
    }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${base64(utf8(w))}?=`).join('\r\n ')
}

/** The body as base64 lines of 76 characters. */
const bodyLines = (text: string) => (base64(utf8(text.replace(/\r?\n/g, '\r\n'))).match(/.{1,76}/g) ?? []).join('\r\n')

/** The RFC 822 message of a script's mail (`from`: the connected account, when known). */
export function rfc822(m: MailInput, from: string | null, now = new Date()): string {
  const list = (xs: string[]) => xs.map(clean).filter(Boolean).join(', ')
  const head = [
    ...(from ? [`From: ${clean(from)}`] : []),
    `To: ${list(m.to)}`,
    ...(m.cc.length ? [`Cc: ${list(m.cc)}`] : []),
    ...(m.bcc.length ? [`Bcc: ${list(m.bcc)}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    'X-Mailer: SimpleCMS One (One Script)',
  ]
  return `${head.join('\r\n')}\r\n\r\n${bodyLines(m.body)}\r\n`
}

/* ------------------------------------------------------------------ the effect */

/** Gmail is set up on this device: a client to sign in with and an account connected before (or now). */
function gmailReady(): { clientId: string; account: string | null } | null {
  const client = effectiveClient(readMail())
  const { account } = useMail.getState()
  if (!client || (!account && !currentToken())) return null
  return { clientId: client.id, account }
}

const draft = (m: MailInput) => {
  // the person's mail program opens with the draft; One sends nothing itself
  window.open(mailtoUrl(m), '_self')
  return { status: 'draft' as const }
}

const AUTH_TEXT: Partial<Record<AuthError['code'], string>> = { denied: 'features.mail.send.err.denied', scope: 'features.mail.send.err.scope', closed: 'features.mail.send.err.closed', popup: 'features.mail.send.err.popup' }

export const gmailMail: EffectImpl<'mail.send'> = async (m, env) => {
  const gmail = gmailReady()
  if (!gmail) return draft(m)
  // the send permission once (Google shows only what is new); the token stays in memory only
  if (!tokenHasScope(GMAIL_SEND_SCOPE)) {
    try {
      await requestToken(gmail.clientId, { prompt: '', hint: gmail.account, scopes: [GMAIL_SCOPE, GMAIL_SEND_SCOPE] })
    } catch (e) {
      const key = e instanceof AuthError ? AUTH_TEXT[e.code] : undefined
      throw new Error(key ? t(key) : t('features.mail.send.err.auth'))
    }
  }
  const { sendMessage, GmailError } = await import('./gmail')
  try {
    const sent = await sendMessage({ token: currentToken, signal: env.signal }, base64url(rfc822(m, useMail.getState().account ?? gmail.account)))
    return { status: 'sent', id: sent.id }
  } catch (e) {
    if (e instanceof GmailError) throw new Error(t(`features.mail.send.err.gmail.${e.code}`))
    throw e
  }
}

/** The run's confirm list: "via Gmail · ada@example.com" while Gmail sends (nothing: a draft). */
const note = () => {
  const gmail = gmailReady()
  return gmail ? t('features.mail.send.via', { account: gmail.account ?? 'Gmail' }) : null
}

registerEffect('mail.send', gmailMail, { note })
