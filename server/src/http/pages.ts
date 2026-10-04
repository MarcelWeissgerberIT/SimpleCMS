import { escapeHtml as e, type Lang } from '../i18n.ts'

/**
 * The few HTML pages the server renders itself (magic-link confirmation and errors).
 * INSTRUMENT look: paper, ink, one orange; no scripts (the CSP would not allow inline ones anyway).
 */
function page(lang: Lang, title: string, content: string): string {
  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="same-origin"><meta name="robots" content="noindex">
<title>${e(title)} — SimpleCMS One</title>
<style>
:root{--bg:#f2f0ea;--card:#fbfaf6;--ink:#141413;--ink2:#67635b;--rule:#d9d5ca;--signal:#ff4f00}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--card:#181816;--ink:#f2f0ea;--ink2:#8f8b83;--rule:#2c2b28}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink)}
body{min-height:100vh;display:grid;place-items:center;padding:24px 16px;font:15px/1.55 Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--rule);border-radius:4px}
.label{padding:16px 24px;border-bottom:1px solid var(--rule);font:500 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2)}
.led{display:inline-block;width:7px;height:7px;border-radius:7px;background:var(--signal);margin-right:8px;vertical-align:1px}
h1{margin:0;padding:24px 24px 8px;font-size:24px;line-height:1.15;font-weight:800;font-stretch:125%;letter-spacing:-.01em}
p{margin:0;padding:0 24px 20px;color:var(--ink2)}
form,.actions{padding:0 24px 24px;margin:0}
button,a.button{display:inline-block;font-family:inherit;font-weight:600;font-size:14px;line-height:1;padding:13px 20px;border-radius:2px;border:0;border-bottom:2px solid var(--signal);background:var(--ink);color:var(--bg);text-decoration:none;cursor:pointer}
button:active,a.button:active{transform:translateY(1px)}
button:focus-visible,a.button:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
</style></head>
<body><main>${content}</main></body></html>`
}

const label = (text: string) => `<div class="label"><span class="led"></span>SimpleCMS One &nbsp;§&nbsp; ${e(text)}</div>`

export function confirmSignInPage(lang: Lang, input: { email: string; token: string }): string {
  const t =
    lang === 'de'
      ? { label: 'Anmeldung', title: 'Anmeldung bestätigen', body: `Melde dich auf diesem Gerät als ${input.email} an.`, button: 'Anmelden' }
      : { label: 'Sign-in', title: 'Confirm sign-in', body: `Sign in on this device as ${input.email}.`, button: 'Sign in' }
  return page(
    lang,
    t.title,
    `${label(t.label)}<h1>${e(t.title)}</h1><p>${e(t.body)}</p>
<form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${e(input.token)}"><button type="submit">${e(t.button)} &rarr;</button></form>`,
  )
}

/** invalid: the magic link itself · signup_closed: no account for this address · signup_link: the registration link died meanwhile */
export function linkInvalidPage(lang: Lang, reason: 'invalid' | 'signup_closed' | 'signup_link'): string {
  const t =
    lang === 'de'
      ? {
          label: 'Anmeldung',
          title: reason === 'invalid' ? 'Link abgelaufen' : 'Kein Zugang',
          body:
            reason === 'invalid'
              ? 'Dieser Anmeldelink ist ungültig, abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.'
              : reason === 'signup_link'
                ? 'Dieser Registrierungslink ist inzwischen abgelaufen, aufgebraucht oder wurde zurückgezogen. Bitte die Admin-Person dieses Servers um einen neuen.'
                : 'Auf diesem Server können sich nur eingeladene Adressen registrieren. Bitte eine Admin-Person um eine Einladung.',
          button: 'Zur App',
        }
      : {
          label: 'Sign-in',
          title: reason === 'invalid' ? 'Link expired' : 'No access',
          body:
            reason === 'invalid'
              ? 'This sign-in link is invalid, expired or was already used. Just request a new one.'
              : reason === 'signup_link'
                ? 'This registration link expired, was used up or revoked meanwhile. Ask the admin of this server for a new one.'
                : 'This server only accepts invited addresses. Ask an admin of your team for an invitation.',
          button: 'Open the app',
        }
  return page(lang, t.title, `${label(t.label)}<h1>${e(t.title)}</h1><p>${e(t.body)}</p><div class="actions"><a class="button" href="/app/">${e(t.button)} &rarr;</a></div>`)
}

export function notFoundPage(): string {
  return page('en', 'Not found', `${label('404')}<h1>Not found</h1><p>Nothing lives at this address.</p><div class="actions"><a class="button" href="/app/">Open the app &rarr;</a></div>`)
}
