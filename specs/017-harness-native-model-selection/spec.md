# Feature Specification: Harness-Native Model Selection

**Feature Branch**: `017-harness-native-model-selection`
**Created**: 2026-09-28
**Status**: Planned

**Input**: The natural shape of Sabi inside a harness that owns its own
credentials. Today Sabi is a proxy that executes: OMP → Sabi:8787 → provider.
That makes Sabi responsible for holding provider keys, and it makes a dead key
a harness-wide outage.

**Relationship to existing work**: 016 defines the control interface a harness
uses to ask Sabi a question. This spec is narrower and orthogonal: **who dials
the provider.** In every current adapter Sabi dials. In a harness that exposes a
model-setting seam, the harness should dial, with its own credential, and Sabi
should only choose. 016's decision interface is how the recommendation travels;
this spec is what happens on the far side of it.

---

## Problem

Sabi cannot reach models a harness can already serve.

Measured on this machine, 2026-09-28:

| | what Sabi knows | what OMP can serve |
|---|---|---|
| providers | 4 configured (openrouter, gemini, nvidia, mistral) | 6 live: anthropic 26, google-antigravity 20, nvidia 176, openai-codex 8, opencode-go 42, openrouter 554 |
| credentials | its own `secrets.env` | the harness's own auth store |
| failure mode | one expired key strands every route | n/a |

Two consequences, both observed:

1. **Sabi's credential expired and the free lane died.** Sabi 401'd on
   `dots-studio/dots-3-note-preview:free`; the same model, requested through OMP,
   answered. A provider Sabi considered dead was live the whole time.
2. **Sabi's catalog is a hand-maintained list of eleven tiers**, and it is
   wrong by default. It advertised OpenRouter-style ids with a `:free` suffix
   against NVIDIA's *native* API, where they do not exist — all three returned
   404 and had never been verified by a completion.

Both are the same defect: Sabi enumerates capacity it does not control.

## Verified harness surfaces

The two harnesses are **not** the same surface, and the difference decides what
is buildable. This was measured, not assumed.

| surface | loaded from | interception | model-setting |
|---|---|---|---|
| OpenCode | `~/.local/state/sabi/hooks/opencode.mjs` via `opencode.json` `plugin` | `chat.message` hook; `POST /plan` → `POST /route`; rewrites `output.parts` | via the same hook |
| OMP (oh-my-pi) | `~/.omp/agent/extensions/sabi.ts` | **none** — OMP's extension API is `registerProvider`, `registerProviders`, `registerCommand`, `registerTool`, `registerMessageRenderer`, `registerMessageCacheInvalidator` | **`runtime.setModel`**, `runtime.sendMessage`, `runtime.sendUserMessage`, `runtime.getServiceTiers`, `runtime.setServiceTier`, `runtime.setThinkingLevel`, `runtime.transport` |

Proof that these are genuinely different: removing `provider.sabi` from
`~/.config/opencode/opencode.json` did not stop OMP answering — OMP was loading
its own extension from `~/.omp/agent/extensions/`, not OpenCode's config. A
provider defined once was being consumed by two unrelated loaders.

**Consequence:** the OpenCode plugin's `chat.message` hook must not be assumed
available anywhere. Sabi has adapters for both, and their surfaces differ.

## Decision

Sabi stops enumerating capacity it does not control, and stops being the thing
that dials when the harness can.

**Three rules, in order of importance:**

1. **The harness's catalog is the source of truth for what is reachable.** Sabi
   chooses from capacity the host reports. A tier Sabi believes in but the host
   cannot serve is not a candidate; a tier the host can serve and Sabi has never
   heard of is available the moment it is reported.

2. **The host dials when it can.** Sabi returns a model id; the host applies it
   with its own credential. No credential crosses to Sabi.

3. **A host that cannot apply a recommendation says so, per host.** A declared
   capability, consulted per session — never a global assumption, because the
   two harnesses demonstrably differ.

## Design

### A. Per-harness capability, declared by the adapter

```
HarnessSelection {
  harness: 'opencode' | 'oh-my-pi' | 'codex' | 'claude-code' | ...
  canApplyRecommendation: boolean   // can the host act on a chosen model?
  selectionScope: 'turn' | 'session' // how often can it change?
  reportsCatalog: boolean            // does the host enumerate its own models?
}
```

`packages/adapters/<harness>/src/` exports this. The router consults it when
building the candidate universe for a session. There is no global default: an
adapter that has not declared the field is treated as `canApplyRecommendation:
false`, because the safe answer to "can this host act on my recommendation" is
no until proven.

### B. Host-native capacity pools, only where applicable

The `capacity` block already exists (`executor: 'host'`, `models: string[]`) and
is already refused at dispatch with `route to host: Sabi cannot dial it`. That
refusal stays. What changes is that a host-native pool becomes a **legitimate
candidate** for hosts that can apply it, instead of a dead entry that fails a
request after the fact.

For a host that cannot apply a recommendation, host-native pools are excluded
from the universe at build time, and the receipt carries
`excluded: ['host-native', 'harness cannot apply a recommendation']`. Excluding
a pool that could never be served is strictly better than serving a request and
then failing it: a client gets a route that can answer.

