import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, linkSync } from 'node:fs'
import { LocalFiles } from '../src/worker/local-files.ts'
import { cleanupAll, tempDir } from './worker-helpers.ts'

after(cleanupAll)
test('source search skips credentials and generated code; range edits preserve the rest of a large file', async () => {
  const root = tempDir('local-files')
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, '.env'), 'UNIQUE_SECRET=needle')
  writeFileSync(join(root, 'node_modules', 'dep.js'), 'needle')
  const source = Array.from({ length: 600 }, (_, i) => `line ${i + 1}: ${i === 450 ? 'needle' : 'source'}`).join('\n')
  writeFileSync(join(root, 'large.ts'), source)
  const files = new LocalFiles(root)
  assert.equal((await files.search('needle')).matches.length, 1)
  await assert.rejects(files.read('.env'))
  const range = await files.read('large.ts', 445, 455)
  assert.equal(range.complete, false)
  await assert.rejects(files.write('large.ts', 'overwritten'))
  await files.edit('large.ts', 'line 451: needle', 'line 451: fixed')
  assert.equal(readFileSync(join(root, 'large.ts'), 'utf8'), source.replace('line 451: needle', 'line 451: fixed'))
})
test('patches reject stale reads, ambiguous text, unseen passages and hard-linked files', async t => {
  const root = tempDir('local-files-stale')
  writeFileSync(join(root, 'code.js'), 'same\nsame\nunique')
  const files = new LocalFiles(root)
  await files.read('code.js', 1, 1)
  await assert.rejects(files.edit('code.js', 'unique', 'unseen'))
  await assert.rejects(files.edit('code.js', 'same', 'ambiguous'))
  await files.read('code.js')
  writeFileSync(join(root, 'code.js'), 'external edit')
  await assert.rejects(files.edit('code.js', 'same', 'stale'))
  await assert.rejects(files.write('code.js', 'stale'))
  assert.equal(readFileSync(join(root, 'code.js'), 'utf8'), 'external edit')
  try { linkSync(join(root, 'code.js'), join(root, 'linked.js')) } catch { t.diagnostic('Hard links unavailable on this filesystem'); return }
  await assert.rejects(files.read('linked.js'))
  await assert.rejects(files.write('linked.js', 'no'))
})

test('automatic project excerpts do not grant replacement rights; concurrent new files are exclusive', async () => {
  const root = tempDir('local-files-project')
  writeFileSync(join(root, 'README.md'), 'Project instructions that need an explicit read before edits.')
  const files = new LocalFiles(root)
  assert.match(await files.projectContext(), /Project instructions/)
  await assert.rejects(files.write('README.md', 'unseen replacement'))
  const writes = await Promise.allSettled([files.write('new.txt', 'first'), files.write('new.txt', 'second')])
  assert.equal(writes.filter(w => w.status === 'fulfilled').length, 1)
  assert.ok(['first', 'second'].includes(readFileSync(join(root, 'new.txt'), 'utf8')))
})
