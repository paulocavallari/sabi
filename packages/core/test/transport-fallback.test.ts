import test from 'node:test'
import assert from 'node:assert/strict'
import { getFallbackChain } from '../src/router.ts'
import { validateConfig } from '../src/config.ts'

// All model metadata is synthetic. These are not claims about any live model.
function config(overrides: Record<string, unknown> = {}) {
  return validateConfig({
    upstreams: {
      mock: { baseURL: 'http://127.0.0.1:9/v1', apiKey: false },
      off: { baseURL: 'http://127.0.0.1:9/v1', apiKey: false, enabled: false },
    },
    models: {
      cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 1, output: 2 }, capabilities: { inputModalities: ['text'] } },
      mid: { upstream: 'mock', model: 'synthetic-mid', cost: { input: 5, output: 10 }, capabilities: { inputModalities: ['text', 'image'] } },
      strong: { upstream: 'mock', model: 'synthetic-strong', cost: { input: 10, output: 20 }, capabilities: { inputModalities: ['text', 'image'] } },
      parked: { upstream: 'off', model: 'synthetic-parked', cost: { input: 0, output: 1 }, capabilities: { inputModalities: ['text'] } },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap' },
    policy: { unclassified: 'cheap' },
    ...overrides,
  })
}

test('the chain excludes the failed tier and orders cheapest-first', () => {
  const chain = getFallbackChain(config(), 'mid')
  assert.deepEqual(chain.map((entry) => entry.tier), ['cheap', 'strong'])
  assert.equal(chain[0].upstreamModel, 'synthetic-cheap')
  assert.match(chain[0].reason, /fallback from mid/)
})

test('tiers behind a disabled upstream never appear in the chain', () => {
  const chain = getFallbackChain(config(), 'cheap')
  assert.ok(!chain.some((entry) => entry.tier === 'parked'), 'parked sits behind a disabled upstream')
})

test('input modalities are a hard constraint on the chain', () => {
  const chain = getFallbackChain(config(), 'strong', ['image'])
  assert.deepEqual(chain.map((entry) => entry.tier), ['mid'])
})

test('an unknown failed tier yields no chain', () => {
  assert.deepEqual(getFallbackChain(config(), 'nope'), [])
})

test('transportFallback is optional but must be a boolean flag', () => {
  assert.equal(validateConfig({ ...config(), transportFallback: { enabled: true } }).transportFallback?.enabled, true)
  assert.equal(validateConfig({ ...config(), transportFallback: { enabled: false } }).transportFallback?.enabled, false)
  assert.throws(() => validateConfig({ ...config(), transportFallback: true }), /transportFallback must be an object/)
  assert.throws(() => validateConfig({ ...config(), transportFallback: { enabled: 'yes' } }), /transportFallback\.enabled must be a boolean/)
})

/* ---- quota pools ----
   The case this file exists for: the shared `:free` pool refuses with a 429,
   and the chain used to walk straight through the other models drawing on
   that same spent allowance. Two upstream tiers, one shared pool and one
   independently funded, so the assertions below are about a real shape
   rather than a vacuous pass. */

// Synthetic metadata; the ids mirror the real pool structure on purpose,
// because the whole point is that the shape is what matters.
function pooledConfig() {
  return validateConfig({
    upstreams: {
      mock: { baseURL: 'http://127.0.0.1:9/v1', apiKey: false },
    },
    models: {
      cheap: { upstream: 'mock', model: 'synthetic/poolside:free', cost: { input: 0, output: 0 }, capabilities: { inputModalities: ['text'] } },
      mid: { upstream: 'mock', model: 'synthetic/dots:free', cost: { input: 0, output: 0 }, capabilities: { inputModalities: ['text'] } },
      strong: { upstream: 'mock', model: 'synthetic/nemotron:free', cost: { input: 0, output: 0 }, capabilities: { inputModalities: ['text'] } },
      independent: { upstream: 'mock', model: 'stealth/space-bunny-alpha', cost: { input: 0, output: 0 }, capabilities: { inputModalities: ['text', 'image'] } },
      paid: { upstream: 'mock', model: 'synthetic/paid', cost: { input: 3, output: 6 }, capabilities: { inputModalities: ['text'] } },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap' },
    policy: { unclassified: 'cheap' },
  })
}

test('a quota refusal does not fall back into the same spent pool', () => {
  const chain = getFallbackChain(pooledConfig(), 'cheap', [], true)
  const samePool = chain.filter((f) => f.upstreamModel.endsWith(':free'))
  assert.equal(samePool.length, 0, 'a same-pool candidate is not a fallback after a 429')
})

test('a quota refusal prefers the independently funded free model', () => {
  const chain = getFallbackChain(pooledConfig(), 'cheap', [], true)
  assert.ok(chain.length > 0, 'there must be somewhere to go')
  assert.equal(chain[0]!.upstreamModel, 'stealth/space-bunny-alpha')
})

test('an outage still walks within the pool', () => {
  // A 503 is a route problem, not a quota problem. The models inside the
  // pool are individually healthy, so excluding them would be wrong.
  const chain = getFallbackChain(pooledConfig(), 'cheap', [], false)
  const samePool = chain.filter((f) => f.upstreamModel.endsWith(':free'))
  assert.ok(samePool.length > 0, 'an outage must still fall back inside the pool')
})
