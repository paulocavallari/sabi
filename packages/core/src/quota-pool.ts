import type { ModelEntry } from './types.ts'

/**
 * Which daily allowance funds a model.
 *
 * The `:free` suffix is not a price, it is a statement about which pool the
 * request draws from. Seventeen `:free` models share one daily allowance on an
 * OpenRouter account, so a 429 on any of them is a statement about all
 * seventeen. Treating them as seventeen independent resources is how a lane
 * looks healthy right up until the moment it stops being able to serve
 * anything at all.
 *
 * A model that is priced at exactly zero but carries no `:free` suffix is
 * funded from somewhere else and survives that exhaustion. Right now that is
 * `stealth/space-bunny-alpha` — one model, one pool, but a pool that is not
 * shared with the other seventeen, which is the whole point.
 *
 * `none` is for paid models. They are in no free pool and have no daily limit
 * this logic can reason about.
 */
export type QuotaPool = 'shared-free-daily' | 'independent' | 'none'

/**
 * Ids that are routers rather than models.
 *
 * `openrouter/free` is the important one: it resolves to whichever free model
 * it likes at request time, so the model that answers is never the one named.
 * Dispatching to it makes every identity guarantee Sabi holds untrue, and it
 * is invisible in a catalogue listing because it does look like a model id.
 */
const ROUTER_ALIASES = new Set(['openrouter/free', 'openrouter/auto', 'openrouter/fusion'])

export function isRouterAlias(id: string): boolean {
  return ROUTER_ALIASES.has(id.trim().toLowerCase())
}

/**
 * Classify a model into a quota pool.
 *
 * The suffix decides the pool and the price decides whether it is free at
 * all. Those are separate questions and conflating them is what produced a
 * free lane that was really one allowance.
 */
export function quotaPoolOf(model: Pick<ModelEntry, 'model' | 'cost'>): QuotaPool {
  const id = model.model.trim()
  if (id.endsWith(':free')) return 'shared-free-daily'
  if (model.cost?.input === 0 && model.cost?.output === 0) return 'independent'
  return 'none'
}

/** True when a model is free *and* provably so, in either pool. */
export function isProvablyFree(model: Pick<ModelEntry, 'model' | 'cost'>): boolean {
  return quotaPoolOf(model) !== 'none'
}

/**
 * Whether two free models draw on the same daily allowance.
 *
 * This is the predicate the router needs when one pool is exhausted: the
 * correct move is to leave the pool, not to try the next model inside it.
 */
export function sameQuotaPool(
  a: Pick<ModelEntry, 'model' | 'cost'>,
  b: Pick<ModelEntry, 'model' | 'cost'>,
): boolean {
  const pa = quotaPoolOf(a)
  const pb = quotaPoolOf(b)
  // Two paid models are in no free pool, and comparing them by pool would
  // make two `none` values look like a match.
  if (pa === 'none' || pb === 'none') return false
  return pa === pb
}


/**
 * The free variant of a model, when one exists.
 *
 * Twelve catalogue models are published twice: once paid, once with a `:free`
 * suffix drawing on the shared daily pool. Pointing a tier at the paid id when
 * the free id exists costs real money for the same model, and it is invisible
 * unless you look for the pair.
 */
export function freeVariantOf(modelId: string, available: readonly string[]): string | undefined {
  if (modelId.endsWith(':free')) return modelId
  return available.find((id) => id === `${modelId}:free`)
}
