# Host routing contract v1

The minimum host surface a scheduler needs to place one round of work. Written
2026-09-25 after an audit found Sabi's route names resolving to providers, which
is the failure this document exists to make impossible.

## Why this exists

A route that statically resolves to a provider is a route the operator wrote,
not one the scheduler chose. Sabi reached that state without anyone deciding to:
every tier in `sabi.config.json` names exactly one upstream, so the candidate
universe became the hand-written tier list. Adding a provider required adding a
public route name, which is how `sabi-gemini` came to exist.

The contract below is the seam that would have surfaced the drift at design time
rather than after the fact.

## The decision, not the provider

A host asks which capacity the next round needs. It does not ask which provider
should serve it.

```ts
export interface RoutingDecision {
  /** The model, if the host supports selecting one. */
  model?: string
  /** The provider, if the host exposes provider as a per-round parameter. */
  provider?: string
  /** Reasoning effort, when the host supports it. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** What the round requires, not what the current model happens to do well. */
  requirements: CapabilityRequirements
  /** Why this route. Required. A decision without a reason is not reviewable. */
  reason: string
}

export interface CapabilityRequirements {
  tools?: boolean
  vision?: boolean
  minContextTokens?: number
  reasoning?: boolean
  maxLatencyMs?: number
}
```

`provider` is an **output**. It appears in `RoutingDecision` because the host may
need it, not because the host may choose it.

## The invariant

> **No adaptive route may statically resolve to a provider. Every adaptive route
> must evaluate all eligible configured providers before selecting an execution
> target.**

Two supporting invariants, both of which encode defects found in production:

> **A model transition is a state transition over model, provider, effort,
> context ceiling, modality, and transport health — not `modelA → modelB`.**

> **The model that answered is a routing output, and it is verified against the
> model that was requested before anything learns from it.**

The second invariant is not theoretical. A 23-model manifest produced 23
identical validation scores because one model was answering for the whole pool
behind a cross-model fallback. The uniform result was the only visible symptom;
the substitution was invisible until the receipt was compared to the request.

## Per-host compatibility

What each host can actually honour today. This is a claim about shipped behaviour,
so every row is a statement someone can check.

| Host | model | provider | effort | native per-round | Source |
|---|---|---|---|---|---|
| Command Code | yes | n/a (own catalog) | yes | **yes** | `harness.tiers` in config; mod calls `planRound` |
| Codex | no | no | no | no | hooks only; README explicitly does not claim in-session switching |
| OpenCode | no | no | no | no | proxy config + controller plugin |
| Claude Code | no | no | no | no | hook install only |
| Orca | no | no | no | no | adapter manifest status `inventory-only` |
| Ollama | yes | n/a | no | yes | local upstream, one model per tier |

`TurnStartParams` in `openai/codex` already accepts per-turn `model` and
`effort`. It does not accept `modelProvider`. If provider were added, Codex would
move from "controller handoffs" to a true per-round adapter without forking the
agent loop. That is the seam worth watching, and the reason the Codex row is
blank rather than aspirational.

## Reference trajectory

`search → read → edit → test → failure → recovery → verification`. One file:
[`fixtures/reference-trajectory.json`](./fixtures/reference-trajectory.json).

It is a fixture rather than a benchmark on purpose. It demonstrates the decision
shape at each round and nothing more. Whether those decisions are *good* is an
empirical question answered by a separate evaluation, and conflating the two is
how a contract becomes a claim it has not earned.

## What the reference trajectory demonstrates

- **Round 1–2 (search, read)** need no reasoning and modest context. The
  strongest available model is wasted capacity here.
- **Round 3 (edit)** is the first that benefits from tools and effort.
- **Round 4 (test fails)** is the interesting one. Two failures with the same
  error is evidence of capability, not of availability. A transport 429 is not.
  Conflating them routes to a stronger model for a reason that was never true.
- **Round 5 (recovery)** is where a host with native effort control earns
  something a model-only router cannot.
- **Round 6 (verification)** returns to a cheap route. De-escalation is the
  half of adaptive routing that is usually not demonstrated.

## Not in this contract

- **Transport failover.** Same required capability, different healthy route.
  Distinct from capability escalation and currently handled separately in
  `router.ts`.
- **Model discovery.** The registry problem. This contract describes the seam
  once a candidate exists; it does not solve how candidates are enumerated.
- **Any claim about a host not listed above.** Adding a row means shipping the
  integration, not intending to.

## Open

The registry refactor that makes the first invariant enforceable is not written.
Until it exists, the invariant is documented rather than enforced, and the honest
status is: the contract is specified, the enforcement is pending.
