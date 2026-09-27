import { decideTier, type TierDecision } from './policy.ts'
import type { TrajectoryState } from './types.ts'
import type { DecisionAttribution, FallbackRoute, ReasonCode, SabiDecision, SabiState } from './control-types.ts'

/**
 * Sabi Control — the decision function.
 *
 * Pure: it reads a state and a policy, and returns a decision. It performs no
 * I/O, mutates nothing, and is deterministic for a given input. That is the
 * property everything else rests on, and it is cheaper to test than any
 * individual rule, so it is tested first.
 *
 * The existing tier policy already encodes most of the routing judgement.
 * This function does not reimplement it — it decides what to ASK the policy
 * and how to describe the answer, which is the part that was missing.
 */

/** Tier ordering for de-escalation: the first is the most capable. */
const CAPABILITY_ORDER = ['strong', 'mid', 'cheap', 'local'] as const

const EMPTY_TRAJECTORY: TrajectoryState = {
  messageCount: 0,
  assistantTurns: 0,
  toolMessages: 0,
  lastRole: 'user',
  contextChars: 0,
  estimatedTokens: 0,
  hasTools: false,
  toolNames: [],
  lastToolNames: [],
  roundKind: 'unclassified',
  failure: 'none',
  failureEvidence: [],
}

/**
 * Higher is more capable.
 *
 * Deliberately not `CAPABILITY_ORDER.indexOf`, which is 0 for the strongest
 * tier and reads backwards at every comparison site. A ranking whose direction
 * is only discoverable by reading carefully is a ranking that will be inverted
 * once, and this code already inverted it once.
 */
const CAPABILITY_RANK: Record<string, number> = { local: 0, cheap: 1, mid: 2, strong: 3 }

function capabilityRank(tier: string): number {
  return CAPABILITY_RANK[tier] ?? 0
}

function upsert(seen: ReasonCode[], code: ReasonCode): ReasonCode[] {
  return seen.includes(code) ? seen : [...seen, code]
}

function countUnknownSignals(state: SabiState): number {
  const signals = state.signals
  if (!signals) return 0
  let n = 0
  for (const value of [signals.tests, signals.build, signals.typecheck]) {
    if (value === 'unknown') n += 1
  }
  return n
}

export function attribute(state: SabiState): DecisionAttribution {
  return {
    hadTrajectory: Boolean(state.trajectoryId && state.trajectory),
    hadSignals: state.signals !== undefined,
    unknownSignals: countUnknownSignals(state),
    source: 'local',
  }
}

/**
 * Build the fallback chain: every other configured tier, most capable first.
 *
 * A fallback that is not ordered is a coin flip. Ordering it by capability
 * means the first attempt after a capability failure is the one most likely to
 * succeed, which is what makes a failure cost one round rather than several.
 */
function fallbacksFor(planned: string, tiers: string[]): FallbackRoute[] {
  return CAPABILITY_ORDER
    .filter((tier) => tier !== planned && tiers.includes(tier))
    .map((tier) => ({ tier, reason: 'UPHELD' as ReasonCode }))
}

/**
 * A transport retry must hold capability.
 *
 * A 429 or a dropped socket means "this route is sick", not "this task is hard".
 * Retrying on the most capable tier would turn a provider outage into a bill,
 * which is the specific harm the free lane exists to prevent.
 *
 * Held in tier order rather than provider order, which is a real limit and not
 * a stylistic one: with one model per tier, "same capability, different
 * provider" is not expressible until the registry lands. Recorded rather than
 * worked around, because the workaround would be to climb capability, and
 * climbing capability is the bug.
 */
function sameCapabilityRetry(current: string, tiers: string[]): string | undefined {
  const at = CAPABILITY_ORDER.indexOf(current as (typeof CAPABILITY_ORDER)[number])
  if (at < 0) return undefined
  return CAPABILITY_ORDER.slice(at + 1).find((tier) => tiers.includes(tier))
}

/**
 * Decide what the next round should use.
 *
 * Absence is answerable. A host that reports nothing gets `unchanged` with a
 * reason, never an error and never a guess dressed as a decision.
 */
