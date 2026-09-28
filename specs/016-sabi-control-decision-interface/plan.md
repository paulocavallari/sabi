# Implementation Plan: Sabi Control — Decision Interface and Host Seams

**Branch**: 016-sabi-control-decision-interface | **Date**: 2026-09-27 | **Spec**:
[spec.md](./spec.md)

## Summary

Add one endpoint a host can call to ask what the next round needs, and a
generated per-host capability matrix so no documentation can claim a seam the
code does not provide. No harness, no specification language, no agent loop.

## Technical Context

TypeScript 5.9, Node ≥22.6. The decision function is pure and lives in
`packages/core`; the endpoint is a thin adapter in `packages/server`. No new
runtime dependency, no database, no model call on the decision path.

## Constitution Check

- **Native Harness, Bounded Scheduler** — PASS, and this spec is the clearest
  expression of it. Sabi schedules inference; the harness keeps its loop. The
  endpoint accepts a state and returns a decision; it never touches a filesystem.
- **Evidence Before Adaptation** — PASS. Every decision field is a typed fact with
  an `unknown` that means unknown, not zero. A decision cites the evidence it
  used.
- **Deterministic Safety Gates** — PASS. The decision is a closed union with a
  total function. An unrecognised state yields `unchanged`, never a guess.
- **Testable Contracts and Receipts** — PASS. Closed types, a pure function, and
  a replay test that asserts determinism.
- **Privacy, Simplicity, Reversibility** — PASS. Deleting the endpoint restores
  today's behaviour exactly, because nothing else depends on it.

## Project Structure

```text
packages/core/src/
├── control-types.ts    # SabiState, SabiDecision, closed (new)
├── decide.ts           # the pure decision function (new)
└── seams.ts            # per-host seam capability, derived from adapters (new)
packages/server/src/
└── control.ts          # POST /v1/decide — a thin adapter (new)
packages/server/test/
├── decide.test.ts      # determinism, absence, escalation symmetry
└── control.test.ts     # endpoint contract, fail-open
```

No new package. `decide.ts` is deliberately separate from `policy.ts` so the
existing tier policy keeps its own tests and the new surface is provable on its
own.

## Design Decisions

### One endpoint, not a protocol

The state object is a request body. There is no session, no handle, no polling,
and no stream. A host that wants a decision POSTs and acts. Anything richer
invites a host to model Sabi as a service it manages, which inverts the
dependency and makes Sabi look like a gateway it must keep alive.

### The state has no transcript

`SabiState` carries structured facts: pass/fail signals, a normalised error
code, a diff size, a round number. It does not carry prompt text, file contents,
or shell output.

This is the same boundary the evidence plane enforces on the way out
(`packages/evidence` in sabi-code forbids prompt, source, paths, and raw error
text in a telemetry event). Applying it on the way in keeps the rule symmetric and
means the decision interface cannot become a covert way to ship user content to
Sabi's infrastructure.

### `unknown` is not zero

A signal the host did not report is `unknown`, and `unknown` never penalises a
route. This is the rule that lets a host with no seam integrate safely: it
receives `unchanged` decisions and continues, rather than degraded ones it cannot
explain.

### The seam matrix is generated

`seams.ts` derives per-host capability from what each adapter actually
implements, and the same derivation backs both the capability endpoint and the
generated documentation table. A hand-maintained table drifts, and this repo
already has four disjoint adapter taxonomies that disagree — spec 014 exists
because that drift was expensive.

### Failure and repetition are different axes

One test failure is noise. Two consecutive failures of the same kind is evidence
of capability. A transport failure is evidence of nothing about capability. The
decision function takes all three and must not conflate them; conflating them is
the specific defect that routed 19 models to a 0/5 score.

### De-escalation is a requirement, not a nicety

A router that only escalates is a router that only spends. The acceptance
criteria require an escalate-then-recover trajectory to return to a lower tier, and
require the post-success decision to be `stop` rather than a higher tier. A
fixture without a down-step does not demonstrate adaptive routing.

## Phase Order

1. **Closed types and the pure function**, with determinism tests, before any
   endpoint exists.
2. **Signal semantics** — repetition, transport-versus-capability, `unknown`.
3. **The endpoint**, once the function is provable on its own.
4. **Seam derivation**, replacing the hand-maintained table in the research doc.
5. **De-escalation fixture**, once the up-step works.

## Verification Strategy

- **Determinism by replay.** The same state is decided many times and the
  decisions compared byte for byte. This is the primary property and it is
  cheaper to test than any individual rule.
- **Absence by construction.** Tests drive an empty state, a partial state, and a
  state with hostile values, and assert a valid decision each time rather than an
  error.
- **Fail-open by stopping the server**, not by mocking the client. The same
  discipline used for the health overlay.
- **Seams by construction.** A test asserts the generated matrix equals what the
  adapters implement, so the documentation cannot drift from the code.
