import { ConfigError, loadConfig } from './config.ts'
import { createLogger } from './log.ts'
import { startServer } from './server.ts'

const log = createLogger()

try {
  const config = loadConfig()
  const server = await startServer(config, log)

  let stopping = false
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info('shutting down', { signal })
    // documents are flushed to SQLite before exit; never hang a container stop
    setTimeout(() => {
      log.error('shutdown timed out')
      process.exit(1)
    }, 10_000).unref()
    await server.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.on('SIGINT', () => void stop('SIGINT'))
} catch (err) {
  if (err instanceof ConfigError) {
    log.error(`configuration error: ${err.message}`)
    process.exit(78) // EX_CONFIG
  }
  log.error('failed to start', { error: err as Error })
  process.exit(1)
}
