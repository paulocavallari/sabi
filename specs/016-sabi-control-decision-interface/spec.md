# Feature Specification: Sabi Control — Decision Interface and Host Seams

**Feature Branch**: `016-sabi-control-decision-interface`

**Created**: 2026-09-27

**Status**: Planned

**Input**: Architecture direction — Sabi does not build a harness. Claude Code,
Codex, Hermes and OpenCode already own tool execution, repository navigation,
shell, editing, context management, and the agent loop. Sabi sits inside or beside
them and decides *what intelligence each step needs*. This spec defines that
interface, the harness seams that implement it, and the boundary that keeps Sabi
from drifting back into being another coding agent.

**Relationship to existing work**: 013/001 are the evidence plane and the
service that produces fleet intelligence. 014/015 are identity and ranking
hygiene. This spec is the **control surface** — how a harness asks Sabi a question
and acts on the answer. It is the first thing to be missing: `packages/server`
exposes only `/v1/chat/completions`, borrowed-auth passthrough, and `/v1/models`.
There is no way for a host to ask for a decision.

**Relationship to `docs/prd.md` (2026-09-27):** the PRD's §9 "Decision
Contract" sketches a `SabiDecision` shape — `{provider, model, effort,
reasonCodes, confidence, fallback, ttl}` — that overlaps this spec's `route |
retry | escalate | stop` closed union without matching it field-for-field.
Reconciled here rather than left to drift: **this spec's shape is
authoritative.** The PRD is the umbrella product-vision document (52 sections
spanning Router/Live/Control); this spec is the scoped, testable engineering
spec with acceptance criteria and a plan for the one surface in question.
`docs/prd.md` §9 should be read as illustrative of the *concept* (a decision
carries provider/model/reason), not as the literal API — implement against
this spec, not that section. If `docs/prd.md` is revised, update its §9 to
point here instead of restating a competing shape.

## The boundary, stated once

> **Sabi routes tasks, not providers. The harness keeps its loop; Sabi returns the
> capacity needed for the next round.**

The harness is responsible for:

```text
read file · search repo · edit file · run shell · run tests
manage context · manage subagents · continue the task
```

Sabi is responsible for:

```text
which intelligence · from which provider · at what cost · with what effort
when to escalate · did this attempt work · should it retry · what was learned
```

## Context: what already exists

- `RoundReceipt` (`packages/controller/src/types.ts`) already carries
  `requestedModel`, `actualModel`, `identityMatch`, `substituted`, `latencyMs`,
  `failureCode`, `failureScope` — the outcome evidence a decision would consume.
- `cacheAwareRoute` (`packages/core/src/cache-routing.ts`) already models
  prompt-cache economics and holds a model through a tool cycle, switching only
  when a measured gain exceeds the cache penalty. This is the counter-intuitive
  behaviour a request-level router gets wrong.
- `ControllerSignals` (`packages/controller/src/signals.ts`) covers *orchestration*
  signals — stuck sessions, Orca availability, cwd matching. It does not cover
  *work* signals: test result, build result, typecheck result, diff size, tool error.
- `docs/research/host-routing-contract.md` states the decision shape and the
  per-host compatibility table. It has no implementation and no signal side.

## What we should not do

These are decisions, not omissions. Each has cost someone a rewrite.

- **Do not build a coding agent.** Tool execution, repository navigation, shell,
  editing, context management, and subagent orchestration are solved, expensively,
  by other people. Duplicating them is the single largest way Sabi could fail.
- **Do not fork or patch a host's agent loop.** The constitution already forbids
  this. Sabi schedules inference through supported extension surfaces.
- **Do not build a specification language.** Not `sabi-spec-v1`. Consume signals
  that already exist — a test command, a build command, `git diff`, a CI result —
  and let their exit codes and output be the evidence. A framework for describing
  work Sabi cannot yet interpret is a framework for describing nothing.
- **Do not claim a per-round decision for a host that cannot accept one.** The
  compatibility table in `host-routing-contract.md` is a record of shipped
  behaviour. A row is added when the integration ships, not when it is intended.
- **Do not make a successful response mean a decision succeeded.** A decision that
  routes to a model which then returns 200-with-no-content has failed. That
  distinction is the same one that made 23 models score identically.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A harness can ask for a decision (Priority: P1)

As a host that owns its own loop, I need to hand Sabi a description of where I am
and receive a decision I can act on, so that I do not have to reimplement
routing.

#### Acceptance Criteria

1. **One request, one decision.** A single endpoint accepts a state object and
   returns a decision. It is not a session, not a stream, and not a poll loop.
2. **The state is a closed type.** `SabiState` has no field for prompt text,
   file contents, or shell output. Hosts send structured facts, not transcripts.
3. **The decision is a closed union.** Exactly one of route, retry, escalate,
   stop. A host that receives an unknown variant MUST refuse it rather than
   guess.
4. **Every decision carries a reason.** A decision without a reason is not
   reviewable and is not testable.
5. **The endpoint is pure.** Same state, same config, same decision. It MUST NOT
   mutate the host, write files, or invoke a harness.
6. **Absence is an answer.** A host with nothing useful to send MUST get a usable
   decision, not an error. The common case is a host that cannot report signals.
7. **No control-plane dependency on inference.** If the decision service is
   unreachable, the host continues on its current model. Routing degrades to
   "unchanged", never to "failed".

#### Testing

- The same state replayed produces a byte-identical decision.
- An empty state produces a valid decision.
- An unknown decision variant is refused at the type boundary.
- With the service stopped, the host's request path is untouched.

### User Story 2 — Sabi consumes signals that already exist (Priority: P1)

As a developer running Claude Code, I want Sabi to understand my project's test
command and build without me describing them in Sabi's own vocabulary.

#### Acceptance Criteria

1. **Signals are facts, not prose.** `tests`, `build`, `typecheck` are
   pass/fail/unknown. `diffSize` is a number. `toolError` is a normalized code.
   Nothing is free text.
2. **`unknown` is a first-class value.** A signal Sabi was not told is `unknown`,
   and `unknown` never penalises a route.
3. **Repetition is evidence.** Two consecutive failures of the same kind is
   different from one, and a transport failure is different from both.
4. **Commands are discovered, not declared.** A project supplies its test command
   in its own manifest; Sabi reads it. Sabi does not maintain a table of how to
   test other people's projects.
5. **No project is described twice.** If a fact can be read from the repository,
   the host does not send it.

#### Testing

- A missing signal produces `unknown` and no penalty.
- A transport failure and a test failure route differently.
- One failure and two consecutive failures produce different decisions.

### User Story 3 — Each host gets an honest seam (Priority: P1)

As a Sabi user, I need the interface to tell me what my specific harness can
actually report and accept, so that I am not promised per-round control I do not
have.

#### Acceptance Criteria

1. **A capability query, not a claim.** A host can ask what Sabi can do for it,
   and the answer is derived from what the adapter actually implements.
2. **The matrix is generated, not maintained.** It cannot drift from the code.
3. **A host with no seam is supported.** It gets `unchanged` decisions and
   continues. That is a valid integration, not a failure.
4. **Adding a host is additive.** It cannot change the answer for an existing
   host.

#### Testing

- Two hosts, one with full seam and one with none, and the no-seam host is
  unaffected by the other.
- The capability response matches the adapter implementation.

### User Story 4 — De-escalation is demonstrable (Priority: P2)

As a user, I need to see that Sabi gives capacity back when the work gets easy,
because a router that only escalates is a router that only spends.

#### Acceptance Criteria

1. **Recovery routes down.** A trajectory that escalated MUST be able to return
   to a lower tier without a manual change.
2. **The cache is preserved on the way down.** Dropping to a lower tier that is
   cache-affine is preferred over an unmeasured switch.
3. **A trajectory that finishes stays finished.** No decision escalates after the
   goal is met.

#### Testing

- A escalate-then-recover trajectory shows both directions.
- The decision after success is `stop`, not a higher tier.

## Requirements

### R1 — Closed state, closed decision

`SabiState` and `SabiDecision` are closed types. No index signatures, no
`metadata` bag. A new field is a design decision that must survive review.

### R2 — Purity and determinism

The decision function is pure. It reads state and config, and returns a decision.
It performs no I/O, mutates nothing, and is deterministic given the same inputs.

### R3 — Absence is answerable

An incomplete state yields a valid, conservative decision. `unknown` is never
an error.

### R4 — Fail-open, always

The host's request path never depends on Sabi. An unreachable service yields
`unchanged`.

### R5 — Honest seams

Per-host capability is derived from implementation. Documentation cannot claim
a seam the code does not provide.

## Out of Scope

- **Building a harness.** Explicitly rejected above.
- **A specification language.** Explicitly rejected above.
- **Persistent objectives / SABI LOOPS.** A later stage; the decision interface
  is the prerequisite and this spec does not build it.
- **Fleet intelligence itself.** That is 013 and sabi-code 001.
- **Model discovery.** The registry problem, which remains unwritten.

## Success Criteria

- [ ] A host can POST state and receive a valid decision, with no harness built.
- [ ] Replaying a state produces an identical decision.
- [ ] Empty and partial states produce usable decisions.
- [ ] An unreachable decision service leaves the host's inference untouched.
- [ ] The per-host capability matrix is generated from adapters, not written.
- [ ] A trajectory that escalates is shown to de-escalate.
- [ ] No field exists for prompt text, file contents, or shell output.
