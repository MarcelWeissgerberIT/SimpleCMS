/**
 * Encryption at rest (docs/CLOUD.md § Tenancy & encryption at rest): one data key per workspace,
 * wrapped by DATA_KEY. Documents, files, file names and kept API answers are ciphertext on disk and in
 * SQLite, plaintext through the API and the WebSocket; nonces never repeat; a ciphertext moved to
 * another document or workspace does not decrypt; data from before encryption is sealed; deleting a
 * workspace shreds its key; DATA_KEY rotates without touching content; production needs DATA_KEY; raw
 * secrets (sign-in links, sessions, invites, API tokens, hook URLs) are never in the database or the log.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import * as Y from 'yjs'
import { DecryptError, deriveWorkspaceKey, docContext, fileContext, HEADER_BYTES, newDataKey, open, seal, unwrapKey, wrapKey } from '../src/crypto/aead.ts'
import { Keyring } from '../src/crypto/keyring.ts'
import { openDb } from '../src/db/index.ts'
import { migrations } from '../src/db/migrations.ts'
import { Repo } from '../src/repo.ts'
import { Client, decodeMail, flushed, openDoc, runServerExpectingExit, signIn, sleep, smtpSink, startServer, TEST_DATA_KEY, tempDir, type TestServer, waitFor } from './helpers.ts'

const CLI = new URL('../dist/cli.js', import.meta.url).pathname
/** A second FAKE master key (rotation tests): 32 ASCII bytes that say what they are. */
const TEST_DATA_KEY_2 = Buffer.from('test-only-rotated-key-not-real!!', 'utf8').toString('base64')
const keyBytes = (b64: string) => Buffer.from(b64, 'base64')

/* ------------------------------------------------------------------ fixtures */

function pageEntry(fields: Record<string, unknown>): Y.Map<unknown> {
  const yp = new Y.Map<unknown>()
  const at = Date.now()
  const all = { kind: 'page', title: '', icon: null, cover: null, parentId: null, databaseId: null, order: 1, trashed: false, trashedAt: null, createdAt: at, updatedAt: at, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false }, plain: '', ...fields }
  for (const [k, v] of Object.entries(all)) yp.set(k, v)
  yp.set('properties', new Y.Map<unknown>())
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

/** A database "Tasks <marker>" (db-1) with a row, and a page "Page <marker>" (page-1). */
function seedMeta(doc: Y.Doc, marker: string) {
  doc.transact(() => {
    const pages = doc.getMap('pages')
    pages.set('db-1', pageEntry({ kind: 'database', title: `Tasks ${marker}` }))
    const ydb = new Y.Map<unknown>()
    const props = new Y.Map<unknown>()
    props.set('t-title', { id: 't-title', name: 'Name', type: 'title', order: 0 })
    ydb.set('properties', props)
    ydb.set('views', new Y.Map<unknown>())
    ydb.set('nextUniqueId', 1)
    doc.getMap('databases').set('db-1', ydb)
    pages.set('row-1', pageEntry({ title: `Row ${marker}`, parentId: 'db-1', databaseId: 'db-1' }))
    pages.set('page-1', pageEntry({ title: `Page ${marker}`, plain: `plain ${marker}` }))
  })
}

const writeText = (doc: Y.Doc, text: string) =>
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText(text)])
    doc.getXmlFragment('default').insert(0, [p])
  })

const textOf = (doc: Y.Doc) => doc.getXmlFragment('default').toString()

/** Every byte the server keeps: the SQLite file (+ WAL / shared memory) and everything under files/. */
function diskBytes(dataDir: string): Array<{ path: string; bytes: Buffer }> {
  const out: Array<{ path: string; bytes: Buffer }> = []
  for (const name of ['one.sqlite', 'one.sqlite-wal', 'one.sqlite-shm']) {
    const p = join(dataDir, name)
    if (existsSync(p)) out.push({ path: p, bytes: readFileSync(p) })
  }
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else out.push({ path: p, bytes: readFileSync(p) })
    }
  }
  walk(join(dataDir, 'files'))
  return out
}

/** Where `needle` occurs on disk (as UTF-8 and as UTF-16, the way strings could be stored). */
function foundOnDisk(dataDir: string, needle: string): string[] {
  const forms = [Buffer.from(needle, 'utf8'), Buffer.from(needle, 'utf16le')]
  return diskBytes(dataDir)
    .filter((f) => forms.some((n) => f.bytes.includes(n)))
    .map((f) => f.path)
}

const cli = (dataDir: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env: { PATH: process.env.PATH ?? '', DATA_DIR: dataDir, ...env }, encoding: 'utf8' })

