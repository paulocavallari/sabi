import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { candidateUniverse, orderAfterFailure, servesRequest } from '../src/capacity.ts'
import { validateConfig } from '../src/config.ts'

/**
 * Host-native capacity.
 *
 * The gap this closes: the candidate universe was `config.models`, so every
 * pool the operator already had but had not written a row for was invisible.
 * The most valuable one is capacity the HOST holds — a subscription, an
 * orchestrator-injected model — and it is the pool with no key to lose.
 *
 * `executor: 'host'` is the load-bearing distinction. Sabi recommends
 * host-native capacity; it never dials it. A router that dispatched to a
 * subscription it was never handed would fail at request time, silently.
 */

const base = {
  upstreams: { mock: { baseURL: 'http://127.0.0.1:9/v1', apiKey: false } },
  models: {
    cheap: { upstream: 'mock', model: 'synthetic/poolside:free', cost: { input: 0, output: 0 } },
    rescue: { upstream: 'mock', model: 'synthetic/nvidia', cost: { input: 0.6, output: 2.4 } },
  },
  aliases: { 'sabi-code': 'auto' },
  policy: { unclassified: 'cheap' },
  judge: { enabled: false },
}

test('capacity must be declared host-executed, because Sabi cannot dial it', () => {
  assert.throws(
    () => validateConfig({ ...base, capacity: { sub: { executor: 'provider', models: { m: {} } } } }),
    /executor must be 'host'/,
  )
})

test('a capacity pool with no models is rejected', () => {
  assert.throws(
    () => validateConfig({ ...base, capacity: { sub: { executor: 'host', models: {} } } }),
    /at least one model/,
  )
})

test('the universe contains both provider rows and host-native capacity', () => {
  const config = validateConfig({
    ...base,
    capacity: {
      host: { executor: 'host', models: { 'stealth/space-bunny-alpha': { cost: { input: 0, output: 0 } } } },
    },
  })
  const universe = candidateUniverse(config)
  const executors = new Set(universe.map((c) => c.executor))
  assert.ok(executors.has('provider'), 'provider-backed tiers must remain candidates')
  assert.ok(executors.has('host'), 'host-native capacity must be a candidate')
  const host = universe.find((c) => c.executor === 'host')
  assert.equal(host?.model, 'stealth/space-bunny-alpha')
  assert.equal(host?.key, 'capacity:host/stealth/space-bunny-alpha')
})

test('a host that can execute prefers its own pool when a credential dies', () => {
  const config = validateConfig({
    ...base,
    capacity: {
      host: { executor: 'host', models: { 'stealth/space-bunny-alpha': { cost: { input: 0, output: 0 } } } },
    },
  })
  const universe = candidateUniverse(config)
  const ordered = orderAfterFailure(universe, 'tier:cheap', { hostCanExecute: true, credentialFailure: true })
  assert.equal(ordered[0]?.executor, 'host', 'a dead credential should fall to capacity the operator already owns')
})

test('a client that CANNOT execute host capacity must not be sent there', () => {
  const config = validateConfig({
    ...base,
    capacity: {
      host: { executor: 'host', models: { 'stealth/space-bunny-alpha': { cost: { input: 0, output: 0 } } } },
    },
  })
  const universe = candidateUniverse(config)
  // A plain HTTP client has no way to act on "use your own subscription".
  // Recommending it would convert a working failure into a dead end.
  const ordered = orderAfterFailure(universe, 'tier:cheap', { hostCanExecute: false, credentialFailure: true })
  assert.equal(ordered[0]?.executor, 'provider', 'an unactionable recommendation is worse than none')
})

test('an ordinary outage still prefers the cheapest route, not the host pool', () => {
  const config = validateConfig({
    ...base,
    capacity: {
      host: { executor: 'host', models: { 'stealth/space-bunny-alpha': { cost: { input: 5, output: 5 } } } },
    },
  })
  const ordered = orderAfterFailure(candidateUniverse(config), 'tier:cheap', {
    hostCanExecute: true,
    credentialFailure: false,
  })
  // No credential died, so cost still decides.
  assert.equal(ordered[0]?.executor, 'provider')
})

test('modality fit still applies to host-native capacity', () => {
  const config = validateConfig({
    ...base,
    capacity: {
      host: { executor: 'host', models: { 'text-only': { capabilities: { inputModalities: ['text'] } } } },
    },
  })
  const textOnly = candidateUniverse(config).find((c) => c.executor === 'host')!
  assert.equal(servesRequest(textOnly, ['text']), true)
  assert.equal(servesRequest(textOnly, ['image']), false)
})
