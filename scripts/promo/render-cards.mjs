#!/usr/bin/env node
/**
 * Renders the promo's graphic layers as 1920×1080 PNGs in the INSTRUMENT style:
 *   captions/cap-XX.png  lower-third caption per voice-over line (transparent)
 *   cards/hook.png       the black "see it yourself" card after the hammer teaser
 *   cards/end-1..3.png   end card states (kinetic, switched on the voice-over words)
 * Usage: node scripts/promo/render-cards.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = '.shots/promo/cards'
mkdirSync(`${OUT}/captions`, { recursive: true })
const font = (p) => `file://${resolve('node_modules', p)}`
const BASE_CSS = `
@font-face { font-family: Archivo; src: url('${font('@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')}') format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
@font-face { font-family: Mono; src: url('${font('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 800; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1920px; height: 1080px; background: transparent; }
body { font-family: Archivo, sans-serif; -webkit-font-smoothing: antialiased; }
.mono { font-family: Mono, monospace; text-transform: uppercase; letter-spacing: .08em; }
.sig { color: #ff4f00; }
`

// One line per voice-over line (the narration says more; the caption carries it for muted autoplay).
// Kept to one line so the lower third covers as little of the app as possible.
export const CAPTIONS = [
  { label: '§ 00 — The problem', text: 'Notion is brilliant. For a team of ten, it also costs nearly $3,000 a year.' },
  { label: '§ 00 — The fix', text: 'So we took a hammer to it.' },
  { label: '§ 01 — SimpleCMS One', text: 'Notion, rebuilt — minus the bill.' },
  { label: '§ 02 — Block editor', text: 'Slash commands, toggles, math, diagrams — and forms with logic.' },
  { label: '§ 03 — Databases · charts', text: 'Eight views, relations, rollups, formulas — charts in three clicks.' },
  { label: '§ 04 — Spreadsheets', text: 'Sheets, formulas, coloured datasets — and functions you build by clicking.' },
  { label: '§ 05 — Teams', text: 'Live editing, private pages, every workspace encrypted with its own key.' },
  { label: '§ 06 — Claude · MCP', text: 'Claude built in — and Claude Desktop runs your workspace over MCP.' },
  { label: '§ 07 — Automations', text: 'Meeting notes, GitHub sync, webhooks into n8n.' },
]

const captionHtml = ({ label, text }) => `<!doctype html><html><head><style>${BASE_CSS}
.cap { position: absolute; left: 64px; bottom: 44px; max-width: 1560px; padding: 16px 28px 19px 32px; background: rgba(18,18,16,.94); color: #f2f0ea; border-radius: 6px; box-shadow: 0 18px 50px -12px rgba(0,0,0,.45); }
.cap::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #ff4f00; border-radius: 6px 0 0 6px; }
.lbl { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
.txt { font-size: 34px; line-height: 1.2; font-weight: 600; letter-spacing: -.01em; font-stretch: 100%; }
</style></head><body><div class="cap"><div class="lbl mono sig">${label}</div><div class="txt">${text}</div></div></body></html>`

const cardCss = `${BASE_CSS}
html, body { background: #111110; color: #ece9e2; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(236,233,226,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(236,233,226,.05) 1px, transparent 1px); background-size: 80px 80px; }
.wrap { position: absolute; left: 140px; right: 140px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
.lbl { font-size: 22px; font-weight: 600; margin-bottom: 34px; display: flex; gap: 14px; align-items: center; }
.led { width: 12px; height: 12px; border-radius: 50%; background: #ff4f00; box-shadow: 0 0 0 5px rgba(255,79,0,.18); }
.big { font-size: 128px; line-height: .98; font-weight: 820; font-stretch: 125%; letter-spacing: -.025em; }
.dot { color: #ff4f00; }
.sub { margin-top: 40px; font-size: 40px; font-weight: 500; color: #b8b4ab; }
.kbd { display: inline-block; padding: 2px 14px 4px; border: 2px solid rgba(236,233,226,.35); border-bottom-width: 5px; border-radius: 8px; font-family: Mono; font-size: 34px; color: #ece9e2; }
.rule { position: absolute; left: 140px; right: 140px; bottom: 120px; height: 1px; background: rgba(236,233,226,.18); }
.foot { position: absolute; left: 140px; right: 140px; bottom: 70px; display: flex; justify-content: space-between; font-size: 20px; color: #8a867e; }
`

const hookHtml = `<!doctype html><html><head><style>${cardCss}</style></head><body><div class="grid"></div>
<div class="wrap">
  <div class="lbl mono sig"><span class="led"></span>§ ?? — Classified</div>
  <div class="big">What happens next<span class="dot">?</span></div>
  <div class="sub">Open getonecms.com. Don't touch anything for <span class="kbd">15 s</span>. See it yourself.</div>
</div>
<div class="rule"></div><div class="foot mono"><span>SimpleCMS One</span><span>Spoiler-free since 1997</span></div>
</body></html>`

const LOGO = `<svg width="96" height="96" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="3" fill="#FF4F00"/><circle cx="7" cy="7" r="2" fill="#121210"/><path d="M13 9.5 18.5 7H21v18h-4.2V12.2L13 13.8z" fill="#121210"/></svg>`
// end card states, switched on the voice-over: 1 "No subscription." · 2 "Your data stays yours." · 3 the brand
const endHtml = (state) => `<!doctype html><html><head><style>${cardCss}
.lines { font-size: 104px; line-height: 1.06; font-weight: 820; font-stretch: 125%; letter-spacing: -.025em; }
.lines div { opacity: 1; }
.lines .off { opacity: .14; }
.brand { display: flex; align-items: center; gap: 30px; margin-top: 70px; }
.name { font-size: 64px; font-weight: 820; font-stretch: 125%; letter-spacing: -.02em; }
.url { font-family: Mono; font-size: 34px; color: #ff4f00; margin-top: 10px; letter-spacing: .02em; text-transform: none; }
.tags { margin-top: 34px; font-size: 22px; color: #8a867e; }
.hint { margin-top: 18px; font-size: 26px; color: #b8b4ab; }
</style></head><body><div class="grid"></div>
<div class="wrap">
  <div class="lines">
    <div class="${state >= 1 ? '' : 'off'}">No subscription<span class="dot">.</span></div>
    <div class="${state >= 2 ? '' : 'off'}">Your data stays yours<span class="dot">.</span></div>
  </div>
  <div class="brand" style="opacity:${state >= 3 ? 1 : 0}">
    ${LOGO}
    <div><div class="name">SimpleCMS One</div><div class="url">getonecms.com</div></div>
  </div>
  <div class="tags mono" style="opacity:${state >= 3 ? 1 : 0}">Free · Local-first · Open source · Team cloud on your own server · Built for the Ninja Armory</div>
  <div class="hint" style="opacity:${state >= 3 ? 1 : 0}">Open it — and don't touch anything for 15 seconds.</div>
</div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
async function render(html, file, transparent) {
  // load from a file so the file:// font URLs are allowed
  writeFileSync(`${OUT}/_tmp.html`, html)
  await page.goto(`file://${resolve(OUT, '_tmp.html')}`, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  await page.screenshot({ path: file, omitBackground: !!transparent })
}
for (const [i, c] of CAPTIONS.entries()) await render(captionHtml(c), `${OUT}/captions/cap-${String(i + 1).padStart(2, '0')}.png`, true)
await render(hookHtml, `${OUT}/hook.png`)
rmSync(OUT + '/end-4.png', { force: true }) // v1 had four states
for (let s = 1; s <= 3; s++) await render(endHtml(s), `${OUT}/end-${s}.png`)
await browser.close()
console.log('rendered captions + cards into', OUT)
