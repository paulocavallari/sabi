import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { attribute, decide } from '../src/decide.ts'
import type { SabiState } from '../src/control-types.ts'
import type { TrajectoryState } from '../src/types.ts'

/**
 * The decision contract.
 *
 * The primary property is determinism by replay, because it is cheaper to
 * verify than any individual rule and it is what everything else rests on.
 * Individual rules are tested after it, not instead of it.
 */

const POLICY = {
  stuck: 'strong',
  failure: 'strong',
  'context-pressure': 'mid',
  transport: 'mid',
  'first-turn': 'cheap',
  verification: 'cheap',
  implementation: 'mid',
  exploration: 'cheap',
  unclassified: 'cheap',
  off: 'off',
} as const

const TIERS = ['local', 'cheap', 'mid', 'strong']

const baseTrajectory = (over: Partial<TrajectoryState> = {}): TrajectoryState => ({
  messageCount: 12,
  assistantTurns: 6,
  toolMessages: 4,
  lastRole: 'user',
  contextChars: 40000,
  estimatedTokens: 10000,
  hasTools: true,
  toolNames: ['read_file'],
  lastToolNames: ['read_file'],
  roundKind: 'exploration',
  failure: 'none',
  failureEvidence: [],
  ...over,
})

const state = (over: Partial<SabiState> = {}): SabiState => ({
  trajectoryId: 't-1',
  round: 3,
  tiers: [...TIERS],
  trajectory: baseTrajectory(),
  ...over,
})

/* ---- determinism ---- */

test('the same state decides identically every time', () => {
  const s = state({ signals: { tests: 'fail' } })
  const first = JSON.stringify(decide(s, POLICY))
  for (let i = 0; i < 100; i++) {
    assert.equal(JSON.stringify(decide(s, POLICY)), first, `diverged on replay ${i}`)
  }
})

test('a decision is a closed union, never an ad-hoc object', () => {
  const actions = ['route', 'retry', 'escalate', 'stop', 'unchanged']
  const samples: SabiState[] = [
    state(),
    state({ signals: { tests: 'fail' } }),
    state({ signals: { toolError: 'transport' } }),
    state({ currentTier: 'cheap' }),
    state({ signals: { tests: 'pass', build: 'pass', typecheck: 'pass' } }),
    state({ trajectory: baseTrajectory({ verification: { status: 'passed' } }), signals: { tests: 'pass', build: 'pass', typecheck: 'pass' } }),
    state({ signals: { toolError: 'capability' } }),
  ]
  for (const s of samples) {
    const d = decide(s, POLICY)
    assert.ok(actions.includes(d.action), `unknown action: ${(d as { action: string }).action}`)
    assert.ok(d.reason.length > 0, 'every decision carries a reason')
    assert.ok(d.reasonCodes.length > 0, 'every decision carries reason codes')
  }
})

/* ---- absence is an answer, not an error ---- */

test('a host that reports nothing gets a valid decision', () => {
  const d = decide({}, POLICY)
  assert.equal(d.action, 'unchanged')
  assert.deepEqual(d.reasonCodes, ['NO_SIGNAL'])
  assert.match(d.reason, /no trajectory, signals, or current tier/)
})

test('a partial state is still answerable', () => {
  const partials: SabiState[] = [
    { tiers: [...TIERS] },
    { trajectoryId: 't-1' },
    { currentTier: 'cheap' },
    { signals: { tests: 'unknown' } },
    { signals: { diffSize: 0 } },
    { trajectory: baseTrajectory() },
  ]
  for (const p of partials) {
    const d = decide(p, POLICY)
    assert.ok(['route', 'retry', 'escalate', 'stop', 'unchanged'].includes(d.action))
    assert.ok(d.reason.length > 0)
  }
})

test('unknown signals are counted, not treated as failures', () => {
  const a = attribute(state({ signals: { tests: 'unknown', build: 'unknown', typecheck: 'pass' } }))
  assert.equal(a.unknownSignals, 2)
  const b = attribute(state({ signals: { tests: 'fail', build: 'fail', typecheck: 'fail' } }))
  assert.equal(b.unknownSignals, 0)
})

