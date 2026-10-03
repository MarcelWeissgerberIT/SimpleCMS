#!/usr/bin/env node
/**
 * Renders the three images for the challenge post (1920×1080 PNG) into docs/media/post/:
 *   01-ugly-1997.png   the 1997 spreadsheet homepage, as visitors first see it (from record-teaser.mjs)
 *   02-the-bill.png    "Notion, rebuilt. Minus the bill." — the cost readout + a real product shot
 *   03-spec-sheet.png  "Everything you use. None of the seats." — the feature spec sheet
 * The new landing site is deliberately not shown: people should see it themselves after 15 seconds.
 *
 *   node scripts/promo/render-post.mjs
 */
import { chromium } from 'playwright'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = 'docs/media/post'
mkdirSync(OUT, { recursive: true })
const file = (p) => `file://${resolve(p)}`
const font = (p) => file(`node_modules/${p}`)

const CSS = `
@font-face { font-family: Archivo; src: url('${font('@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')}') format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
@font-face { font-family: Mono; src: url('${font('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 800; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1920px; height: 1080px; overflow: hidden; }
body { font-family: Archivo, sans-serif; background: #f2f0ea; color: #121210; -webkit-font-smoothing: antialiased; position: relative; }
.mono { font-family: Mono, monospace; text-transform: uppercase; letter-spacing: .08em; }
.sig { color: #ff4f00; }
.display { font-stretch: 125%; font-weight: 820; letter-spacing: -.028em; line-height: .96; }
.led { display: inline-block; width: 11px; height: 11px; border-radius: 50%; background: #ff4f00; box-shadow: 0 0 0 4px rgba(255,79,0,.16); }
.label { font-size: 19px; font-weight: 600; display: flex; align-items: center; gap: 14px; }
.top { position: absolute; left: 72px; right: 72px; top: 40px; display: flex; justify-content: space-between; font-size: 15px; color: #67635b; padding-bottom: 14px; border-bottom: 1px solid rgba(18,18,16,.14); }
.foot { position: absolute; left: 72px; right: 72px; bottom: 40px; height: 64px; display: flex; align-items: center; gap: 20px; border-top: 1px solid rgba(18,18,16,.14); padding-top: 18px; }
.foot .name { font-size: 24px; font-weight: 800; font-stretch: 125%; letter-spacing: -.01em; }
.foot .url { font-family: Mono; font-size: 18px; color: #ff4f00; }
.foot .tags { margin-left: auto; font-size: 15px; color: #67635b; }
.mark { position: absolute; width: 18px; height: 18px; border-color: rgba(18,18,16,.35); border-style: solid; border-width: 0; }
.mark.tl { left: 28px; top: 28px; border-left-width: 1px; border-top-width: 1px; }
.mark.tr { right: 28px; top: 28px; border-right-width: 1px; border-top-width: 1px; }
.mark.bl { left: 28px; bottom: 28px; border-left-width: 1px; border-bottom-width: 1px; }
.mark.br { right: 28px; bottom: 28px; border-right-width: 1px; border-bottom-width: 1px; }
`
const LOGO = (s = 40) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="3" fill="#FF4F00"/><circle cx="7" cy="7" r="2" fill="#121210"/><path d="M13 9.5 18.5 7H21v18h-4.2V12.2L13 13.8z" fill="#121210"/></svg>`
const frame = (fig, rev) => `
<div class="mark tl"></div><div class="mark tr"></div><div class="mark bl"></div><div class="mark br"></div>
<div class="top mono"><span>SimpleCMS One · ${fig}</span><span>${rev}</span></div>
<div class="foot">${LOGO()}<span class="name">SimpleCMS One</span><span class="url">marcelweissgerberit.github.io/SimpleCMS</span>
<span class="tags mono">Free · Local-first · Open source (MIT) · Bring your own Claude key</span></div>`

/* ------------------------------------------------------------------ 02 — the bill */
const bill = `<!doctype html><html><head><style>${CSS}
.left { position: absolute; left: 112px; top: 140px; width: 800px; }
h1 { font-size: 88px; margin: 28px 0 40px; }
.readout { background: #faf9f5; border: 1px solid rgba(18,18,16,.16); border-radius: 4px; padding: 30px 34px 26px; box-shadow: 0 1px 0 rgba(18,18,16,.05); }
.row + .row { margin-top: 30px; }
.row .who { font-size: 15px; color: #55524b; font-weight: 600; }
.row .line { display: flex; align-items: center; gap: 28px; margin-top: 8px; }
.row .line .meter { flex: 1; margin-top: 0; }
.row .val { width: 262px; flex: none; text-align: right; font-size: 60px; font-weight: 820; font-stretch: 125%; letter-spacing: -.02em; line-height: 1; position: relative; }
.row .val.strike::after { content: ''; position: absolute; left: -6px; right: -6px; top: 52%; height: 6px; background: #ff4f00; transform: rotate(-4deg); }
.meter { margin-top: 14px; height: 18px; border: 1px solid rgba(18,18,16,.28); border-radius: 2px; position: relative;
  background-image: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(18,18,16,.22) calc(10% - 1px) 10%); }
.meter .fill { position: absolute; left: 0; top: 0; bottom: 0; background: #121210; }
.meter .zero { position: absolute; left: -2px; top: -6px; bottom: -6px; width: 5px; background: #ff4f00; }
.calc { margin-top: 10px; font-size: 14.5px; color: #67635b; }
.note { margin-top: 22px; padding-top: 18px; border-top: 1px dashed rgba(18,18,16,.2); font-size: 15px; color: #55524b; display: flex; gap: 12px; align-items: center; }
.src { margin-top: 18px; font-size: 13px; color: #67635b; letter-spacing: .04em; }
.right { position: absolute; left: 960px; top: 150px; width: 848px; }
.shot { width: 848px; height: 530px; border: 1px solid rgba(18,18,16,.2); border-radius: 4px; overflow: hidden; box-shadow: 0 30px 60px -30px rgba(18,18,16,.35); background: #faf9f5; }
.shot img { width: 100%; height: 100%; display: block; }
.cap { margin-top: 14px; display: flex; justify-content: space-between; font-size: 14px; color: #67635b; }
.hammer { position: absolute; left: 1556px; top: 736px; width: 250px; transform: rotate(-8deg); filter: drop-shadow(0 26px 30px rgba(18,18,16,.28)); }
.chips { position: absolute; left: 960px; top: 764px; display: flex; gap: 10px; flex-wrap: wrap; width: 560px; }
.chip { font-size: 14px; padding: 8px 12px; border: 1px solid rgba(18,18,16,.22); border-radius: 2px; background: #faf9f5; font-weight: 600; }
.chip b { color: #ff4f00; font-weight: 700; }
</style></head><body>
${frame('Fig. 01 — The bill', 'Rev 2026.10')}
<div class="left">
  <div class="label mono sig"><span class="led"></span>§ 01 — The bill</div>
  <h1 class="display">Notion, rebuilt<span class="sig">.</span><br>Minus the bill<span class="sig">.</span></h1>
  <div class="readout">
    <div class="row">
      <div class="who mono">Notion Business · 10 seats · 12 months</div>
      <div class="line"><div class="meter"><div class="fill" style="width:100%"></div></div><span class="val strike">$2,880</span></div>
      <div class="calc mono">$24 × 10 seats × 12 months · per year, before add-ons</div>
    </div>
    <div class="row">
      <div class="who mono">SimpleCMS One · unlimited people</div>
      <div class="line"><div class="meter"><div class="zero"></div></div><span class="val sig">$0</span></div>
      <div class="calc mono">No seats · no account · no server · no subscription</div>
    </div>
    <div class="note"><span class="led"></span><span>AI included: bring your own Claude key and pay Anthropic only for what you use.</span></div>
  </div>
  <div class="src mono">Notion Business, monthly billing ($20 on yearly billing) · notion.com/pricing, Oct 2026</div>
</div>
<div class="right">
  <div class="shot"><img src="${file('public/assets/shots/database.webp')}"></div>
  <div class="cap mono"><span>Fig. 1 — Projects database · board + side peek</span><span>Runs 100% in your browser</span></div>
</div>
<div class="chips">
  <span class="chip"><b>7</b> database views</span><span class="chip"><b>20</b> property types</span><span class="chip">Relations · rollups · formulas</span>
  <span class="chip">Webhooks → n8n · Make · Zapier</span><span class="chip">Works offline</span>
</div>
<img class="hammer" src="${file('public/assets/icons/hammer.png')}">
</body></html>`

/* ------------------------------------------------------------------ 03 — the spec sheet */
const FEATURES = [
  ['blocks', 'Block editor', 'Slash menu, drag handles, toggles, callouts, code, math, Mermaid diagrams.'],
  ['database', 'Databases', 'Table, board, list, gallery, calendar, timeline, chart. Relations, rollups, formulas.'],
  ['ai', 'Claude, your key', 'Rewrite, summarise, translate, ask your workspace. Pay per use, no plan upgrade.'],
  ['automation', 'Automations', 'Every database fires webhooks into n8n, Make or Zapier. Free.'],
  ['graph', '⌘K, panes, graph', 'One palette for everything, pages side by side, a live graph of every link.'],
  ['import', 'Notion import', 'Drop your Notion export: pages, databases and images move in a minute.'],
  ['publish', 'Share by link', 'The page lives inside the link. No server, no account for the reader.'],
  ['sync', 'Offline & private', 'Local-first in your browser. Version history with no day limit. MIT licence.'],
]
const spec = `<!doctype html><html><head><style>${CSS}
.head { position: absolute; left: 112px; right: 112px; top: 140px; display: flex; justify-content: space-between; align-items: flex-end; }
h1 { font-size: 92px; margin-top: 26px; }
.aside { width: 470px; font-size: 22px; line-height: 1.4; color: #55524b; padding-bottom: 8px; }
.aside b { color: #121210; }
.grid { position: absolute; left: 112px; right: 112px; top: 470px; display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid rgba(18,18,16,.2); border-left: 1px solid rgba(18,18,16,.2); }
.cell { position: relative; height: 222px; padding: 22px 24px 20px 24px; border-right: 1px solid rgba(18,18,16,.2); border-bottom: 1px solid rgba(18,18,16,.2); background: #faf9f5; }
.cell .no { font-size: 14px; color: #67635b; font-weight: 600; }
.cell img { position: absolute; right: 16px; top: 12px; width: 104px; height: 104px; object-fit: contain; filter: drop-shadow(0 10px 12px rgba(18,18,16,.16)); }
.cell h3 { margin-top: 64px; font-size: 27px; font-weight: 800; font-stretch: 125%; letter-spacing: -.015em; }
.cell p { margin-top: 8px; font-size: 17.5px; line-height: 1.38; color: #55524b; max-width: 360px; }
</style></head><body>
${frame('Fig. 02 — Spec sheet', '8 modules · 0 seats')}
<div class="head">
  <div>
    <div class="label mono sig"><span class="led"></span>§ 02 — Spec sheet</div>
    <h1 class="display">Everything you use<span class="sig">.</span><br>None of the seats<span class="sig">.</span></h1>
  </div>
  <div class="aside">A keyboard-first rebuild of the Notion you actually use — <b>plus the things people keep asking Notion for.</b> No account, no server: your data stays in your browser.</div>
</div>
<div class="grid">
${FEATURES.map(([icon, title, text], i) => `<div class="cell"><div class="no mono">${String(i + 1).padStart(2, '0')}</div><img src="${file(`public/assets/icons/${icon}.png`)}"><h3>${title}</h3><p>${text}</p></div>`).join('')}
</div>
</body></html>`

copyFileSync('.shots/promo/teaser/still-normal.png', `${OUT}/01-ugly-1997.png`)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
for (const [name, html] of [['02-the-bill', bill], ['03-spec-sheet', spec]]) {
  writeFileSync(`${OUT}/_tmp.html`, html)
  await page.goto(file(`${OUT}/_tmp.html`), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}
await browser.close()
const { rmSync } = await import('node:fs')
rmSync(`${OUT}/_tmp.html`)
console.log('rendered post images into', OUT)