const bearer = (server: TestServer, token: string, path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}) =>
  fetch(server.url + path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.json ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.json ? JSON.stringify(init.json) : undefined,
  })

/** A workspace with content: meta document, a page's content, a file (named after the marker), an API answer. */
async function fillWorkspace(server: TestServer, owner: Client, wsId: string, marker: string): Promise<{ token: string; rowId: string }> {
  const meta = openDoc(server, owner, `ws:${wsId}`)
  const page = openDoc(server, owner, `ws:${wsId}:p:page-1`)
  try {
    await Promise.all([meta.synced, page.synced])
    seedMeta(meta.doc, marker)
    writeText(page.doc, `secret text ${marker}`)
    await Promise.all([flushed(meta), flushed(page)])
  } finally {
    meta.destroy()
    page.destroy()
  }
  const up = await owner.fetch(`/api/workspaces/${wsId}/files/file-1`, {
    method: 'PUT',
    body: `file body ${marker} `.repeat(500),
    headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent(`notes ${marker}.txt`) },
  })
  assert.equal(up.status, 201)
  const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Writer', scope: 'write' })).body.token as string
  const row = await bearer(server, token, '/api/v1/databases/db-1/rows', { method: 'POST', json: { title: `API row ${marker}` }, headers: { 'idempotency-key': 'k-1' } })
  assert.equal(row.status, 201)
  return { token, rowId: ((await row.json()) as { id: string }).id }
}

/** Reads everything fillWorkspace wrote back through the API, the WebSocket and the file route. */
async function readWorkspace(server: TestServer, owner: Client, wsId: string, { token, rowId }: { token: string; rowId: string }, marker: string) {
  const d = openDoc(server, owner, `ws:${wsId}:p:page-1`)
  try {
    await d.synced
    assert.match(textOf(d.doc), new RegExp(`secret text ${marker}`))
  } finally {
    d.destroy()
  }
  const page = await (await bearer(server, token, '/api/v1/pages/page-1')).json() as { title: string; text: string }
  assert.equal(page.title, `Page ${marker}`)
  assert.match(page.text, new RegExp(`secret text ${marker}`))
  const file = await owner.fetch(`/api/workspaces/${wsId}/files/file-1`)
  assert.equal(file.status, 200)
  assert.equal(await file.text(), `file body ${marker} `.repeat(500))
  assert.match(file.headers.get('content-disposition') ?? '', new RegExp(`notes%20${marker}\\.txt`))
  // the kept answer of the create request replays (decrypted), and the row it created reads
  const replay = await bearer(server, token, '/api/v1/databases/db-1/rows', { method: 'POST', json: { title: `API row ${marker}` }, headers: { 'idempotency-key': 'k-1' } })
  assert.equal(replay.headers.get('idempotent-replayed'), 'true')
  assert.equal(((await replay.json()) as { id: string }).id, rowId)
  const row = (await (await bearer(server, token, `/api/v1/rows/${rowId}`)).json()) as { title: string }
  assert.equal(row.title, `API row ${marker}`)
}

/* ------------------------------------------------------------------ the format */

describe('envelope', () => {
  test('a fresh 96-bit nonce for every seal: the same plaintext never gives the same ciphertext', () => {
    const key = newDataKey()
    const nonces = new Set<string>()
    const bodies = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      const c = seal(key, Buffer.from('the same plaintext'), docContext('ws:x'))
      assert.equal(c[0], 0x01, 'version byte')
      nonces.add(c.subarray(1, HEADER_BYTES).toString('hex'))
      bodies.add(c.subarray(HEADER_BYTES).toString('hex'))
    }
    assert.equal(nonces.size, 5000)
    assert.equal(bodies.size, 5000)
  })

  test('bound to its place (AAD), its key and its bytes', () => {
    const key = newDataKey()
    const c = seal(key, Buffer.from('payload'), docContext('ws:aaaaaaaa:p:one'))
    assert.equal(open(key, c, docContext('ws:aaaaaaaa:p:one')).toString(), 'payload')
    assert.throws(() => open(key, c, docContext('ws:aaaaaaaa:p:two')), DecryptError, 'another document')
    assert.throws(() => open(key, c, docContext('ws:bbbbbbbb:p:one')), DecryptError, 'another workspace')
    assert.throws(() => open(newDataKey(), c, docContext('ws:aaaaaaaa:p:one')), DecryptError, 'another key')
    const flipped = Buffer.from(c)
    flipped[HEADER_BYTES] = flipped[HEADER_BYTES]! ^ 1
    assert.throws(() => open(key, flipped, docContext('ws:aaaaaaaa:p:one')), DecryptError, 'a changed byte')
    const v2 = Buffer.from(c)
    v2[0] = 2
    assert.throws(() => open(key, v2, docContext('ws:aaaaaaaa:p:one')), /unknown ciphertext format/)
    // a workspace key unwraps only for its own workspace
    const kek = keyBytes(TEST_DATA_KEY)
    const wrapped = wrapKey(kek, key, 'ws-one-0001')
    assert.deepEqual(unwrapKey(kek, wrapped, 'ws-one-0001'), key)
    assert.throws(() => unwrapKey(kek, wrapped, 'ws-two-0002'), DecryptError)
    assert.throws(() => unwrapKey(keyBytes(TEST_DATA_KEY_2), wrapped, 'ws-one-0001'), DecryptError)
  })
})

