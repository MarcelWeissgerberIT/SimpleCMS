import { escapeHtml, type Lang } from '../i18n.ts'

export interface RenderedMail {
  subject: string
  text: string
  html: string
}

const PRODUCT = 'SimpleCMS One'

/** Header injection guard + keeps subjects short (names are user-controlled). */
const oneLine = (s: string, max = 80) => s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)

export function magicLinkMail(lang: Lang, input: { link: string; email: string; minutes: number }): RenderedMail {
  const t =
    lang === 'de'
      ? {
          subject: `Bei ${PRODUCT} anmelden`,
          label: 'ANMELDUNG',
          title: 'Dein Anmeldelink',
          body: `Klicke auf den Button, um dich als ${input.email} anzumelden. Der Link ist ${input.minutes} Minuten gültig und funktioniert genau einmal.`,
          button: 'Anmelden',
          fallback: 'Oder kopiere diesen Link in deinen Browser:',
          ignore: 'Du hast das nicht angefordert? Dann ignoriere diese E-Mail einfach – ohne den Link passiert nichts.',
        }
      : {
          subject: `Sign in to ${PRODUCT}`,
          label: 'SIGN-IN',
          title: 'Your sign-in link',
          body: `Click the button to sign in as ${input.email}. The link works once and expires in ${input.minutes} minutes.`,
          button: 'Sign in',
          fallback: 'Or paste this link into your browser:',
          ignore: "Didn't ask for this? Just ignore this email — nothing happens without the link.",
        }
  return {
    subject: t.subject,
    text: `${t.title}\n\n${t.body}\n\n${input.link}\n\n${t.ignore}\n\n— ${PRODUCT}\n`,
    html: layout(t.label, t.title, t.body, { href: input.link, label: t.button }, t.fallback, t.ignore),
  }
}

export function inviteMail(
  lang: Lang,
  input: { link: string; workspace: string; inviter: string; role: string; days: number },
): RenderedMail {
  const ws = oneLine(input.workspace)
  const who = oneLine(input.inviter, 60)
  const roleDe: Record<string, string> = { admin: 'Admin', member: 'Mitglied', viewer: 'Leser' }
  const t =
    lang === 'de'
      ? {
          subject: `${who} hat dich zu „${ws}“ eingeladen`,
          label: 'EINLADUNG',
          title: `Einladung zu „${ws}“`,
          body: `${who} lädt dich als ${roleDe[input.role] ?? input.role} in den Workspace „${ws}“ auf ${PRODUCT} ein. Die Einladung ist ${input.days === 1 ? 'einen Tag' : `${input.days} Tage`} gültig.`,
          button: 'Einladung annehmen',
          fallback: 'Oder kopiere diesen Link in deinen Browser:',
          ignore: 'Du kennst die Person nicht? Dann ignoriere diese E-Mail.',
        }
      : {
          subject: `${who} invited you to “${ws}”`,
          label: 'INVITATION',
          title: `Join “${ws}”`,
          body: `${who} invited you to the workspace “${ws}” on ${PRODUCT} as ${input.role}. The invitation is valid for ${input.days === 1 ? 'one day' : `${input.days} days`}.`,
          button: 'Accept invitation',
          fallback: 'Or paste this link into your browser:',
          ignore: "Don't know who this is? Just ignore this email.",
        }
  return {
    subject: t.subject,
    text: `${t.title}\n\n${t.body}\n\n${input.link}\n\n${t.ignore}\n\n— ${PRODUCT}\n`,
    html: layout(t.label, t.title, t.body, { href: input.link, label: t.button }, t.fallback, t.ignore),
  }
}

/** Table layout + inline styles: the only thing every mail client renders the same. Paper, ink, one orange. */
function layout(label: string, title: string, body: string, cta: { href: string; label: string }, fallback: string, footer: string): string {
  const e = escapeHtml
  const mono = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
  const sans = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif"
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;padding:0;background:#f2f0ea;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0ea;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fbfaf6;border:1px solid #d9d5ca;border-radius:4px;">
<tr><td style="padding:20px 28px;border-bottom:1px solid #d9d5ca;font:500 10.5px/1 ${mono};letter-spacing:.08em;text-transform:uppercase;color:#67635b;">
<span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:#ff4f00;margin-right:8px;vertical-align:1px;"></span>${e(PRODUCT)} &nbsp;§&nbsp; ${e(label)}
</td></tr>
<tr><td style="padding:28px 28px 8px;font:800 24px/1.15 ${sans};letter-spacing:-.01em;color:#141413;">${e(title)}</td></tr>
<tr><td style="padding:8px 28px 20px;font:400 15px/1.55 ${sans};color:#2b2a27;">${e(body)}</td></tr>
<tr><td style="padding:0 28px 24px;">
<a href="${e(cta.href)}" style="display:inline-block;background:#141413;color:#fbfaf6;text-decoration:none;font:600 14px/1 ${sans};padding:13px 20px;border-radius:2px;border-bottom:2px solid #ff4f00;">${e(cta.label)} &rarr;</a>
</td></tr>
<tr><td style="padding:0 28px 24px;font:400 12px/1.5 ${sans};color:#67635b;">${e(fallback)}<br><a href="${e(cta.href)}" style="color:#141413;word-break:break-all;font:400 11.5px/1.5 ${mono};">${e(cta.href)}</a></td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #d9d5ca;font:400 12px/1.5 ${sans};color:#67635b;">${e(footer)}</td></tr>
</table>
</td></tr></table>
</body></html>`
}
