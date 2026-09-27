# specs/ consolidation review

**Date:** 2026-09-27
**Scope:** all 16 specs under `specs/` (001-evidence-aware-scheduler through
016-sabi-control-decision-interface), cross-checked against real source in
`packages/` and `log.md`. **Correction note:** an earlier version of this
review also claimed `tasks.md` was unreliable across the board (0/N checked
everywhere) — that claim was itself wrong, caught by automated PR review, and
is corrected in place in Finding A below. `tasks.md` turns out to be accurate;
only the `Status:` field in each `spec.md` was stale.

This is a review pass, not a spec. Findings that warranted an immediate,
mechanical, low-risk fix were applied directly (see "Applied in this pass"
below); findings that are real product/design decisions are left as
recommendations for Hugo to make.

---

## Finding A — the `Status` field was stale; `tasks.md` is actually reliable

**Correction (2026-09-27, same day as the original pass):** this section
originally claimed every `tasks.md` in all 16 specs showed 0 checked boxes,
and on that basis "corrected" 002's true claim that 001 had all 49 tasks
implemented into a false one. Both claims were wrong — an automated PR review
(Codex, on #144) caught it, verified by direct recount rather than trusted on
say-so:

```
001-evidence-aware-scheduler:      49/49 checked
002-execution-evidence-substrate:   3/16 checked
005-trajectory-ir-and-conformance:  7/10 checked
010-shadow-routing-telemetry:      10/10 checked
```

`tasks.md` is not dead metadata — it is a real, mostly-accurate record. The
actual finding is narrower: the `Status:` field in `spec.md` is what's stale,
and it's stale in one direction (says `Planned` for things that are `Built`
or `Partial`), not across the board.

| Spec | Status field said | Actually built | tasks.md |
|---|---|---|---|
| 001-evidence-aware-scheduler | Planned | **Built** — `TrajectoryEvidence`, `VerificationState`, `RecoveryCapsule` in `packages/core/src/{types,evidence}.ts`, `packages/controller/src/{registry,types}.ts` | 49/49, matches |
| 002-execution-evidence-substrate | Planned | **Partial** — `ExecutionReceipt`/`ExecutionCapabilities` in `packages/core/src/{receipts,capabilities,router}.ts`; but User Story 4 / FR-005 / SC-003 (every adapter emits the normalized receipt) is **not** shipped — `createAdapterEmitter` (`packages/core/src/adapter-emitter.ts`) exists only in its own definition and unit test, no Command Code/OpenCode/Hermes/Oh My Pi/Prime Agent/Orca/DSH path calls it | 3/16, matches |
| 005-trajectory-ir-and-conformance | Planned | **Built (Phases 1, 3, 4)** — `packages/core/src/{ir,manifest,conformance,decision}.ts`. Phase 2 (compat shim) and Phase 5 (convergence) remain open | 7/10, matches |
| 010-shadow-routing-telemetry | Planned | **Built (Phases 1-2)** — `packages/core/src/{shadow,shadow-store,shadow-sink}.ts`, wired into the server in PRs #136/#137 | 10/10, matches |
| 003, 004, 006-009, 011, 012, 013, 016 | Planned | Confirmed unbuilt — matches status | not checked further, consistent with 0 built |
| 014, 015 | Planned | The bug each describes (`capacityRank`/`preferenceRank` duplicated in both `agents.ts` and `controller.ts`) is confirmed still present | consistent |

The one real in-repo inconsistency that survives the correction: **only the
`Status:` line lies. `tasks.md` for every spec checked here tracks its own
implementation state correctly.** 002's original claim about 001 ("all 49
tasks implemented") was true and has been restored.

### Applied in this pass

- `specs/001/spec.md`, `005/spec.md`, `010/spec.md`: `Status` corrected to
  `Built` / `Built (Phases N)`, each citing the exact files that prove it and
  the matching `tasks.md` count.
- `specs/002/spec.md`: `Status` corrected to **`Partial`**, not `Built` — the
  adapter-emission user story is genuinely unshipped. 001's true "49 tasks
  implemented" claim is restored; the earlier, incorrect "correction" of it is
  reverted.

### Not applied — needs a real decision, not a mechanical fix

Whether to add a lightweight process (check boxes at merge time, or a CI check
that `tasks.md` completion and `spec.md`'s `Status:` field can't silently
diverge) so the `Status:` field doesn't drift stale again the way it did here
— that's a process decision, not something to bolt on unilaterally in a
review pass.

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
- **016's own internal gap** (flagged by automated PR review on #144,
  verified against the spec text): the closed decision union is
  `route | retry | escalate | stop`, but R4 ("fail-open, always") and
  acceptance criterion 6 under User Story 1 both require an unreachable
  service or a no-seam host to get an `unchanged` decision — a fifth outcome
  the union as written has no slot for. `tasks.md` T004 also names
  `unchanged` directly. Not fixed in this pass — this is 016's own
  requirements text, not something to resolve by editing around it. Needs
  either `unchanged` added to the union as a fifth variant, or an explicit
  statement of which existing variant (`route` to the current model, most
  likely) is defined to mean "no change."

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
5. **Add a mechanical check that `Status:` can't silently drift from
   `tasks.md` again** — e.g. a CI lint that flags a spec claiming `Planned`
   with a fully-checked `tasks.md`, or vice versa. `tasks.md` itself is
   accurate and worth keeping; it was the `Status:` field that went stale
   unnoticed.
