# Tasks: Sabi Control — Decision Interface and Host Seams

**Input**: `specs/016-sabi-control-decision-interface/spec.md`, `plan.md`
**Prerequisites**: none. Independent of 013/014/015.

## Phase 1: Closed types and the pure function

- [ ] **T001** `control-types.ts`: `SabiState` and `SabiDecision` as closed types.
  No index signature, no `metadata` bag. Explicitly no field for prompt text,
  file contents, or shell output.
- [ ] **T002** `Signals` with every field tri-state: `pass | fail | unknown`.
  `unknown` is a value, not an omission.
- [ ] **T003** `SabiDecision` as a discriminated union of exactly route, retry,
  escalate, stop. Every variant carries a `reason` and the evidence used.
- [ ] **T004** `decide(state, config): SabiDecision` — pure, total, deterministic.
  An unrecognised state yields `unchanged`, never a guess.
- [ ] **T005** Replay test: the same state decided one hundred times produces
  byte-identical decisions. This is the primary property; individual rules are
  secondary.
- [ ] **T006** Absence tests: empty state, partial state, and a state with
  hostile values each produce a valid decision rather than an error.

## Phase 2: Signal semantics

- [ ] **T010** Repetition: two consecutive failures of the same kind is different
  evidence from one. Assert the two produce different decisions.
- [ ] **T011** Transport failure versus capability failure. A transport error
  MUST NOT escalate capability; it changes route at the same capability.
- [ ] **T012** `unknown` never penalises. A route that would win on complete
  signals must not lose on partial ones.
- [ ] **T013** Command discovery: read the project's own test/build command from
  its manifest. Do NOT maintain a table of how to test other people's projects.
- [ ] **T014** Fixture reproducing the 19-models-at-0/5 incident, asserting the
  function does not repeat it.

## Phase 3: The endpoint

- [ ] **T020** `POST /v1/decide` in `packages/server/src/control.ts` as a thin
  adapter over `decide()`. No model call, no filesystem access, no mutation.
- [ ] **T021** Reject an unknown decision variant at the boundary rather than
  coercing it.
- [ ] **T022** Fail-open: with the decision service unreachable, the host's
  inference path is untouched and the host continues on its current model.
- [ ] **T023** Bounded request body. A host cannot make Sabi read a large
  payload by pointing it at one.

## Phase 4: Seams

- [ ] **T030** `seams.ts` deriving per-host capability from what each adapter
  implements. No hand-maintained table.
- [ ] **T031** A capability query a host can call, so a host learns what Sabi
  can do for it without reading documentation.
- [ ] **T032** Replace the hand-maintained compatibility table in
  `docs/research/host-routing-contract.md` with generated output, or delete the
  table and link the query.
- [ ] **T033** Test that two hosts, one with a full seam and one with none, do not
  affect each other. Adding a host must be purely additive.
- [ ] **T034** Test that the generated matrix equals what the adapters implement,
  so documentation cannot drift from code.

## Phase 5: De-escalation

- [ ] **T040** A trajectory fixture that escalates and then recovers, asserting
  the decision returns to a lower tier without a manual change.
- [ ] \*\*T041\*\* Assert the cache is preserved on the way down where a lower tier is
  cache-affine, reusing `cacheAwareRoute`'s economics.
- [ ] **T042** After the goal is met the decision is `stop`, not a higher tier.
- [ ] **T043** A fixture that demonstrates both directions. A trajectory with
  only an up-step does not demonstrate adaptive routing.

## Dependencies

- Phase 1 blocks everything. The endpoint is a thin adapter and adding it first
  would mean an unprovable surface.
- Phase 2 depends on Phase 1's types and is where the real routing semantics
  live.
- Phase 3 depends on 1 and 2.
- Phase 4 is independent of 1–3 and can land in parallel.
- Phase 5 depends on 2.

## Explicit non-goals

- Building a harness. Decided against in the spec, not deferred by omission.
- A specification language. Decided against; consume existing signals.
- Persistent objectives / SABI LOOPS. A later stage; this is the prerequisite.
- Fleet intelligence, which is 013 and sabi-code 001.
- Model discovery. Still unwritten and still the thing that would make the
  first invariant enforceable.
