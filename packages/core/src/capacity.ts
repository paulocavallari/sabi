import { modelRouteCost, servesInputModalities } from './compatibility.ts'
import type { ModelModality, SabiConfig } from './types.ts'

/**
 * The candidate universe.
 *
 * Until now this was `config.models` — a hand-written list of tiers, each
 * bound to one upstream Sabi could dial. That made the universe blind to
 * every pool the operator already had but had not written a row for, and the
 * most valuable one of those is capacity the *host* holds: a subscription, an
 * orchestrator-injected model, an agent runtime with its own allowance. When a
 * provider key dies, that pool is the one the operator has no bill to fear.
 *
 * A host-native candidate is `executor: 'host'`. Sabi never dials it — the
 * proxy has no credential and never will — so it can only ever be a
 * *recommendation*. Confusing the two is how a router ends up dispatching to
 * something it cannot reach, so they are separate types and separate call
 * paths.
 */

export interface Candidate {
  /** A stable handle: `tier:cheap`, or `capacity:<pool>/<model>`. */
  key: string
  /** Where the model id lives. */
  model: string
  /** `provider` for a dialable upstream, `host` for host-native capacity. */
  executor: 'provider' | 'host'
  tier?: string
  pool?: string
  contextWindow?: number
  maxOutputTokens?: number
  inputModalities?: ModelModality[]
  cost?: { input: number; output: number }
}

/**
 * Everything reachable from this process, as one list.
 *
 * Provider-backed rows come from `config.models`, which is where eligibility
 * and policy already apply. Host-native rows come from `config.capacity` and
 * carry no upstream, because there is nothing to dial.
 */
export function candidateUniverse(config: SabiConfig): Candidate[] {
  const fromModels: Candidate[] = Object.entries(config.models).map(([tier, entry]) => ({
    key: `tier:${tier}`,
    tier,
    model: entry.model,
    executor: 'provider' as const,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    inputModalities: entry.capabilities?.inputModalities,
    cost: entry.cost,
  }))

  const fromCapacity: Candidate[] = Object.entries(config.capacity ?? {}).flatMap(([pool, declared]) =>
    Object.entries(declared.models).map(([id, entry]) => ({
      key: `capacity:${pool}/${id}`,
      pool,
      model: id,
      executor: 'host' as const,
      contextWindow: entry.contextWindow,
      maxOutputTokens: entry.maxOutputTokens,
      inputModalities: entry.capabilities?.inputModalities,
      cost: entry.cost,
    })),
  )

  return [...fromModels, ...fromCapacity]
}

export function servesRequest(candidate: Candidate, required: readonly ModelModality[]): boolean {
  return servesInputModalities(candidate.inputModalities, required)
}

/**
 * Order candidates when the preferred path failed.
 *
 * Host-native capacity is not automatically first. If the caller is a plain
 * HTTP client rather than a host that can act on a recommendation, a
 * host-native route is unactionable and putting it first just converts a
 * working failure into a dead end. The caller says whether it can execute.
 */
export function orderAfterFailure(
  candidates: Candidate[],
  failedKey: string,
  options: { hostCanExecute: boolean; credentialFailure?: boolean },
): Candidate[] {
  // A host-native candidate the caller cannot execute is REMOVED, not merely
  // ranked lower. Sitting in the chain is enough to waste an attempt: either
  // it is dialled, which Sabi cannot do, or it is returned as an instruction
  // the caller has no way to act on. Both turn a recoverable failure into a
  // dead end, which is the opposite of what fallback is for.
  const rest = candidates.filter((c) => c.key !== failedKey)
  const executable = options.hostCanExecute ? rest : rest.filter((c) => c.executor !== 'host')
  return [...executable].sort((a, b) => {
    if (options.hostCanExecute && a.executor !== b.executor) {
      // A host-native pool needs no key the operator does not already have,
      // so it is the safer recommendation when a credential dies.
      if (options.credentialFailure && a.executor === 'host') return -1
      if (options.credentialFailure && b.executor === 'host') return 1
    }
    const ca = modelRouteCost(a as never)
    const cb = modelRouteCost(b as never)
    if (ca !== cb) return ca - cb
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}
