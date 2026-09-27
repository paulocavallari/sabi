# specs/ consolidation review

**Date:** 2026-09-27
**Scope:** all 16 specs under `specs/` (001-evidence-aware-scheduler through
016-sabi-control-decision-interface), cross-checked against real source in
`packages/` and `log.md` — not against titles or `tasks.md` alone, both of
which turn out to be unreliable (see Finding A).

This is a review pass, not a spec. Findings that warranted an immediate,
mechanical, low-risk fix were applied directly (see "Applied in this pass"
below); findings that are real product/design decisions are left as
recommendations for Hugo to make.

---

## Finding A — the `Status` field and `tasks.md` are dead metadata

Every one of the 16 specs' `spec.md` says `**Status**: Planned`. Four are
actually **built**, verified directly against the working tree:

| Spec | Status field said | Actually built |
|---|---|---|
| 001-evidence-aware-scheduler | Planned | **Built** — `TrajectoryEvidence`, `VerificationState`, `RecoveryCapsule` in `packages/core/src/{types,evidence}.ts`, `packages/controller/src/{registry,types}.ts` |
| 002-execution-evidence-substrate | Planned | **Built** — `ExecutionReceipt`/`ExecutionCapabilities` in `packages/core/src/{receipts,capabilities,router}.ts` |
| 005-trajectory-ir-and-conformance | Planned | **Built (Phases 1, 3, 4)** — `packages/core/src/{ir,manifest,conformance,decision}.ts`. Phase 2 (compat shim) and Phase 5 (convergence) remain open |
| 010-shadow-routing-telemetry | Planned | **Built (Phases 1-2)** — `packages/core/src/{shadow,shadow-store,shadow-sink}.ts`, wired into the server in PRs #136/#137 |
| 003, 004, 006-009, 011, 012, 013, 016 | Planned | Confirmed unbuilt — matches status |
| 014, 015 | Planned | The bug each describes (`capacityRank`/`preferenceRank` duplicated in both `agents.ts` and `controller.ts`) is confirmed still present |

Every `tasks.md` in all 16 specs shows **0 checked boxes**, including the four
that shipped real code. `git log` / `log.md` are the only reliable record of
what actually exists — the `specs/` directory itself does not track it.

**Worse:** 002's own Input line claimed *"001-evidence-aware-scheduler (all 49
tasks implemented)"* — a direct, in-repo contradiction of 001's own
`tasks.md` (0/49 checked) and its own `Status: Planned`, written by whoever
authored 002.

### Applied in this pass

- `specs/001/spec.md`, `002/spec.md`, `005/spec.md`, `010/spec.md`: `Status`
  corrected to `Built` (or `Built (Phases N)` where partial), each citing the
  exact files that prove it and noting `tasks.md` is not the record to trust.
- `specs/002/spec.md`: the false "49 tasks implemented" claim corrected with
  an inline note — the underlying code claim was real, the tasks.md-completion
  claim was not.

### Not applied — needs a real decision, not a mechanical fix

`tasks.md` itself was left unchecked in all four (checking 49+ boxes by
inference risks getting the mapping wrong in ways that are worse than the
current honest "never touched" state). If this matters going forward, the fix
is process, not a one-time edit: check boxes at merge time, or drop `tasks.md`
in favor of `log.md` as the single source of "what shipped" and say so in the
spec-kit template used to generate these.

---

## Cross-spec contradictions and undeclared seams

