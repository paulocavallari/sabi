import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSabiServer, type SabiServer } from '../src/server.ts'
import { borrowedCredential } from '../src/upstream.ts'
import { validateConfig } from '@sabi/core'

/**
 * Borrowed credentials.
 *
 * A harness points one of its own providers at Sabi and keeps sending its own
 * credential. Sabi used to read the header and throw it away, dispatching with
 * its configured key instead -- so a valid borrowed key lost to an absent or
 * expired one, and a host's real capacity looked like a dead provider.
 *
 * These tests pin the rule: the caller's credential wins when it has one, the
 * configured key is the fallback, and a placeholder is never forwarded.
 */

function upstreamThatRecordsAuth(onCall: (auth: string | undefined, model: unknown) => { status: number; body?: string }): {
  server: ReturnType<typeof createServer>
  close: () => void
} {
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const parsed = JSON.parse(raw || '{}')
      const { status, body } = onCall(req.headers.authorization, parsed.model)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body ?? JSON.stringify({ id: 'x', model: parsed.model, choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
    })
  })
  return { server, close: () => server.close() }
}

function readLog(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}

test('a placeholder token is not a borrowed credential', () => {
  // The OMP extension registers Sabi with this literal so the provider
  // accepts a bearer value. It authenticates nothing, so forwarding it
  // upstream would be forwarding a lie.
  assert.equal(borrowedCredential('Bearer sabi-local-placeholder'), undefined)
})

test('a real bearer value is borrowed; anything malformed is not', () => {
  assert.equal(borrowedCredential('Bearer real-token-value'), 'real-token-value')
  assert.equal(borrowedCredential('bearer real-token-value'), 'real-token-value')
  assert.equal(borrowedCredential(undefined), undefined)
  assert.equal(borrowedCredential('Basic abc'), undefined, 'only bearer is borrowed')
  assert.equal(borrowedCredential('Bearer '), undefined, 'an empty bearer is not a credential')
})

test("the caller's credential reaches the upstream instead of the configured one", async () => {
  const seen: Array<string | undefined> = []
  const upstream = upstreamThatRecordsAuth((auth) => {
    seen.push(auth)
    return { status: 200 }
  })
  await new Promise<void>((r) => upstream.server.listen(0, '127.0.0.1', r))
  const port = (upstream.server.address() as { port: number }).port

  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-borrowed-'))
  const logFile = path.join(dir, 'decisions.jsonl')
  let sabi: SabiServer | undefined
  try {
    sabi = createSabiServer({
      config: validateConfig({
        upstreams: { mock: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: '$TEST_KEY' } },
        models: { cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 1, output: 1 }, maxOutputTokens: 4096, contextWindow: 100000 } },
        aliases: { 'sabi-fixed': 'cheap' },
        borrowedCredentials: true,
        policy: { exploration: 'cheap', unclassified: 'cheap' },
        judge: { enabled: false },
      }),
      logFile,
      verbose: false,
    })
    const sabiPort = await sabi.listen(0, '127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer borrowed-key-abc' },
      body: JSON.stringify({ model: 'sabi-fixed', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(seen, ['Bearer borrowed-key-abc'], "the caller's own credential is what gets forwarded")
  } finally {
    await sabi?.close()
    upstream.close()
  }
})

