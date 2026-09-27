# PRD → current architecture reconciliation

**Date:** 2026-09-27
**Input:** External review of `docs/prd.md` against a generated diagram of Sabi's
current runtime (coding harness → session hook / proxy → controller daemon /
providers, with Jev and local state). Filed verbatim as received — this is an
outside analysis, not a spec. It maps the PRD's three layers (Router / Live /
Control) onto what already exists in this repository and argues the gap is
smaller than the PRD alone suggests.

**Relationship to specs**: this document overlaps substantially with
`specs/016-sabi-control-decision-interface/` (the `SabiState` /
`SabiDecision` / `decide()` interface), which was written independently and is
the authoritative spec for that surface. Where the two disagree, the spec
wins — this file is context, not a second source of truth.

---

This is actually a very good starting point for the PRD. Looking at the diagram, **you already have most of the local substrate for Sabi NOW and the beginning of Control**. You do not need to redesign this from scratch.

The current architecture appears to be:

```text
                    Coding Harness
              Claude / Codex / Hermes
                    │          │
          per-prompt│          │OpenAI request
                    ▼          ▼
              Session Hook   Sabi Proxy :8787
                    │          │
                    ▼          ├──────────────► Providers
          Controller :7433     │
                    │          └────► Jev
                    ▼
                Local State
```

And that gives you a clean place to evolve each layer.

| PRD layer | Current state | Missing major piece |
|---|---|---|
| **Sabi NOW** | Largely present | richer provider/capability/health routing |
| **Sabi LIVE** | Not visible yet | fleet telemetry + health/catalogue feeds |
| **Sabi CONTROL** | Foundation exists | real trajectory state + event-driven decisions |

The important thing is: **I would preserve this architecture.**

## What you already have

### 1. The Proxy is clearly the Router execution plane

Your:

```text
Sabi Proxy
OpenAI-compatible :8787
```

is essentially:

```text
SABI ROUTER
```

It receives inference requests and owns the final provider/model dispatch.

That should remain deliberately dumb compared with the Controller.

Its job is approximately:

```text
receive inference
↓
obtain route decision
↓
call provider
↓
classify result
↓
fallback if necessary
↓
report outcome
```

Don't stuff trajectory reasoning into the proxy.

---

### 2. Your Controller Daemon is already where Sabi Control belongs

This is the strongest part of the diagram.

You already have:

```text
Session Hook
      ↓
Controller Daemon :7433
      ↓
Local State
```

That means you don't need to invent another "Control service."

The Controller can simply evolve from:

> session routing / registry

into:

> **local trajectory decision engine**

So structurally:

```text
CURRENT

Controller
├── sessions
├── routing decisions
└── registry
```

becomes:

```text
CONTROL

Controller
├── sessions
├── trajectories
├── rounds
├── routing policy
├── capability registry
├── local health
├── circuit breakers
├── escalation state
├── Live feed cache
└── decisions
```

Same daemon.

Much more intelligence.

---

# The biggest thing missing is the Trajectory

Right now the diagram seems organized around:

```text
prompt
→ route
```

Control needs:

```text
trajectory
  ├── round 1
  ├── round 2
  ├── round 3
  └── ...
```

So I would introduce one object into Local State:

```ts
interface Trajectory {
  id: string
  harness: string

  startedAt: number
  updatedAt: number

  currentRound: number

  rounds: RoundSummary[]

  state: {
    phase?: string
    consecutiveFailures: number
    repeatedError?: string

    currentTier: "free" | "cheap" | "mid" | "strong"

    costUsed?: number
    contextPressure?: number

    lastSuccessfulRoute?: Route
  }
}
```

And every inference gets:

```text
trajectory_id
round_id
```

This is probably the most important architectural change from where you are now.

---

# Then make the Session Hook emit evidence

Your Session Hook currently appears to call something like:

```text
POST /plan
/route
```

That's good.

But Control needs the hook to become a source of **normalized events**, not another agent.

For example:

```text
trajectory.started

round.started

tool.completed
tool.failed

verification.passed
verification.failed

round.completed
round.failed

trajectory.completed
```

Claude Code might expose more events than another harness.

That's okay.

Control needs to tolerate:

```text
rich signals
```

and:

```text
only basic inference signals
```

with the same architecture.

---

# I would change the request flow slightly

What I suspect you currently have is:

```text
Harness
    ↓
Proxy
    ↓
Provider
```

plus independently:

```text
Harness
    ↓
Hook
    ↓
Controller
```

Those two paths now need to meet logically.

Not necessarily synchronously.

Something like:

```text
                HARNESS
              /         \
             /           \
     lifecycle events   inference
          │                │
          ▼                ▼
      Session Hook      Sabi Proxy
          │                │
          ▼                │
      Controller ◄─────────┘
          │
          ▼
       decide()
          │
          ▼
      Sabi Proxy
          │
          ▼
       Provider
```

The proxy asks:

```text
POST localhost:7433/v1/decide
```

with something compact:

```json
{
  "trajectory_id": "abc",
  "round_id": 14,
  "request": {
    "context_tokens": 42000,
    "tools": true
  }
}
```

Controller returns:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet",
  "effort": "high",

  "reason_codes": [
    "REPEATED_FAILURE",
    "SEMANTIC_ESCALATION"
  ],

  "fallback": [
    "openai/codex"
  ]
}
```

Then Proxy performs it.

That's the cleanest division I see from your current diagram.

---

# Jev is already in approximately the right place

Your diagram shows:

```text
Sabi Proxy
   └── classify failure ──► Jev
