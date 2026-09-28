import type { TrajectoryState } from './types.ts'

/**
 * Sabi Control — the host-callable decision contract.
 *
 * The surface a harness calls to ask what the next round needs. It is
 * deliberately small: a host that can describe where it is should get a usable
 * answer, and a host that cannot should get a conservative one rather than an
 * error.
 *
 * ## Why this is a closed type
 *
 * There is no field for prompt text, file contents, or shell output, and there
 * is no index signature through which one could arrive. The same boundary the
 * evidence plane enforces on the way out of the router is enforced here on the
 * way in, so the decision interface cannot become a covert way to ship a
 * user's work to Sabi's infrastructure.
 *
 * Adding a field is a design decision that must survive review. Adding an index
 * signature would reopen the door this type exists to close.
 */

/** Tri-state. `unknown` is a value, never an omission, and never a zero. */
export type PassFail = 'pass' | 'fail' | 'unknown'

/**
 * Work signals a host can report without describing its work.
 *
 * These are facts about outcomes, not transcripts. `toolError` is a normalized
 * code; nothing here carries a command, a path, or output.
 */
export interface WorkSignals {
  tests?: PassFail
  build?: PassFail
  typecheck?: PassFail
  /** Normalized error class, never the provider's or the tool's own text. */
  toolError?: 'transport' | 'capability' | 'user-denied' | 'unknown'
  /** Files touched in the last round. A count, not a list. */
  diffSize?: number
}

/** What the trajectory is trying to achieve. A label, not a plan. */
export interface Goal {
  id: string
  /** A short class, not a description of the task. */
  kind?: string
}

/**
 * The state a host sends.
 *
 * `trajectory` is the existing `TrajectoryState` rather than a second copy of
 * it. That type already carries `repeatedFailure`, `failureStreak`,
 * `failureEvidence`, `contextTokens` and `verification`; duplicating those here
 * would create the two-copies-of-the-same-fact problem the harness adapter
 * taxonomies already suffer from.
 *
 * Every field except `trajectory` is optional. A host that can report nothing
 * still receives a decision.
 */
export interface SabiState {
  /**
   * Stable identity for the session this round belongs to.
   *
   * Without it, "the previous round" has no referent and every decision is
   * request-level — which is the thing trajectory-aware routing exists to
   * replace. A host with no identity is a host making request-level decisions
   * and should be told so.
   */
  trajectoryId?: string
  goal?: Goal
  /** Round number within the trajectory. Absent means unknown, not zero. */
  round?: number
  trajectory?: TrajectoryState
  signals?: WorkSignals
  /** Tiers the operator has configured, cheapest first. */
  tiers?: string[]
  /** The tier currently in use, so a decision can be a no-op. */
  currentTier?: string
}

/** Why a decision was made. Inspectable without reading model output. */
export type ReasonCode =
  | 'REPEATED_FAILURE'
  | 'TRANSPORT_FAILURE'
  | 'TOOL_ERROR'
  | 'VERIFICATION_FAILED'
  | 'CONTEXT_PRESSURE'
  | 'UPHELD'
  | 'DEESCALATED'
  | 'NO_SIGNAL'

/** A tier the router could have used instead. */
export interface FallbackRoute {
  tier: string
  reason: ReasonCode
}

/**
 * The decision.
 *
 * Exactly one of four shapes, discriminated by `action`. A host that receives
 * an unknown variant must refuse it rather than guess — that refusal is the
 * contract, and a lenient host is how a routing change becomes an outage.
 */
export type SabiDecision =
  | {
      action: 'route'
      tier: string
      reasonCodes: ReasonCode[]
      /** A plain sentence. The user should be able to read this and agree. */
      reason: string
      fallbacks: FallbackRoute[]
    }
  | {
      action: 'retry'
      reasonCodes: ReasonCode[]
      reason: string
      /** The tier the retry should use. */
      tier: string
    }
  | {
      action: 'escalate'
      tier: string
      reasonCodes: ReasonCode[]
      reason: string
    }
  | {
      action: 'stop'
      reasonCodes: ReasonCode[]
      reason: string
    }
  | {
      /**
       * The host asked for a decision and Sabi declined to change anything.
       *
       * This is a real answer, not a failure. It is what a host with no usable
       * signal receives, and it is what a host receives when Sabi is unavailable
       * — so the common case never looks like an error.
       */
      action: 'unchanged'
      reasonCodes: ReasonCode[]
      reason: string
    }

/** What a decision knows about the signals it used. */
export interface DecisionAttribution {
  /** The trajectory identity was present and usable. */
  hadTrajectory: boolean
  /** Any work signal was reported at all. */
  hadSignals: boolean
  /** Signals that were present but `unknown`. */
  unknownSignals: number
  /** Where the decision came from. `local` never means "guessed". */
  source: 'local' | 'local-plus-fleet'
}