test('a placeholder from the caller falls back to the configured key', async () => {
  // What actually happens with OMP today: it registers Sabi with the
  // placeholder, so there is no real credential to borrow and Sabi must use
  // its own. The fallback has to be real, not a hole.
  const seen: Array<string | undefined> = []
  const upstream = upstreamThatRecordsAuth((auth) => {
    seen.push(auth)
    return { status: 200 }
  })
  await new Promise<void>((r) => upstream.server.listen(0, '127.0.0.1', r))
  const port = (upstream.server.address() as { port: number }).port

  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-borrowed-'))
  const logFile = path.join(dir, 'decisions.jsonl')
  let sabi: SabiServer | undefined
  const previous = process.env.TEST_KEY
  process.env.TEST_KEY = 'sabis-own-key'
  try {
    sabi = createSabiServer({
      config: validateConfig({
        upstreams: { mock: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: '$TEST_KEY' } },
        models: { cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 1, output: 1 }, maxOutputTokens: 4096, contextWindow: 100000 } },
        aliases: { 'sabi-fixed': 'cheap' },
        borrowedCredentials: true,
        policy: { exploration: 'cheap', unclassified: 'cheap' },
        judge: { enabled: false },
      }),
      logFile,
      verbose: false,
    })
    const sabiPort = await sabi.listen(0, '127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sabi-local-placeholder' },
      body: JSON.stringify({ model: 'sabi-fixed', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(seen, ['Bearer sabis-own-key'], 'a placeholder must never be forwarded upstream')
  } finally {
    await sabi?.close()
    upstream.close()
    if (previous === undefined) delete process.env.TEST_KEY
    else process.env.TEST_KEY = previous
  }
})

test('a caller without a credential still uses the configured key', async () => {
  const seen: Array<string | undefined> = []
  const upstream = upstreamThatRecordsAuth((auth) => {
    seen.push(auth)
    return { status: 200 }
  })
  await new Promise<void>((r) => upstream.server.listen(0, '127.0.0.1', r))
  const port = (upstream.server.address() as { port: number }).port

  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-borrowed-'))
  const logFile = path.join(dir, 'decisions.jsonl')
  let sabi: SabiServer | undefined
  const previous = process.env.TEST_KEY
  process.env.TEST_KEY = 'sabis-own-key'
  try {
    sabi = createSabiServer({
      config: validateConfig({
        upstreams: { mock: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: '$TEST_KEY' } },
        models: { cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 1, output: 1 }, maxOutputTokens: 4096, contextWindow: 100000 } },
        aliases: { 'sabi-fixed': 'cheap' },
        borrowedCredentials: true,
        policy: { exploration: 'cheap', unclassified: 'cheap' },
        judge: { enabled: false },
      }),
      logFile,
      verbose: false,
    })
    const sabiPort = await sabi.listen(0, '127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sabi-fixed', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(seen, ['Bearer sabis-own-key'], 'a caller with no credential leaves the configured one in place')
  } finally {
    await sabi?.close()
    upstream.close()
    if (previous === undefined) delete process.env.TEST_KEY
    else process.env.TEST_KEY = previous
  }
})

test("without the opt-in, a caller's credential is not spent", async () => {
  // The default, and the boundary proxy-contract.test.ts guards: Sabi must
  // not let a client choose which credential it presents upstream, nor talk
  // it into handing a token to a provider the client did not name. Borrowing
  // is opt-in precisely because it inverts that.
  const seen: Array<string | undefined> = []
  const upstream = upstreamThatRecordsAuth((auth) => {
    seen.push(auth)
    return { status: 200 }
  })
  await new Promise<void>((r) => upstream.server.listen(0, '127.0.0.1', r))
  const port = (upstream.server.address() as { port: number }).port

  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-noborrow-'))
  const logFile = path.join(dir, 'decisions.jsonl')
  let sabi: SabiServer | undefined
  const previous = process.env.TEST_KEY
  process.env.TEST_KEY = 'sabis-own-key'
  try {
    sabi = createSabiServer({
      config: validateConfig({
        upstreams: { mock: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: '$TEST_KEY' } },
        models: { cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 1, output: 1 }, maxOutputTokens: 4096, contextWindow: 100000 } },
        aliases: { 'sabi-fixed': 'cheap' },
        judge: { enabled: false },
      }),
      logFile,
      verbose: false,
    })
    const sabiPort = await sabi.listen(0, '127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer client-supplied-secret' },
      body: JSON.stringify({ model: 'sabi-fixed', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(seen, ['Bearer sabis-own-key'], "without the opt-in the caller's token is never forwarded")
  } finally {
    await sabi?.close()
    upstream.close()
    if (previous === undefined) delete process.env.TEST_KEY
    else process.env.TEST_KEY = previous
  }
})
