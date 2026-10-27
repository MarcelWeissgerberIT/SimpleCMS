import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:https'
import { certificateFile, certificateStatus, parseCertificates, removeCertificates, saveCertificates } from '../src/worker/certificates.ts'
import { certificateOffer } from '../src/worker/certificate-offers.ts'
import { connectionProblem } from '../../src/shared/ai/connection-problem.ts'

const dir = mkdtempSync(join(tmpdir(), 'one-test-ca-')), config = join(dir, 'worker.json')
after(() => rmSync(dir, { recursive: true, force: true }))
const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' })
openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-subj', '/CN=ONE synthetic test CA', '-days', '2')
openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=localhost')
writeFileSync(join(dir, 'ext.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n')
openssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '1', '-extfile', 'ext.cnf')
const pem = readFileSync(join(dir, 'root.pem'), 'utf8')

test('the approved public workshop CA is only offered in its paired workspace and diagnostics separate TLS from sign-in', () => {
  const preset={workspace:'team:0MrfqSJ7pecnanXM',origin:'https://onecms.eh-atlas.com',port:47323,pair:'A'.repeat(43),name:'Workshop'}
  const offer=certificateOffer(preset)!
  assert.equal(parseCertificates(offer.pem)[0]!.fingerprint,offer.fingerprint)
  assert.equal(certificateOffer({...preset,workspace:'team:other'}),null)
  assert.equal(certificateOffer({...preset,origin:'https://other.example'}),null)
  assert.equal(certificateOffer(null),null)
  assert.equal(connectionProblem(Error('TLS certificate verification failed')), 'tls')
  assert.equal(connectionProblem(Error('Authentication rejected by this endpoint.')), 'auth')
  assert.equal(connectionProblem(Error('Connection timed out.')), 'timeout')
  assert.equal(connectionProblem(Error('Network connection failed.')), 'network')
})

test('only explicit valid CA bundles with confirmed fingerprints are saved; private keys and leaves are rejected', () => {
  const preview = parseCertificates(pem), fingerprints = preview.map(c => c.fingerprint)
  assert.equal(preview.length, 1)
  assert.throws(() => saveCertificates(config, pem, ['wrong']), /fingerprints/)
  assert.equal(existsSync(certificateFile(config)), false)
  assert.throws(() => parseCertificates(readFileSync(join(dir, 'leaf.pem'), 'utf8')), /CA certificates/)
  assert.throws(() => parseCertificates(pem + readFileSync(join(dir, 'root.key'), 'utf8')), /private key/)
  assert.throws(() => parseCertificates('garbage' + pem), /PEM/)
  saveCertificates(config, pem + pem, fingerprints)
  assert.equal(certificateStatus(config).certificates.length, 1)
  assert.ok(!JSON.stringify(certificateStatus(config)).includes('BEGIN CERTIFICATE'))
})

test('worker TLS trusts the approved CA, preserves verification and propagates it to child Node processes', async () => {
  saveCertificates(config, pem, parseCertificates(pem).map(c => c.fingerprint))
  const server = createServer({ key: readFileSync(join(dir, 'leaf.key')), cert: readFileSync(join(dir, 'leaf.pem')) }, (_, res) => res.end('verified'))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port, module = new URL('../src/worker/certificates.ts', import.meta.url).href
  const run = (source: string) => new Promise<{code:number|null;text:string}>((resolve,reject) => {
    const env = { ...process.env }; delete env.NODE_EXTRA_CA_CERTS; delete env.NODE_OPTIONS; delete env.NODE_TLS_REJECT_UNAUTHORIZED
    const c = spawn(process.execPath, ['--input-type=module', '-e', source], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let text = ''
    c.stdout.on('data', b => { text += b }); c.stderr.on('data', b => { text += b }); c.on('error', reject); c.on('exit', code => resolve({ code, text }))
  })
  try {
    const url = `https://127.0.0.1:${port}`
    const before = await run(`try{await fetch(${JSON.stringify(url)});process.exitCode=7}catch{console.log('untrusted')}`)
    assert.equal(before.code, 0); assert.match(before.text, /untrusted/)
    const trusted = await run(`import{configureCertificates}from${JSON.stringify(module)};import{spawn}from'node:child_process';import tls from'node:tls';
      await configureCertificates(${JSON.stringify(config)},'',[]);console.log(await(await fetch(${JSON.stringify(url)})).text());
      if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('verification disabled');
      await new Promise((resolve,reject)=>{const s=tls.connect({host:'127.0.0.1',port:${port},servername:'wrong.example'});s.on('secureConnect',()=>{s.end();reject(Error('wrong host accepted'))});s.on('error',e=>{if(e.code==='ERR_TLS_CERT_ALTNAME_INVALID'){console.log('hostname checked');resolve()}else reject(e)})});
      await new Promise((resolve,reject)=>{const c=spawn(process.execPath,['-e',${JSON.stringify(`fetch(${JSON.stringify(url)}).then(r=>r.text()).then(console.log).catch(()=>process.exitCode=1)`)}],{stdio:'inherit',env:process.env});c.on('exit',code=>code?reject(Error('child TLS failed')):resolve())});`)
    assert.equal(trusted.code, 0, trusted.text); assert.equal((trusted.text.match(/verified/g) ?? []).length, 2); assert.match(trusted.text, /hostname checked/)
  } finally { await new Promise<void>(r => server.close(() => r())) }
  removeCertificates(config)
  assert.equal(certificateStatus(config).certificates.length, 0)
  assert.equal(existsSync(join(dir, 'certificates', 'child-ca.pem')), false)
  writeFileSync(certificateFile(config), 'damaged CA')
  assert.equal(certificateStatus(config).invalid, true)
  assert.equal(certificateStatus(config).needsAttention, true)
  assert.deepEqual(certificateStatus(config).certificates, [])
  removeCertificates(config)
  assert.equal(certificateStatus(config).invalid, false)
})