test('an unknown signal never escalates on its own', () => {
  const d = decide(state({ currentTier: 'cheap', signals: { tests: 'unknown', build: 'unknown' } }), POLICY)
  assert.equal(d.action, 'unchanged')
})

/* ---- the distinction the whole thing turns on ---- */

test('a transport failure retries elsewhere, it does not escalate capability', () => {
  const d = decide(state({ currentTier: 'mid', signals: { toolError: 'transport' } }), POLICY)
  assert.equal(d.action, 'retry', 'transport must not become a stronger model')
  assert.notEqual(d.tier, 'strong')
  assert.ok(d.reasonCodes.includes('TRANSPORT_FAILURE'))
})

test('a capability failure escalates', () => {
  const d = decide(state({ currentTier: 'cheap', signals: { toolError: 'capability' } }), POLICY)
  assert.equal(d.action, 'escalate')
  assert.equal(d.tier, 'strong')
  assert.ok(d.reasonCodes.includes('REPEATED_FAILURE'))
})

test('one failure is noise, two consecutive failures are evidence', () => {
  const one = decide(
    state({ currentTier: 'cheap', trajectory: baseTrajectory({ repeatedFailure: false, failureStreak: 1 }) }),
    POLICY,
  )
  const two = decide(
    state({ currentTier: 'cheap', trajectory: baseTrajectory({ repeatedFailure: true, failureStreak: 2 }) }),
    POLICY,
  )
  assert.equal(one.action, 'unchanged', 'a single failure must not escalate')
  assert.equal(two.action, 'escalate', 'repetition must escalate')
})

test('policy already at the strong tier is upheld, not re-escalated', () => {
  const d = decide(state({ currentTier: 'strong', signals: { toolError: 'capability' } }), POLICY)
  assert.equal(d.action, 'unchanged')
})

/* ---- stop and de-escalation ---- */

test('a met goal stops rather than escalating', () => {
  const d = decide(
    state({
      currentTier: 'cheap',
      trajectory: baseTrajectory({ verification: { status: 'passed' } }),
      signals: { tests: 'pass', build: 'pass', typecheck: 'pass' },
    }),
    POLICY,
  )
  assert.equal(d.action, 'stop')
})

test('fallbacks are ordered most-capable-first', () => {
  const d = decide(state({ trajectory: baseTrajectory() }), POLICY)
  assert.equal(d.action, 'route')
  const order = d.fallbacks.map((f) => f.tier)
  const capability: Record<string, number> = { local: 0, cheap: 1, mid: 2, strong: 3 }
  const sorted = [...order].sort((a, b) => (capability[b] ?? 0) - (capability[a] ?? 0))
  assert.deepEqual(order, sorted, 'an unordered fallback chain is a coin flip')
})

test('no fallback is the tier already in use', () => {
  const d = decide(state({ currentTier: 'mid', signals: { toolError: 'transport' } }), POLICY)
  assert.equal(d.action, 'retry')
  assert.notEqual(d.tier, 'mid')
})

/* ---- context ---- */

test('context pressure is reported when the window is known and nearly full', () => {
  const tight = decide(
    state({ currentTier: 'mid', trajectory: baseTrajectory({ contextTokens: 90000, contextWindow: 100000 }) }),
    POLICY,
  )
  assert.ok(tight.reasonCodes.includes('CONTEXT_PRESSURE'))

  const roomy = decide(
    state({ currentTier: 'mid', trajectory: baseTrajectory({ contextTokens: 10000, contextWindow: 100000 }) }),
    POLICY,
  )
  assert.ok(!roomy.reasonCodes.includes('CONTEXT_PRESSURE'))
})

/* ---- regression: the incident that produced this interface ---- */

test('nineteen models scoring 0/5 does not repeat here', async () => {
  // A full sweep recorded every eligible model as failed because a transport
  // outage was classified as a capability failure, and a strong tier was then
  // chosen for work a free model could do. A transport signal must never
  // reach the capability branch, and the free tier must stay eligible.
  const d = decide(
    state({ currentTier: 'cheap', signals: { toolError: 'transport' }, tiers: [...TIERS] }),
    POLICY,
  )
  assert.notEqual(d.action, 'escalate', 'a transport outage must not escalate capability')
  assert.equal(d.action, 'retry')
  assert.notEqual(d.tier, 'strong')
})
