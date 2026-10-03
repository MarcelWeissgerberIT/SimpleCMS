#!/usr/bin/env node
/**
 * Renders the promo teaser: the 1997 spreadsheet → "(Not Responding)" → the hammer swings in
 * and lands its FIRST hit — then the video cuts away (the rest is for viewers to discover).
 * Output: .shots/promo/teaser/{still-normal.png, still-hung.png, smash/f#####.png, meta.json}
 *
 *   node scripts/promo/record-teaser.mjs http://127.0.0.1:5300
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const BASE = (process.argv[2] || 'http://127.0.0.1:5300').replace(/\/$/, '')
const OUT = '.shots/promo/teaser'
const FPS = 30
rmSync(OUT, { recursive: true, force: true })
mkdirSync(`${OUT}/smash`, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2, locale: 'en-US', serviceWorkers: 'block' })
const page = await ctx.newPage()
page.setDefaultTimeout(240_000)
await page.goto(`${BASE}/?intro&smashclock=manual`, { waitUntil: 'networkidle' })
await page.mouse.move(1590, 890)
const t0 = Date.now()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/still-normal.png` })
// "(Not Responding)" kicks in after 10 s idle
await page.waitForTimeout(Math.max(0, 10_400 - (Date.now() - t0)))
await page.screenshot({ path: `${OUT}/still-hung.png` })
const phase = () => page.evaluate(() => window.__oneIntro?.phase?.() ?? 'gone')
while ((await phase()) === 'watch' && Date.now() - t0 < 90_000) await page.waitForTimeout(250)
console.log('smash at', ((Date.now() - t0) / 1000).toFixed(1), 's')

// Step the smash: keep going until shortly after the first hit (detected as the white flash).
let n = 0
let hitFrame = -1
const lum = []
for (let i = 0; i < 90; i++) {
  await page.evaluate((ms) => window.__oneIntro?.advance?.(ms), 1000 / FPS)
  const file = `${OUT}/smash/f${String(n).padStart(5, '0')}.png`
  const buf = await page.screenshot({ path: file })
  n++
  // crude brightness probe from the PNG size is unreliable — read it in the page instead
  const l = await page.evaluate(() => {
    const c = document.querySelector('#intro canvas')
    if (!c) return 0
    const g = document.createElement('canvas')
    g.width = 32
    g.height = 18
    const x = g.getContext('2d')
    try {
      x.drawImage(c, 0, 0, 32, 18)
      const d = x.getImageData(0, 0, 32, 18).data
      let s = 0
      for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2]
      return s / (d.length / 4) / 3
    } catch {
      return 0
    }
  })
  lum.push(l)
  if (hitFrame < 0 && i > 5 && l > Math.max(...lum.slice(0, -1)) + 25) hitFrame = n - 1
  if (hitFrame >= 0 && n - 1 >= hitFrame + 14) break
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify({ fps: FPS, frames: n, hitFrame, lum }, null, 1))
console.log('frames', n, 'first hit at frame', hitFrame)
await browser.close()
