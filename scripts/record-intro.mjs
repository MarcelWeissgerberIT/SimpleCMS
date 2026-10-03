#!/usr/bin/env node
/**
 * Renders the first-visit intro (1997 spreadsheet → three hammer hits → shatter → new site)
 * and encodes docs/media/intro.mp4 + docs/media/intro.gif.
 *
 *   npx vite --port 5300 --strictPort &          # dev server (exposes the test hooks)
 *   node scripts/record-intro.mjs http://127.0.0.1:5300 [--lang en|de]
 *
 * The spreadsheet + teasers are sampled in real time. The smash uses the intro's manual clock
 * (?smashclock=manual → window.__oneIntro.advance) and the site entrance is driven through
 * gsap.updateRoot, both stepped in lockstep, so the video is smooth even with software WebGL.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs'

const BASE = (process.argv[2] || 'http://127.0.0.1:5300').replace(/\/$/, '')
const LANG = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'en'
const FPS = 30
const W = 1280
const H = 800
const FRAMES = '.shots/video/frames'
const OUT = 'docs/media'
const SUFFIX = LANG === 'en' ? '' : `-${LANG}`
rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: LANG === 'de' ? 'de-DE' : 'en-US', serviceWorkers: 'block' })
const page = await ctx.newPage()
page.setDefaultTimeout(240_000)
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)))
await page.goto(`${BASE}/?intro&smashclock=manual`, { waitUntil: 'networkidle' })
await page.mouse.move(W - 4, H - 4) // last input: the idle countdown starts now
const t0 = Date.now()
const since = () => (Date.now() - t0) / 1000
const sleepUntil = async (sec) => {
  const ms = sec * 1000 - (Date.now() - t0)
  if (ms > 0) await page.waitForTimeout(ms)
}

let n = 0
const frame = (i) => `${FRAMES}/f${String(i).padStart(5, '0')}.png`
const shot = async () => {
  await page.screenshot({ path: frame(n) })
  return n++
}
const hold = async (sec) => {
  const i = await shot()
  for (let k = 1; k < Math.round(sec * FPS); k++) copyFileSync(frame(i), frame(n++))
}
/** Take `count` screenshots of a live (real-time) state, each held for `framesEach` frames. */
const sample = async (count, framesEach) => {
  for (let c = 0; c < count; c++) {
    const i = await shot()
    for (let k = 1; k < framesEach; k++) copyFileSync(frame(i), frame(n++))
    await page.waitForTimeout(60)
  }
}
const phase = () => page.evaluate(() => window.__oneIntro?.phase?.() ?? 'gone')

// 1 — the 1997 homepage
await page.waitForTimeout(800)
await hold(2.6)
// 2 — "(Not Responding)" at 10 s idle
await sleepUntil(10.2)
await sample(4, 9) // ~1.2 s
// 3 — the rumble at 13 s idle, until the hammer arrives
await sleepUntil(13.1)
await sample(10, 3) // ~1 s of rumble
// Stop screenshotting: the intro warms up the GPU in idle callbacks, which constant
// screenshots would starve. The cut is invisible because the rumble is a loop.
while ((await phase()) === 'watch' && since() < 60) await page.waitForTimeout(250)
console.log('smash at', since().toFixed(1), 's, frames so far', n)

// 4 — the smash, stepped frame by frame; GSAP (site entrance) stepped in lockstep
await page.evaluate(() => {
  const g = window.__gsap
  g.ticker.remove(g.updateRoot)
  window.__rt = g.ticker.time
})
const step = () =>
  page.evaluate((dt) => {
    window.__oneIntro?.advance?.(dt * 1000)
    window.__rt += dt
    window.__gsap.updateRoot(window.__rt)
  }, 1 / FPS)
let guard = 0
while ((await phase()) === 'smashing' && guard++ < 400) {
  await step()
  await shot()
}
console.log('smash frames', guard)
// 5 — the new site finishing its entrance
for (let k = 0; k < Math.round(2.2 * FPS); k++) {
  await step()
  await shot()
}
await hold(1.5)
await browser.close()

console.log('frames:', readdirSync(FRAMES).length)
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${FRAMES}/f%05d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', `${OUT}/intro${SUFFIX}.mp4`])
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}/intro${SUFFIX}.mp4`, '-vf', 'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', `${OUT}/intro${SUFFIX}.gif`])
console.log('wrote', `${OUT}/intro${SUFFIX}.mp4`, `${OUT}/intro${SUFFIX}.gif`)
