// Copies emojibase-data (used by the emoji picker) into public/ so the app works offline.
import { cpSync, mkdirSync } from 'node:fs'
for (const l of ['en', 'de']) {
  mkdirSync(`public/vendor/emojibase-data/${l}`, { recursive: true })
  for (const f of ['data.json', 'messages.json']) cpSync(`node_modules/emojibase-data/${l}/${f}`, `public/vendor/emojibase-data/${l}/${f}`)
}