- **016 vs. `docs/prd.md` §9 (Decision Contract).** Different `SabiDecision`
  shapes — 016's is a closed union (`route | retry | escalate | stop`), the
  PRD's is flat (`{provider, model, effort, reasonCodes, confidence,
  fallback, ttl}`). **Reconciled in this pass**: added a note to
  `specs/016/spec.md`'s Relationship section making 016's shape authoritative
  and the PRD's §9 illustrative-only. If `docs/prd.md` is revised later, its
  §9 should point at 016 rather than restate a shape.
- **012 vs. 016 on escalation.** 012 owns escalation *scoring* (`RouteLevel`
  L0-L4, additive signal weights, score-to-tier thresholds). 016 independently
  promises escalation/de-escalation as a demonstrable success criterion (User
  Story 4) without citing 012's scoring model anywhere. Not contradictory, but
  the seam — "016's decision function calls 012's scorer for the
  escalate/de-escalate call" — is nowhere written down. Two people could
  build two different escalation mechanisms and neither would be wrong per
  their own spec. **Not fixed in this pass** — needs the two spec owners (or
  Hugo) to agree who calls whom, and 016 should cite 012 the way it already
  cites 013/001/014/015.
- **013 explicitly disclaims overlap with 010** ("mirrors are the local
  dataset that can later justify a 010 Phase 3 promotion ... complementary and
  must not be merged"). This is the one place in the corpus a spec
  proactively prevents drift instead of leaving it implicit — worth copying
  the pattern into 012/016's relationship once that seam is written.
- **013 pushes the entire Sabi Live server side** (fleet aggregation,
  ClickHouse, ingest API) to "the companion sabi-code spec." This means
  `specs/` in *this* repository never covers Live's server half at all — not
  a contradiction, but worth knowing before assuming this directory is a
  complete picture of Live.

---

## Quality assessment

Above average for a spec-kit corpus. Consistently present across nearly all
16: a `Context: what already exists` section citing real `file:line`
locations (not vague description), an `Out of Scope` section that names the
*other* spec that owns each excluded concern (014/015/016 do this precisely),
Edge Cases sections, and FR-numbered requirements with testable acceptance
criteria. 001 and 012 are the strongest — 012 cites the exact `POLICY_ORDER`
cascade from the real `policy.ts` rather than describing an idealized one.
001's Assumptions section explicitly labels its research inputs "research
inputs for design, not independently verified benchmark evidence" — this
repo's own `AGENTS.md` evidence rule, self-applied inside a spec rather than
just followed by whoever implements it later.

**Weakest: 011-huggingface-presence.** Reads as a launch/marketing checklist
— thinner Context section, no FR-numbered requirements, more prose than
engineering constraint. Not bad on its own terms, just a different register
than the other 15. Recommend moving it out of `specs/` into `docs/` alongside
the existing `docs/submission-launch.md`, which already holds this kind of
content — not done in this pass since it changes a path other tooling or
links might reference.

None of the 16 read as scope-creeping into harness territory. The PRD's own
drift test ("does this help Sabi decide, or help the agent do the work") is
satisfied everywhere checked; 005 and 007 are explicit about staying on the
adapter/protocol side rather than reimplementing one.

---

## Gaps: `docs/prd.md` sections with no corresponding spec anywhere in `specs/`

Going through the PRD section by section against all 16 specs:

| PRD section | Covered by | Verdict |
|---|---|---|
| §14 Task classification taxonomy (15 classes) | Loosely — 009's semantic plane, the existing coarser `RoundKind` (5 classes) | **Real gap** — nothing adopts the PRD's granular taxonomy |
| §21 Live storage split (Postgres/ClickHouse) | Explicitly deferred by 013 to "the companion sabi-code spec" | **Gap by design in this repo** — may exist there, invisible here |
| §22 Event model (`trajectory.started`, `round.completed`, ...) | Loosely — 002/005 have adapter-level emission, not this exact taxonomy | **Real gap** |
| §27 User policy YAML (`strategy: free-first`, `privacy.fleet_telemetry`, ...) | Nothing | **Real gap** — no spec defines a user-facing policy config format |
| §28 Automatic provider discovery | Nothing — **016 itself says so**: "Model discovery. The registry problem, which remains unwritten." | **Confirmed gap, self-acknowledged in-repo** |
| §38 UX (`sabi install`/`sabi status` shape) | Partial — the real CLI (`sabi status`, `sabi doctor`) exists but no spec pins the PRD's envisioned output | Minor gap |
| §40 User override (pin model, disable escalation, cost ceiling as a formal layer) | Partial — `override?.sessionId` / `override?.harness` exist in `controller.ts` today, narrower than the PRD's fuller override vision | **Partial gap** |
| §41 Product metrics (success rate, cost-per-successful-trajectory, escalation rate) | Nothing | **Real gap** |
| §46 Six-phase rollout | `docs/roadmap-12-month.md` exists but sequences by calendar quarter, predates specs 012-016 entirely, and doesn't use the PRD's phase vocabulary | **Roadmap is stale relative to 5 specs and the PRD's own framing** |

§28 is the load-bearing one: without provider discovery, §14 (task
classification against a live catalogue) and §29 (quota awareness) have
nothing real to classify against. It blocks two other gaps, not just itself.

---

## Recommendations not applied in this pass (real decisions, not mechanics)

1. **Write the 012↔016 seam** — one line in 016's Context section naming which
   function 016's decide() calls for escalation scoring, and until 012 ships,
   what the interim deterministic rule is.
2. **New spec for §27 (user policy) and §28 (provider discovery).** Both are
   PRD-load-bearing and have zero spec coverage; §28 specifically blocks §14
   and §29 from being implementable in practice.
3. **Move 011 out of `specs/` into `docs/`** next to `submission-launch.md`.
4. **Regenerate or explicitly retire `docs/roadmap-12-month.md`** — fold specs
   012-016 and the PRD's 6-phase framing into a v2, or mark it superseded by
   `docs/prd.md` §46 so nobody plans against stale phase names.
5. **Decide whether `tasks.md` is worth maintaining at all** going forward,
   given it has never once been checked off against real, shipped code across
   four specs that fully shipped.
