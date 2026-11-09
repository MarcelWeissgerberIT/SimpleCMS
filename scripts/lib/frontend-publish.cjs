/** Publish verified static files without stopping the backend. Old hashed assets remain available. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function publish(root, stage, manifest) {
  const changes = []
  for (const [name, digest] of Object.entries(manifest)) {
    if (!name.startsWith('dist/') || name.split('/').some(p => !p || p === '..' || p === '.') || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid manifest path or digest')
    const target = path.join(root, name), source = path.join(stage, name)
    // Both trees are operator-owned. Never follow a symlink out of them.
    for (const base of [root, stage]) {
      let cursor = base
      for (const part of name.split('/')) { cursor = path.join(cursor, part); if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('Symlink in release') }
    }
    if (fs.existsSync(source)) {
      if (hash(source) !== digest) throw Error('Staged hash mismatch: ' + name)
      if (!fs.existsSync(target) || hash(target) !== digest) changes.push({ name, source, target })
    } else if (!fs.existsSync(target) || hash(target) !== digest) throw Error('Missing release file: ' + name)
  }
  // A page can reference new chunks only after all of them have been installed.
  changes.sort((a,b) => Number(/\.html$|\/sw\.js$/.test(a.name)) - Number(/\.html$|\/sw\.js$/.test(b.name)))
  const undo = []
  try {
    for (const change of changes) {
      const backup = fs.existsSync(change.target) ? fs.readFileSync(change.target) : null
      const mode = backup ? fs.statSync(change.target).mode & 0o777 : 0o644
      fs.mkdirSync(path.dirname(change.target), { recursive: true, mode: 0o755 })
      const temp = change.target + '.release-' + crypto.randomUUID()
      try {
        fs.copyFileSync(change.source, temp); fs.chmodSync(temp, 0o644)
        fs.renameSync(temp, change.target)
      } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
      undo.push({ ...change, backup, mode })
    }
    for (const [name, digest] of Object.entries(manifest)) if (hash(path.join(root,name)) !== digest) throw Error('Published hash mismatch: ' + name)
    return { verified: Object.keys(manifest).length, changed: changes.length }
  } catch (error) {
    for (const change of undo.reverse()) {
      if (change.backup) {
        const temp = change.target + '.rollback-' + crypto.randomUUID()
        fs.writeFileSync(temp, change.backup, { mode: change.mode }); fs.renameSync(temp, change.target)
      } else fs.unlinkSync(change.target)
    }
    throw error
  }
}
module.exports = { publish }
if (require.main === module) {
  const [root, stage, manifest] = process.argv.slice(2)
  console.log(JSON.stringify(publish(root, stage, JSON.parse(fs.readFileSync(manifest, 'utf8')))))
}