### C. Sabi chooses, the host dials

The decision interface (016) returns a model id. On the host side:

- **OpenCode** — the `chat.message` hook already mutates `output.parts` to
  redirect a request. Extend the action set with a host-native selection; the
  plugin applies it and the session serves it with its own credential.
- **OMP** — the adapter calls `runtime.setModel(concreteId)`. Sabi is not in the
  request path at all, so there is no proxy to 8787 at request time.

### D. The limitation, stated rather than designed around

`runtime.setModel` is **session-scoped**, and OMP's extension surface has **no
pre-turn hook**. Therefore:

- **Per-round** adaptivity is not drivable from an OMP extension.
- The best available granularity is **per-turn**, if a turn boundary can be
  observed, and that is **unverified**.
- If it cannot, the honest OMP fit is a **session-scoped** Sabi: choose the model
  when the session starts, and say so — rather than advertising per-round
  routing that the surface cannot deliver.

Sabi must not claim adaptivity granularity it cannot deliver on a given host.
The receipt is the place this becomes visible, not the docs.

## Non-goals

- Not a credential-sharing mechanism. `borrowedCredentials` (shipped) is a
  separate, smaller thing: Sabi spends a key the caller lends. This spec is
  about not needing a key at all.
- Not a provider-agnostic capability negotiation standard. Sabi reports what it
  needs; hosts that do not implement it keep working.
- Not replacing 016. This spec consumes 016's decision and changes only who dials.

## Risks

- **A host reports a model and then cannot serve it.** Mitigated by the receipt:
  a 404/401 from a host-applied route is a real observation, and the pool
  carries that evidence on the next round.
- **Model drift.** The host renames a model; Sabi still recommends the old id.
  Mitigated by reporting: a host-native pool is only as current as the last
  report, and the receipt must record which report backed the choice.
- **Granularity regression.** Turning on host-native selection on OMP would
  silently move from per-round to per-session. That is a **behaviour** change and
  must be visible in the receipt, not silent.

## Acceptance criteria

1. An adapter that does not declare `canApplyRecommendation` yields
   `canApplyRecommendation: false`, and host-native pools are excluded from that
   session's candidate universe with a recorded reason.
2. A host-native pool is never selected for a session whose harness reports it
   cannot apply a recommendation. No request fails with
   `route to host: Sabi cannot dial it`.
3. A host reporting a catalog widens the candidate universe to include models
   Sabi had no configured tier for.
4. A round served by a host-native route records in its receipt: the pool, the
   executor, and the granularity (`turn` | `session`) the host actually applied.
5. Selection granularity is never reported as finer than the host's declared
   `selectionScope`.

## Phase 1 results (probed 2026-09-28, against OMP 18.4.1)

Answered by a temporary extension in `~/.omp/agent/extensions/`, since removed.
Every answer below is observed, not inferred.

**T001 — turn boundary: no.** The plugin facade exposes
`registerProvider`, `registerCommand`, `registerTool`, `registerMessageRenderer`.
`registerMessageCacheInvalidator` is `undefined`, and `registerProviders`
(plural) is `undefined`. There is no turn-boundary signal on the extension
surface.

**T001 — `setModel`: exists, and is an action method.** `runtime.setModel` is a
function, as are `sendMessage`, `sendUserMessage`, `setThinkingLevel`,
`setServiceTier` and `getServiceTiers`. But calling it during extension loading
throws `Extension runtime not initialized. Action methods cannot be called
during extension loading`, and it still throws when deferred 50ms into the run.
`runtime.transport` is `undefined`.

So `setModel` is legal only in a user-initiated action context — a command, or
an interactive turn — not from extension load and not from a timer.

**T002 — catalog read: no.** `getModels`, `listModels`, `availableModels`,
`resolveModel`, `providers`, `getProviders` and `listProviders` are all
`undefined` on both the plugin facade and `pi.runtime`. An extension cannot
enumerate what the host can serve. The names exist in the OMP distribution but
are not reachable from the extension surface.

### What this fixes

- The OMP adapter declares **`selectionScope: 'session'`**, and that is now
  measured rather than assumed.
- OMP's natural shape is **operator-invoked**: a `registerCommand` — Sabi
  chooses a model from policy, the command applies it, and the session serves it
  with OMP's own credential. That is a real and useful product, and it is not
  per-round adaptivity. Sabi must not advertise the latter here.
- **Acceptance criterion 3 does not hold on OMP.** The host cannot report its
  catalog, so rule 1 ("the host's catalog is the source of truth") degrades to
  "Sabi chooses from a configured list" — today's behaviour, with better
  hygiene. The criterion stands for hosts that can report; OMP is not one.

### Still open

- Whether OMP's extension surface has any **per-turn** signal in a
  non-interactive context. `omp -p` runs entirely inside extension loading, so a
  richer session context was not exercised and would need an interactive probe.
- Whether OpenCode's plugin can report its catalog to Sabi, which is the
  surface where rule 1 is most likely to hold.