/* ------------------------------------------------------------------ at rest */

describe('at rest', () => {
  test('documents, files, file names and API answers are ciphertext on disk — plaintext through API and WebSocket', async () => {
    const MARKER = 'confidential-c1a9e'
    let server = await startServer({ API_RATE_LIMIT: '1000' })
    const dataDir = server.dataDir
    const owner = await signIn(server, 'rest@crypt.test')
    const wsId = (await owner.post('/api/workspaces', { name: 'Crypt Works' })).body.id
    const filled = await fillWorkspace(server, owner, wsId, MARKER)
    assert.equal(await server.stop(), 0)

    // the search works: plain metadata (the workspace's name) is found, the content is not
    assert.ok(foundOnDisk(dataDir, 'Crypt Works').length > 0, 'sanity: the grep finds what is stored in the clear')
    assert.deepEqual(foundOnDisk(dataDir, MARKER), [], 'no content in the clear anywhere on disk')
    const raw = new DatabaseSync(join(dataDir, 'one.sqlite'), { readOnly: true })
    const docs = raw.prepare('SELECT name, data, enc FROM documents WHERE workspace_id = ?').all(wsId) as Array<{ name: string; data: Uint8Array; enc: number }>
    const files = raw.prepare('SELECT name, sha256, enc FROM files WHERE workspace_id = ?').all(wsId) as Array<{ name: string; sha256: string; enc: number }>
    const answers = raw.prepare('SELECT body FROM idempotency WHERE workspace_id = ?').all(wsId) as Array<{ body: string }>
    raw.close()
    assert.deepEqual(docs.map((d) => [d.name, d.enc, d.data[0]]).sort(), [[`ws:${wsId}`, 1, 1], [`ws:${wsId}:p:page-1`, 1, 1]])
    assert.equal(new Set(docs.map((d) => Buffer.from(d.data).subarray(1, HEADER_BYTES).toString('hex'))).size, docs.length, 'every row its own nonce')
    assert.equal(files.length, 1)
    assert.match(files[0]!.name, /^v1\./, 'the file name is sealed')
    assert.equal(files[0]!.enc, 1)
    assert.match(answers[0]!.body, /^v1\./, 'the kept API answer is sealed')
    assert.deepEqual(readdirSync(join(dataDir, 'files', wsId)), ['file-1.enc'])

    // everything reads back after a restart (same DATA_DIR, same dev-data-key)
    server = await startServer({ API_RATE_LIMIT: '1000' }, dataDir)
    try {
      const again = new Client(server.url)
      for (const [k, v] of owner.cookies) again.cookies.set(k, v)
      await readWorkspace(server, again, wsId, filled, MARKER)
    } finally {
      await server.stop()
    }
  })

  test('a ciphertext moved to another document or workspace is refused, never served or overwritten', async () => {
    let server = await startServer()
    const dataDir = server.dataDir
    const owner = await signIn(server, 'swap@crypt.test')
    const a = (await owner.post('/api/workspaces', { name: 'Swap A' })).body.id
    const b = (await owner.post('/api/workspaces', { name: 'Swap B' })).body.id
    for (const [ws, page, text] of [[a, 'one', 'A one'], [a, 'two', 'A two'], [b, 'one', 'B one']] as const) {
      const d = openDoc(server, owner, `ws:${ws}:p:${page}`)
      await d.synced
      writeText(d.doc, text)
      await flushed(d)
      d.destroy()
    }
    await owner.fetch(`/api/workspaces/${b}/files/f-b`, { method: 'PUT', body: 'bytes of B', headers: { 'content-type': 'text/plain' } })
    await owner.fetch(`/api/workspaces/${a}/files/f-a`, { method: 'PUT', body: 'bytes of A', headers: { 'content-type': 'text/plain' } })
    await server.stop()

    // swap at rest: B's page into A's row (other workspace), A's page one into A's page two (other document)
    const raw = new DatabaseSync(join(dataDir, 'one.sqlite'))
    const get = (name: string) => (raw.prepare('SELECT data FROM documents WHERE name = ?').get(name) as { data: Uint8Array }).data
    raw.prepare('UPDATE documents SET data = ? WHERE name = ?').run(get(`ws:${b}:p:one`), `ws:${a}:p:one`)
    raw.prepare('UPDATE documents SET data = ? WHERE name = ?').run(get(`ws:${a}:p:one`), `ws:${a}:p:two`)
    const swapped = Buffer.from(get(`ws:${a}:p:two`))
    raw.close()
    copyFileSync(join(dataDir, 'files', b, 'f-b.enc'), join(dataDir, 'files', a, 'f-a.enc'))

    server = await startServer({}, dataDir)
    try {
      const c = new Client(server.url)
      for (const [k, v] of owner.cookies) c.cookies.set(k, v)
      for (const page of ['one', 'two']) {
        const d = openDoc(server, c, `ws:${a}:p:${page}`)
        const synced = await Promise.race([d.synced.then(() => true), sleep(1500).then(() => false)])
        d.destroy()
        assert.equal(synced, false, `ws:${a}:p:${page} must not open with a foreign ciphertext`)
      }
      await waitFor(() => /document cannot be decrypted/.test(server.logs()), 3000, 'the refusal is logged')
      const file = await c.fetch(`/api/workspaces/${a}/files/f-a`)
      assert.equal(file.status, 500)
      assert.doesNotMatch(await file.text(), /bytes of B/)
      // B's own copies still read
      const ok = openDoc(server, c, `ws:${b}:p:one`)
      await ok.synced
      assert.match(textOf(ok.doc), /B one/)
      ok.destroy()
      assert.equal(await (await c.fetch(`/api/workspaces/${b}/files/f-b`)).text(), 'bytes of B')
    } finally {
      await server.stop()
    }
    // nothing was overwritten with an empty document
    const after = new DatabaseSync(join(dataDir, 'one.sqlite'), { readOnly: true })
    assert.deepEqual(Buffer.from((after.prepare('SELECT data FROM documents WHERE name = ?').get(`ws:${a}:p:two`) as { data: Uint8Array }).data), swapped)
    after.close()
  })
})

