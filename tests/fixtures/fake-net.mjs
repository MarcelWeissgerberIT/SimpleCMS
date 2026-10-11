/**
 * Loaded ONLY through NODE_OPTIONS=--import=<this file> (slice 2's worker specs start the worker with it): the fictional
 * host tracker.example.com resolves to 203.0.113.10 (a documentation range, never routed) and an https request to it
 * goes to the mock MCP server's plain-http port (MOCK_MCP_PORT) on 127.0.0.1 instead. No seam in product code: the
 * worker's own resolver and https.request are what this replaces, for that one host.
 */
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'

const HOST = 'tracker.example.com'
const ADDRESS = '203.0.113.10'
const port = () => Number(process.env.MOCK_MCP_PORT || 0)

const lookup = dns.lookup
dns.lookup = function (hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback
  const opts = typeof options === 'object' && options ? options : {}
  if (String(hostname).toLowerCase() !== HOST) return lookup.apply(this, arguments)
  if (opts.all) return process.nextTick(() => cb(null, [{ address: ADDRESS, family: 4 }]))
  process.nextTick(() => cb(null, ADDRESS, 4))
}
const plookup = dns.promises.lookup
dns.promises.lookup = async (hostname, options) => {
  if (String(hostname).toLowerCase() !== HOST) return plookup(hostname, options)
  return options && options.all ? [{ address: ADDRESS, family: 4 }] : { address: ADDRESS, family: 4 }
}

/** The request's target host (url string / URL / options), lower case. */
function hostOf(input, options) {
  if (typeof input === 'string' || input instanceof URL) return new URL(String(input)).hostname.toLowerCase()
  const o = input ?? options ?? {}
  return String(o.servername || o.hostname || o.host || '').split(':')[0].toLowerCase()
}

function rewrite(input, options, cb) {
  let url = null
  let opts = {}
  if (typeof input === 'string' || input instanceof URL) {
    url = new URL(String(input))
    if (typeof options === 'function') cb = options
    else opts = options ?? {}
  } else opts = input ?? {}
  const path = url ? `${url.pathname}${url.search}` : (opts.path ?? '/')
  const headers = { ...(opts.headers ?? {}), host: HOST }
  const { agent: _a, lookup: _l, servername: _s, ca: _c, ...rest } = opts
  return http.request({ ...rest, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port: port(), path, headers }, cb)
}

const request = https.request
https.request = function (input, options, cb) {
  if (hostOf(input, options) !== HOST) return request.apply(this, arguments)
  return rewrite(input, options, cb)
}
https.get = function (input, options, cb) {
  const req = https.request(input, options, cb)
  req.end()
  return req
}
