import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createSabiServer } from '../src/server.ts'
import { validateConfig } from '@sabi/core'

/**
 * The advertised model list is the product surface.
 *
 * Sabi exists to remove the model-picking decision. A client that renders
 * every alias turns it back into a model picker — a different list rather than
 * a shorter one — which is the failure this gate exists to prevent.
 *
 * Diagnostic tiers stay routable by name. They exist so an operator who
 * already knows about Mistral can reach it; they are not choices to offer.
 */

const upstream = { mock: { baseURL: 'http://127.0.0.1:9/v1', apiKey: false } }

function config(visibility: Record<string, 'default' | 'diagnostic'> = {}) {
  return validateConfig({
    upstreams: upstream,
    models: {
      cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 0, output: 0 }, ...(visibility.cheap ? { visibility: visibility.cheap } : {}) },
      mid: { upstream: 'mock', model: 'synthetic-mid', cost: { input: 0, output: 0 }, ...(visibility.mid ? { visibility: visibility.mid } : {}) },
      strong: { upstream: 'mock', model: 'synthetic-strong', cost: { input: 0, output: 0 }, ...(visibility.strong ? { visibility: visibility.strong } : {}) },
      mistral: { upstream: 'mock', model: 'synthetic-mistral', cost: { input: 1, output: 3 }, ...(visibility.mistral ? { visibility: visibility.mistral } : {}) },
      local: { upstream: 'mock', model: 'synthetic-local', cost: { input: 0, output: 0 }, ...(visibility.local ? { visibility: visibility.local } : {}) },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap', 'sabi-mid': 'mid', 'sabi-strong': 'strong', 'sabi-mistral': 'mistral', 'sabi-local': 'local' },
    policy: { unclassified: 'cheap' },
    judge: { enabled: false },
  })
}

async function advertisedModels(cfg: ReturnType<typeof config>): Promise<string[]> {
  const sabi = createSabiServer({ config: cfg, logFile: '/dev/null', verbose: false })
  const port = await sabi.listen(0, '127.0.0.1')
  try {
    const body = (await (await fetch(`http://127.0.0.1:${port}/v1/models`)).json()) as { data: { id: string }[] }
    return body.data.map((m) => m.id)
  } finally {
    await sabi.close()
  }
}

test('the adaptive alias is always advertised', async () => {
  const ids = await advertisedModels(config({ cheap: 'diagnostic', mistral: 'diagnostic' }))
  assert.ok(ids.includes('sabi-code'), 'auto is the product and must never be hidden')
})

test('a diagnostic tier is not advertised', async () => {
  const ids = await advertisedModels(config({ mistral: 'diagnostic', local: 'diagnostic' }))
  assert.ok(!ids.includes('sabi-mistral'), 'a diagnostic tier must not reach a picker')
  assert.ok(!ids.includes('sabi-local'))
})

test('the cheap/mid/strong escape hatches stay advertised', async () => {
  const ids = await advertisedModels(config({ mistral: 'diagnostic' }))
  for (const expected of ['sabi-cheap', 'sabi-mid', 'sabi-strong']) {
    assert.ok(ids.includes(expected), `${expected} is a pinned escape hatch, not a diagnostic`)
  }
})

test('a tier with no visibility set is advertised, so existing installs are unchanged', async () => {
  const ids = await advertisedModels(config())
  assert.equal(ids.length, 6, 'omitting the field must not silently hide routes')
})

test('visibility is validated at load', () => {
  assert.throws(
    () => validateConfig({
      upstreams: upstream,
      models: { x: { upstream: 'mock', model: 'm', visibility: 'hidden' } },
      aliases: { a: 'x' },
      policy: { unclassified: 'x' },
    }),
    /visibility must be 'default' or 'diagnostic'/,
  )
})