export function decide(state: SabiState, policy: Record<string, string>): SabiDecision {
  const tiers = state.tiers ?? []
  const current = state.currentTier
  const signals = state.signals
  const trajectory = state.trajectory
  let reasons: ReasonCode[] = []

  // --- No usable input. This is an answer, not a failure. -----------------
  if (!trajectory && !signals && !current) {
    return {
      action: 'unchanged',
      reasonCodes: ['NO_SIGNAL'],
      reason: 'no trajectory, signals, or current tier reported; nothing to decide from',
    }
  }

  // --- Stop conditions come before routing. --------------------------------
  // A finished goal must not be escalated. A router that only escalates is a
  // router that only spends.
  const goalsMet = signals?.tests === 'pass' && signals?.build === 'pass' && signals?.typecheck === 'pass'
  if (goalsMet && trajectory?.verification?.status === 'passed') {
    return {
      action: 'stop',
      reasonCodes: ['VERIFICATION_FAILED'],
      reason: 'verification passed and the goal signals are green; nothing left to route',
    }
  }

  // --- Failure semantics. Transport and capability are different axes. -----
  // Conflating them routes to a stronger model for a reason that was never
  // true, which is the defect that sent nineteen models to a 0/5 score.
  const repeatedCapabilityFailure =
    signals?.toolError === 'capability' ||
    (trajectory?.repeatedFailure === true) ||
    (trajectory?.failureStreak ?? 0) >= 2 ||
    signals?.tests === 'fail' ||
    signals?.build === 'fail' ||
    signals?.typecheck === 'fail'

  const transportFailure = signals?.toolError === 'transport'

  if (transportFailure && !repeatedCapabilityFailure) {
    reasons = upsert(reasons, 'TRANSPORT_FAILURE')
    // Same required capability, different healthy route. NOT a stronger model.
    const held = current ? sameCapabilityRetry(current, tiers) : undefined
    if (held) {
      return {
        action: 'retry',
        tier: held,
        reasonCodes: reasons,
        reason: 'transport failure; holding capability and moving to the next configured tier down',
      }
    }
    return {
      action: 'unchanged',
      reasonCodes: reasons,
      reason: 'transport failure and no alternative route is configured',
    }
  }

  if (repeatedCapabilityFailure) {
    reasons = upsert(reasons, 'REPEATED_FAILURE')
    if (signals?.tests === 'fail' || signals?.build === 'fail') reasons = upsert(reasons, 'VERIFICATION_FAILED')

    // The reported signals are the most recent and most specific evidence the
    // host has, and they outrank what the trajectory says about the round.
    //
    // Passing the trajectory straight through was a live bug: a host
    // reporting toolError 'capability' on an exploration round had its
    // roundKind decide the tier, so a confirmed capability failure routed to
    // `cheap` — the exact opposite of escalating.
    const failureState: TrajectoryState = {
      ...EMPTY_TRAJECTORY,
      ...trajectory,
      // 'hard' is what the policy's `failure` rule matches on. A weaker signal
      // here falls through to `unclassified` and the escalation never happens.
      failure: 'hard',
      repeatedFailure: true,
      failureStreak: Math.max(2, trajectory?.failureStreak ?? 0),
    }

    const tierDecision: TierDecision = decideTier(failureState, policy)

    if (tierDecision.tier === current) {
      return {
        action: 'unchanged',
        reasonCodes: reasons,
        reason: `repeated capability failure, but policy already routes this to ${current}`,
      }
    }

    // A tier change that reduces capability is a de-escalation, and calling it
    // an escalation would misreport it to the host and to the user. The policy
    // produced it, so it is reported as what it is.
    if (capabilityRank(tierDecision.tier) < capabilityRank(current!)) {
      reasons = upsert(reasons, 'DEESCALATED')
      return {
        action: 'route',
        tier: tierDecision.tier,
        reasonCodes: reasons,
        reason: `recovered; policy routes back to ${tierDecision.tier}`,
        fallbacks: fallbacksFor(tierDecision.tier, tiers),
      }
    }

    return {
      action: 'escalate',
      tier: tierDecision.tier,
      reasonCodes: reasons,
      reason: `repeated capability failure; ${tierDecision.reason}`,
    }
    return {
      action: 'unchanged',
      reasonCodes: reasons,
      reason: `repeated capability failure, but policy already routes this to ${current}`,
    }
  }

  // --- Context pressure. ---------------------------------------------------
  if (
    trajectory?.contextTokens !== undefined &&
    trajectory?.contextWindow !== undefined &&
    trajectory.contextWindow > 0 &&
    trajectory.contextTokens / trajectory.contextWindow >= 0.8
  ) {
    reasons = upsert(reasons, 'CONTEXT_PRESSURE')
  }

  // --- Upheld. -------------------------------------------------------------
  if (!reasons.length) reasons = ['UPHELD']
  if (current) {
    return {
      action: 'unchanged',
      reasonCodes: reasons,
      reason: `current tier ${current} still fits the reported state`,
    }
  }

  // --- No current tier: choose one. ---------------------------------------
  const tierDecision = decideTier(
    { ...EMPTY_TRAJECTORY, ...trajectory, hasTools: trajectory?.hasTools ?? signals?.toolError !== undefined },
    policy,
  )

  return {
    action: 'route',
    tier: tierDecision.tier,
    reasonCodes: reasons,
    reason: tierDecision.reason,
    fallbacks: fallbacksFor(tierDecision.tier, tiers),
  }
}