```

I would broaden that slightly.

Jev shouldn't just classify failures.

Eventually:

```text
                        ┌─ deterministic rules
                        │
Trajectory State ───────┼─ statistics
                        │
                        ├─ Jev
                        │
                        └─ strong model if genuinely necessary
                                  │
                                  ▼
                               Decision
```

Potential Jev questions:

```text
Did this fail semantically?

Is this probably the same failure?

Has this become a harder task?

Should Sabi escalate?

Can Sabi safely de-escalate?

Is this retry meaningfully different?
```

But I would **not put Jev inline for every request** unless latency proves negligible and its decision is actually useful.

Many decisions should just be:

```ts
if (localCircuitBreaker.open)
    removeCandidate()
```

No model required.

---

# Where LIVE fits

This is the biggest missing box from the current image.

And importantly, **Live should sit beside the Controller, not in front of the Proxy.**

Something like:

```text
                    SABI CLOUD
        ┌───────────────────────────────┐
        │                               │
        │ telemetry ingest             │
        │      ↓                        │
        │ ClickHouse                    │
        │      ↓                        │
        │ fleet aggregation             │
        │      ↓                        │
        │ /feed/v1/health               │
        │ /feed/v1/catalogue            │
        │                               │
        └───────────────┬───────────────┘
                        │
                     HTTPS
                        │
 ───────────────────────┼──────────────── LOCAL
                        ▼
                 Controller Daemon
                  │             │
          telemetry out     feeds in
                  │             │
                  ▼             ▼
            local evidence   cached fleet state
```

The Proxy should never have to do:

```text
inference
↓
wait for sabi.com
↓
route
```

That introduces exactly the dependency you don't want.

Instead:

```text
Controller daemon
    ↓
refresh health every N seconds
    ↓
cache locally
```

Then `decide()` remains local and fast.

---

# I would add four things to Local State

Your purple `.sabi/ + state dir` block becomes increasingly important.

I'd divide its contents logically:

```text
.sabi/
│
├── catalogue/
│   └── providers + models
│
├── health/
│   ├── local.json
│   └── fleet.json
│
├── trajectories/
│   └── <trajectory-id>.json
│
└── policy/
    └── config
```

Not necessarily these exact files—the conceptual separation matters.

There are four different types of state:

**Catalogue**

> What exists?

**Health**

> What works?

**Trajectory**

> What has happened?

**Policy**

> What does the user want?

And `decide()` combines all four:

```text
Catalogue
    +
Health
    +
Trajectory
    +
Policy
    ↓
Decision
```

That's basically **Sabi Control**.

---

# One important thing in your diagram I would change conceptually

Right now there is a label:

```text
Controller
"decisions + registry"
```

I'd formalize that as:

```text
Controller
────────────────────

Registry
State
Policy
Decision Engine
```

And treat them as distinct modules internally:

```ts
controller/
  registry/
  state/
  policy/
  decision/
  trajectory/
  health/
```

Because otherwise you'll gradually get one 4,000-line `controller.ts` containing every Sabi idea.

---

# And don't make Orca special

Your diagram currently has:

```text
Controller
  ↓
enumerate sessions
  ↓
Orca IDE
```

That's fine as an adapter.

But architecturally I'd make:

```text
                Controller
                     │
          Adapter interface
         /      |       |      \
        ▼       ▼       ▼       ▼
     Claude   Codex   Hermes   Orca
```

Orca shouldn't become an architectural dependency.

Same rule for Claude/Codex.

The invariant should be:

```ts
interface HarnessAdapter {
  identifyTrajectory(): ...
  observeEvents(): ...
  applyRoute(): ...
}
```

Anything additional is harness-specific enhancement.

That preserves Sabi if one of these systems changes completely six months from now.

---

# So the evolution from exactly this image is surprisingly small

I would **not** do:

```text
rewrite architecture
```

I'd do:

```text
CURRENT
────────────────

Proxy
Controller
Session Hook
Local State
Jev
Providers


        ↓


SABI NOW
────────────────

+ normalized provider registry
+ capability registry
+ local health
+ circuit breakers
+ reason-coded routing


        ↓


SABI LIVE
────────────────

+ telemetry publisher
+ health feed client
+ catalogue feed client
+ ClickHouse backend
+ fleet aggregation

Controller consumes cached Live evidence.


        ↓


SABI CONTROL
────────────────

+ trajectory_id
+ round_id
+ normalized events
+ trajectory state
+ escalation/de-escalation
+ outcome evaluation

Controller uses trajectory state in decide().
```

That is much less architecture than the PRD sounds like.

---

## And I think your current split reveals the right Sabi kernel

At the end, nearly all of Sabi reduces to one function conceptually:

```ts
decision = decide({
  request,
  trajectory,
  catalogue,
  localHealth,
  fleetHealth,
  policy
})
```

Which returns:

```ts
{
  provider,
  model,
  effort,
  fallbacks,
  reasonCodes
}
```

Everything else exists to improve the quality of that input.

**Router** executes the decision.

**Live** improves `fleetHealth` and `catalogue`.

**Control** improves `trajectory`.

That's the architecture I would build from the system in your screenshot. I would resist introducing another major runtime component—the pieces you already have are enough.
