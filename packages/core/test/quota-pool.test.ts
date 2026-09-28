import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  freeVariantOf,
  isProvablyFree,
  isRouterAlias,
  quotaPoolOf,
  sameQuotaPool,
} from '../src/quota-pool.ts'

/**
 * Quota pools.
 *
 * The distinction the whole file exists for: seventeen `:free` models share
 * ONE daily allowance, and a model priced at zero without the suffix is
 * funded from somewhere else. Counting models rather than pools is how a free
 * lane looks healthy until it cannot serve anything at all.
 */

const entry = (model: string, cost?: { input: number; output: number }) => ({ model, cost })

test('the :free suffix means the shared daily pool, whatever the price says', () => {
  assert.equal(quotaPoolOf(entry('vendor/model:free')), 'shared-free-daily')
  // Even at a non-zero declared cost, the suffix places it in the pool.
  assert.equal(quotaPoolOf(entry('vendor/model:free', { input: 1, output: 1 })), 'shared-free-daily')
})

test('a zero-priced model without the suffix is independently funded', () => {
  assert.equal(quotaPoolOf(entry('stealth/space-bunny-alpha', { input: 0, output: 0 })), 'independent')
  assert.equal(isProvablyFree(entry('stealth/space-bunny-alpha', { input: 0, output: 0 })), true)
})

test('a paid model is in no free pool', () => {
  assert.equal(quotaPoolOf(entry('nvidia/nemotron-3-ultra-550b-a55b', { input: 0.6, output: 2.4 })), 'none')
  assert.equal(isProvablyFree(entry('nvidia/nemotron-3-ultra-550b-a55b', { input: 0.6, output: 2.4 })), false)
})

test('seventeen :free models are one resource, not seventeen', () => {
  const a = entry('poolside/laguna-s-2.1:free')
  const b = entry('nvidia/nemotron-3-ultra-550b-a55b:free')
  const c = entry('google/gemma-4-31b-it:free')
  assert.equal(sameQuotaPool(a, b), true)
  assert.equal(sameQuotaPool(b, c), true)
})

test('an unsuffixed free model is NOT in the shared pool', () => {
  // This is the case that motivates the file. When the shared pool is spent,
  // this one still serves.
  const shared = entry('poolside/laguna-s-2.1:free')
  const independent = entry('stealth/space-bunny-alpha', { input: 0, output: 0 })
  assert.equal(sameQuotaPool(shared, independent), false)
})

test('two paid models are not in a shared pool', () => {
  const a = entry('nvidia/a', { input: 1, output: 1 })
  const b = entry('nvidia/b', { input: 2, output: 2 })
  assert.equal(sameQuotaPool(a, b), false, 'two `none` values must not compare equal')
})

test('the router alias is recognised and is not a model', () => {
  assert.equal(isRouterAlias('openrouter/free'), true)
  assert.equal(isRouterAlias('OpenRouter/Free'), true)
  assert.equal(isRouterAlias('openrouter/auto'), true)
  // It looks like a model id in a catalogue listing, which is why it has to
  // be excluded explicitly.
  assert.equal(isRouterAlias('openrouter/anything-else:free'), false)
})

test('the free variant of a paid model is discoverable', () => {
  const available = [
    'nvidia/nemotron-3-ultra-550b-a55b',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'poolside/laguna-s-2.1:free',
  ]
  assert.equal(freeVariantOf('nvidia/nemotron-3-ultra-550b-a55b', available), 'nvidia/nemotron-3-ultra-550b-a55b:free')
  // Already a free id: the answer is itself, not a doubled suffix.
  assert.equal(freeVariantOf('poolside/laguna-s-2.1:free', available), 'poolside/laguna-s-2.1:free')
  assert.equal(freeVariantOf('nothing/here', available), undefined)
})

test('a model with no declared cost is not provably free', () => {
  assert.equal(isProvablyFree(entry('vendor/model')), false)
  assert.equal(quotaPoolOf(entry('vendor/model')), 'none')
})
