// Bundles the server (dist/index.js) and the admin CLI (dist/cli.js) with esbuild.
//   node build.mjs              one-off production build
//   node build.mjs --watch      rebuild on change
//   node build.mjs --watch --run  rebuild on change and (re)start the server (npm run dev)
import { context, build } from 'esbuild'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const watch = process.argv.includes('--watch')
const run = process.argv.includes('--run')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: { index: 'src/index.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  // CommonJS dependencies (nodemailer) call require() for Node built-ins; ESM output needs a real require.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  define: { __VERSION__: JSON.stringify(pkg.version) },
}

if (!watch) {
  await build(options)
} else {
  let child = null
  const stopChild = () =>
    new Promise((resolve) => {
      const c = child
      child = null
      if (!c || c.exitCode !== null || c.signalCode !== null) return resolve()
      c.once('exit', resolve)
      c.kill('SIGTERM')
    })
  // the old server must release the port (and flush its documents) before the new one starts
  const restart = async () => {
    await stopChild()
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--enable-source-maps', 'dist/index.js'], {
      stdio: 'inherit',
      env: { DEV_MODE: '1', ...process.env },
    })
  }
  const ctx = await context({
    ...options,
    plugins: run ? [{ name: 'run', setup: (b) => b.onEnd((r) => { if (!r.errors.length) restart() }) }] : [],
  })
  await ctx.watch()
  const quit = async () => {
    await stopChild()
    await ctx.dispose()
    process.exit(0)
  }
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
}