/* ------------------------------------------------------------------ upgrade */

/**
 * A database as a server from before encryption left it (schema v4): one owner, one workspace, a meta
 * and a page document, a file and a kept API answer — all in plaintext.
 */
function legacyDataDir(marker: string): { dataDir: string; wsId: string; email: string; meta: Uint8Array } {
  const dataDir = tempDir()
  const db = new DatabaseSync(join(dataDir, 'one.sqlite'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
  for (const m of migrations.filter((m) => m.version <= 4)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now())
  }
  const now = Date.now()
  const wsId = 'legacyws-0001'
  const email = 'legacy@crypt.test'
  db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run('legacy-user-1', email, 'Lena', now)
  db.prepare('INSERT INTO workspaces (id, name, icon, created_at, created_by, plan) VALUES (?, ?, NULL, ?, ?, ?)').run(wsId, 'Old Times', now, 'legacy-user-1', 'free')
  db.prepare("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(wsId, 'legacy-user-1', now)
  const meta = new Y.Doc()
  seedMeta(meta, marker)
  const page = new Y.Doc()
  writeText(page, `secret text ${marker}`)
  const metaState = Y.encodeStateAsUpdate(meta)
  db.prepare('INSERT INTO documents (name, workspace_id, data, updated_at) VALUES (?, ?, ?, ?)').run(`ws:${wsId}`, wsId, metaState, now)
  db.prepare('INSERT INTO documents (name, workspace_id, data, updated_at) VALUES (?, ?, ?, ?)').run(`ws:${wsId}:p:page-1`, wsId, Y.encodeStateAsUpdate(page), now)
  const bytes = Buffer.from(`file body ${marker} `.repeat(500))
  mkdirSync(join(dataDir, 'files', wsId), { recursive: true })
  writeFileSync(join(dataDir, 'files', wsId, 'file-1'), bytes)
  db.prepare('INSERT INTO files (id, workspace_id, name, mime, size, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'file-1', wsId, `notes ${marker}.txt`, 'text/plain', bytes.length, 'ab'.repeat(32), 'legacy-user-1', now,
  )
  db.prepare('INSERT INTO idempotency (scope, key, workspace_id, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'token:old', 'k-old', wsId, 201, JSON.stringify({ id: 'row-x', title: `API row ${marker}` }), now,
  )
  db.close()
  return { dataDir, wsId, email, meta: metaState }
}

describe('upgrade from plaintext', () => {
  test('until sealed, stored plaintext still reads', () => {
    const { dataDir, wsId, meta } = legacyDataDir('legacy-read-1')
    const db = openDb(join(dataDir, 'one.sqlite'))
    try {
      const repo = new Repo(db, Buffer.alloc(32), new Keyring(db, keyBytes(TEST_DATA_KEY)))
      assert.deepEqual(Buffer.from(repo.loadDocument(`ws:${wsId}`)!), Buffer.from(meta))
      assert.equal(repo.file(wsId, 'file-1')?.name, 'notes legacy-read-1.txt')
      assert.match(repo.idempotent('token:old', 'k-old', 0)!.body, /legacy-read-1/)
    } finally {
      db.close()
    }
  })

  test('the server seals everything at startup (rows before listening, files in the background)', async () => {
    const MARKER = 'legacy-seal-77ab'
    const { dataDir, wsId, email } = legacyDataDir(MARKER)
    assert.ok(foundOnDisk(dataDir, MARKER).length > 0)
    let server = await startServer({ API_RATE_LIMIT: '1000' }, dataDir)
    await waitFor(() => existsSync(join(dataDir, 'files', wsId, 'file-1.enc')) && !existsSync(join(dataDir, 'files', wsId, 'file-1')), 5000, 'the file sealed')
    await sleep(200)
    assert.equal(await server.stop(), 0)
    assert.deepEqual(foundOnDisk(dataDir, MARKER), [], 'nothing of the old content is left in the clear')
    assert.match(server.logs(), /sealed stored data/)

    server = await startServer({ API_RATE_LIMIT: '1000' }, dataDir)
    try {
      const owner = await signIn(server, email)
      // owners from before already had a workspace: no extra personal space for them
      assert.deepEqual(((await owner.get('/api/me')).body.workspaces as Array<{ id: string }>).map((w) => w.id), [wsId])
      const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Reader', scope: 'write' })).body.token
      const d = openDoc(server, owner, `ws:${wsId}:p:page-1`)
      await d.synced
      assert.match(textOf(d.doc), new RegExp(`secret text ${MARKER}`))
      d.destroy()
      const page = (await (await bearer(server, token, '/api/v1/pages/page-1')).json()) as { title: string }
      assert.equal(page.title, `Page ${MARKER}`)
      const file = await owner.fetch(`/api/workspaces/${wsId}/files/file-1`)
      assert.equal(await file.text(), `file body ${MARKER} `.repeat(500))
      assert.match(file.headers.get('etag') ?? '', /^"[0-9a-f]{64}"$/)
      assert.notEqual(file.headers.get('etag'), `"${'ab'.repeat(32)}"`, 'the plain content hash is gone too')
    } finally {
      await server.stop()
    }
  })

  test('encrypt-all does the same from the CLI, idempotently', () => {
    const MARKER = 'legacy-cli-90de'
    const { dataDir, wsId } = legacyDataDir(MARKER)
    const env = { DATA_KEY: TEST_DATA_KEY }
    const first = cli(dataDir, ['encrypt-all'], env)
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /sealed: 2 document\(s\), 1 file\(s\), 1 API answer\(s\); 1 workspace key\(s\) created/)
    assert.match(first.stdout, /everything is encrypted at rest/)
    assert.deepEqual(foundOnDisk(dataDir, MARKER), [])
    const second = cli(dataDir, ['encrypt-all'], env)
    assert.match(second.stdout, /sealed: 0 document\(s\), 0 file\(s\), 0 API answer\(s\); 0 workspace key\(s\) created/)
    // and it reads with that key
    const db = openDb(join(dataDir, 'one.sqlite'))
    try {
      const repo = new Repo(db, Buffer.alloc(32), new Keyring(db, keyBytes(TEST_DATA_KEY)))
      const doc = new Y.Doc()
      Y.applyUpdate(doc, repo.loadDocument(`ws:${wsId}:p:page-1`)!)
      assert.match(textOf(doc), new RegExp(MARKER))
      assert.equal(repo.file(wsId, 'file-1')?.name, `notes ${MARKER}.txt`)
    } finally {
      db.close()
    }
  })
})

/* ------------------------------------------------------------------ keys */

describe('keys', () => {
  test('deleting a workspace shreds its key: what is left of it cannot be decrypted', async () => {
    const server = await startServer({ DATA_KEY: TEST_DATA_KEY })
    const dataDir = server.dataDir
    const owner = await signIn(server, 'shred@crypt.test')
    const doomed = (await owner.post('/api/workspaces', { name: 'Doomed' })).body.id
    const d = openDoc(server, owner, `ws:${doomed}:p:p1`)
    await d.synced
    writeText(d.doc, 'to be forgotten')
    await flushed(d)
    d.destroy()
    await owner.fetch(`/api/workspaces/${doomed}/files/f1`, { method: 'PUT', body: 'forgotten bytes', headers: { 'content-type': 'text/plain' } })
    await waitFor(() => {
      const raw = new DatabaseSync(join(dataDir, 'one.sqlite'), { readOnly: true })
      try {
        return !!raw.prepare('SELECT 1 FROM documents WHERE name = ?').get(`ws:${doomed}:p:p1`)
      } finally {
        raw.close()
      }
    }, 5000, 'the document stored')

    // what an attacker might still find later: copies of the rows and of files/ (old disk blocks, file backups)
    const raw = new DatabaseSync(join(dataDir, 'one.sqlite'), { readOnly: true })
    const wrapped = Buffer.from((raw.prepare('SELECT wrapped FROM workspace_keys WHERE workspace_id = ?').get(doomed) as { wrapped: Uint8Array }).wrapped)
    const docCipher = Buffer.from((raw.prepare('SELECT data FROM documents WHERE name = ?').get(`ws:${doomed}:p:p1`) as { data: Uint8Array }).data)
    raw.close()
    const fileCipher = readFileSync(join(dataDir, 'files', doomed, 'f1.enc'))

    assert.equal((await owner.del(`/api/workspaces/${doomed}`)).status, 204)
    assert.equal(existsSync(join(dataDir, 'files', doomed)), false)
    await server.stop()

    // the key row is gone — not even its old bytes are left in the database file (secure_delete + checkpoint)
    const files = diskBytes(dataDir)
    assert.equal(files.some((f) => f.bytes.includes(wrapped)), false, 'the wrapped key is wiped from the database file')
    const db = openDb(join(dataDir, 'one.sqlite'))
    try {
      assert.equal(db.get('SELECT 1 AS x FROM workspace_keys WHERE workspace_id = ?', doomed), undefined)
      const keyring = new Keyring(db, keyBytes(TEST_DATA_KEY))
      assert.equal(keyring.forWorkspace(doomed), null, 'no key is made for a workspace that is gone')
      // no key that is left opens the leftovers
      const rows = db.all<{ workspace_id: string; wrapped: Uint8Array }>('SELECT workspace_id, wrapped FROM workspace_keys')
      assert.ok(rows.length > 0, 'other workspaces keep their keys')
      for (const r of rows) {
        const key = deriveWorkspaceKey(unwrapKey(keyBytes(TEST_DATA_KEY), r.wrapped, r.workspace_id))
        assert.throws(() => open(key.aead, docCipher, docContext(`ws:${doomed}:p:p1`)), DecryptError)
        assert.throws(() => open(key.aead, fileCipher, fileContext(doomed, 'f1')), DecryptError)
      }
    } finally {
      db.close()
    }
  })

  test('rotate-data-key re-wraps every workspace key; the content stays as it is', async () => {
    const MARKER = 'rotate-31f0'
    let server = await startServer({ DATA_KEY: TEST_DATA_KEY, API_RATE_LIMIT: '1000' })
    const dataDir = server.dataDir
    const owner = await signIn(server, 'rotate@crypt.test')
    const wsId = (await owner.post('/api/workspaces', { name: 'Rotating' })).body.id
    const filled = await fillWorkspace(server, owner, wsId, MARKER)

    // not while the server runs
    const busy = cli(dataDir, ['rotate-data-key'], { DATA_KEY: TEST_DATA_KEY, NEW_DATA_KEY: TEST_DATA_KEY_2 })
    assert.equal(busy.status, 1)
    assert.match(busy.stderr, /the server is running/)
    await server.stop()

    const snapshot = () => {
      const raw = new DatabaseSync(join(dataDir, 'one.sqlite'), { readOnly: true })
      try {
        return {
          docs: raw.prepare('SELECT name, hex(data) AS data FROM documents ORDER BY name').all(),
          keys: raw.prepare('SELECT workspace_id, hex(wrapped) AS wrapped, kek_id FROM workspace_keys ORDER BY workspace_id').all() as Array<{ wrapped: string; kek_id: string }>,
        }
      } finally {
        raw.close()
      }
    }
    const before = snapshot()
    const rotated = cli(dataDir, ['rotate-data-key'], { DATA_KEY: TEST_DATA_KEY, NEW_DATA_KEY: TEST_DATA_KEY_2 })
    assert.equal(rotated.status, 0, rotated.stderr)
    assert.match(rotated.stdout, new RegExp(`re-wrapped ${before.keys.length} workspace key\\(s\\)`))
    const after = snapshot()
    assert.deepEqual(after.docs, before.docs, 'documents are not re-encrypted')
    assert.equal(after.keys.length, before.keys.length)
    for (let i = 0; i < after.keys.length; i++) {
      assert.notEqual(after.keys[i]!.wrapped, before.keys[i]!.wrapped)
      assert.notEqual(after.keys[i]!.kek_id, before.keys[i]!.kek_id)
    }
    const again = cli(dataDir, ['rotate-data-key'], { DATA_KEY: TEST_DATA_KEY, NEW_DATA_KEY: TEST_DATA_KEY_2 })
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, new RegExp(`re-wrapped 0 workspace key\\(s\\) \\(${before.keys.length} already used the new key\\)`))

    // the old key no longer opens this database: refused at startup, with what to do
    const old = await runServerExpectingExit({ DATA_DIR: dataDir, DEV_MODE: '1', DATA_KEY: TEST_DATA_KEY })
    assert.equal(old.code, 78)
    assert.match(old.output, /DATA_KEY \(key id [0-9a-f]{16}\) is not the key this database's workspace keys are wrapped with/)

    server = await startServer({ DATA_KEY: TEST_DATA_KEY_2, API_RATE_LIMIT: '1000' }, dataDir)
    try {
      const c = new Client(server.url)
      for (const [k, v] of owner.cookies) c.cookies.set(k, v)
      await readWorkspace(server, c, wsId, filled, MARKER)
    } finally {
      await server.stop()
    }
  })

  test('production refuses to start without DATA_KEY (and says how to make one)', async () => {
    const base = { NODE_ENV: 'production', DATA_DIR: tempDir(), PUBLIC_URL: 'https://cloud.example.com', SECRET: 'c'.repeat(64) }
    const missing = await runServerExpectingExit(base)
    assert.equal(missing.code, 78)
    assert.match(missing.output, /DATA_KEY is required in production/)
    assert.match(missing.output, /openssl rand -base64 32/)
    const short = await runServerExpectingExit({ ...base, DATA_KEY: 'too-short' })
    assert.equal(short.code, 78)
    assert.match(short.output, /DATA_KEY must be exactly 32 random bytes/)
    const sameAsSecret = await runServerExpectingExit({ ...base, DATA_KEY: 'c'.repeat(64) })
    assert.equal(sameAsSecret.code, 78)
    assert.match(sameAsSecret.output, /must not be the same as SECRET/)
    // development: a key is generated once into DATA_DIR/dev-data-key and reused
    const dev = await startServer()
    const devKey = readFileSync(join(dev.dataDir, 'dev-data-key'), 'utf8')
    assert.equal(keyBytes(devKey).length, 32)
    assert.equal((statSync(join(dev.dataDir, 'dev-data-key')).mode & 0o777).toString(8), '600')
    await dev.stop()
    const devAgain = await startServer({}, dev.dataDir)
    await devAgain.stop()
    assert.equal(readFileSync(join(dev.dataDir, 'dev-data-key'), 'utf8'), devKey)
  })
})

/* ------------------------------------------------------------------ secrets */

describe('secrets', () => {
  test('raw sign-in, session, invite, API and hook secrets never reach the database or the log', async () => {
    const sink = await smtpSink()
    // like a deployment: real SMTP, no DEV_MODE (dev-mail mode would log mail links on purpose)
    const server = await startServer({ DEV_MODE: '', SMTP_URL: `smtp://127.0.0.1:${sink.port}`, LOG_LEVEL: 'debug', API_RATE_LIMIT: '1000' })
    const secrets: Array<[string, string]> = []
    const mailTo = async (email: string, pattern: RegExp, count: number) => {
      await waitFor(() => sink.mails.filter((m) => m.includes(email)).length >= count, 5000, `mail to ${email}`)
      const text = decodeMail(sink.mails.filter((m) => m.includes(email)).at(-1)!)
      const m = pattern.exec(text)
      assert.ok(m, `no link in the mail: ${text.slice(0, 400)}`)
      return m[1]!
    }
    const signInBySmtp = async (email: string, extra: Record<string, unknown> = {}, count = 1) => {
      const c = new Client(server.url)
      assert.equal((await c.post('/api/auth/request', { email, ...extra })).status, 204)
      secrets.push(['login cookie', c.cookies.get('one_login')!])
      const token = await mailTo(email, /\/api\/auth\/verify\?token=([A-Za-z0-9_-]{43})/, count)
      secrets.push(['magic-link token', token])
      assert.equal((await c.fetch(`/api/auth/verify?token=${token}`)).status, 302)
      secrets.push(['session', c.cookies.get('one_session')!])
      return c
    }
    try {
      const owner = await signInBySmtp('owner@secrets.test')
      const ws = (await owner.post('/api/workspaces', { name: 'Secrets' })).body.id
      const meta = openDoc(server, owner, `ws:${ws}`)
      await meta.synced
      seedMeta(meta.doc, 'secrets')
      await flushed(meta)
      meta.destroy()

      const linkInvite = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member' })).body.link.split('#/invite/')[1]
      secrets.push(['invite (link)', linkInvite])
      await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member', email: 'guest@secrets.test' })
      const mailedInvite = await mailTo('guest@secrets.test', /#\/invite\/([A-Za-z0-9_-]{43})/, 1)
      secrets.push(['invite (mail)', mailedInvite])
      const guest = await signInBySmtp('guest@secrets.test', { invite: mailedInvite, redirect: `/app/#/invite/${mailedInvite}` }, 2)
      assert.equal((await guest.get(`/api/invites/${mailedInvite}`)).status, 200)
      assert.equal((await guest.post(`/api/invites/${mailedInvite}/accept`)).status, 200)

      const api = (await owner.post(`/api/workspaces/${ws}/tokens`, { name: 'Zap', scope: 'write' })).body.token
      secrets.push(['API token', api])
      assert.equal((await bearer(server, api, '/api/v1/workspace')).status, 200)
      assert.equal((await bearer(server, `${api.slice(0, -2)}xx`, '/api/v1/workspace')).status, 401)
      const mcp = await bearer(server, api, '/mcp', { method: 'POST', json: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers: { accept: 'application/json, text/event-stream' } })
      assert.equal(mcp.status, 200)
      const hook = (await owner.post(`/api/workspaces/${ws}/hooks`, { databaseId: 'db-1' })).body
      const hookSecret = hook.url.split('/hooks/')[1]
      secrets.push(['hook secret', hookSecret])
      const delivered = await fetch(`${server.url}/api/v1/hooks/${hookSecret}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Name: 'from a hook' }) })
      assert.equal(delivered.status, 201)
      const rotated = (await owner.post(`/api/workspaces/${ws}/hooks/${hook.id}/regenerate`)).body.url.split('/hooks/')[1]
      secrets.push(['hook secret (regenerated)', rotated])
      assert.equal((await fetch(`${server.url}/api/v1/hooks/${hookSecret}`)).status, 404)
      assert.equal((await owner.post('/api/auth/logout')).status, 204)
      await sleep(200)
    } finally {
      await server.stop()
      await sink.close()
    }

    const log = server.logs()
    assert.match(log, /listening/, 'sanity: the log was captured')
    assert.doesNotMatch(log, /mail \(dev\)/, 'mails went out over SMTP')
    for (const [what, secret] of secrets) {
      assert.ok(secret && secret.length >= 32, `${what} captured`)
      assert.equal(log.includes(secret), false, `${what} is in the log`)
      assert.deepEqual(foundOnDisk(server.dataDir, secret), [], `${what} is stored in the clear`)
    }
  })
})

/* ------------------------------------------------------------------ admin */

test('backup: the copy is ciphertext and needs the same DATA_KEY', async () => {
  const MARKER = 'backup-5be1'
  const server = await startServer({ DATA_KEY: TEST_DATA_KEY })
  const owner = await signIn(server, 'backup@crypt.test')
  const wsId = (await owner.post('/api/workspaces', { name: 'Backed up' })).body.id
  const d = openDoc(server, owner, `ws:${wsId}:p:p1`)
  await d.synced
  writeText(d.doc, `in the backup ${MARKER}`)
  await flushed(d)
  d.destroy()
  await server.stop()
  const target = join(server.dataDir, 'backup.sqlite')
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'backup', target], { env: { PATH: process.env.PATH, DATA_DIR: server.dataDir }, encoding: 'utf8' })
  assert.match(out, /keep DATA_KEY apart from the backup/)
  assert.equal(readFileSync(target).includes(Buffer.from(MARKER)), false)
  // restored elsewhere: opens with the same key only
  const restored = tempDir()
  copyFileSync(target, join(restored, 'one.sqlite'))
  const wrong = await runServerExpectingExit({ DATA_DIR: restored, DEV_MODE: '1', DATA_KEY: TEST_DATA_KEY_2 })
  assert.equal(wrong.code, 78)
  const db = openDb(join(restored, 'one.sqlite'))
  try {
    const repo = new Repo(db, Buffer.alloc(32), new Keyring(db, keyBytes(TEST_DATA_KEY)))
    const doc = new Y.Doc()
    Y.applyUpdate(doc, repo.loadDocument(`ws:${wsId}:p:p1`)!)
    assert.match(textOf(doc), new RegExp(MARKER))
  } finally {
    db.close()
  }
})
