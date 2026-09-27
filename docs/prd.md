# Sabi Product Requirements Document

**Product:** Sabi
**Architecture:** Sabi Router → Sabi Live → Sabi Control
**Status:** Product architecture / implementation specification
**Version:** 1.0
**Date:** 27 September 2026

---

# 1. Executive Summary

Sabi is an adaptive intelligence control layer for AI agents.

It does not replace Claude Code, Codex, Hermes, OpenCode, or other coding harnesses.

Those systems remain responsible for:

- understanding repositories;
- maintaining agent context;
- reading and editing files;
- running tools;
- executing shell commands;
- spawning subagents;
- managing task loops;
- interacting with the user.

Sabi sits beneath or beside those systems and answers a narrower but increasingly important question:

> **What intelligence should this agent use next, given the task, trajectory, available providers, current failures, cost, quota, and observed model health?**

The product evolves through three layers.

```text
SABI NOW
Adaptive model routing
        │
        ▼
SABI LIVE
Availability + fleet intelligence
        │
        ▼
SABI CONTROL
Trajectory-aware intelligence decisions
```

The progression does not turn Sabi into a harness.

Instead, each layer gives Sabi a better understanding of the environment in which existing harnesses operate.

Sabi Router answers:

> Which model/provider should handle this request?

Sabi Live answers:

> Which models/providers are actually usable right now?

Sabi Control answers:

> Given everything that has happened so far in this agent trajectory, what kind of intelligence should handle the next round?

The long-term product thesis is:

> **Keep your agent. Sabi controls how it spends intelligence.**

---

# 2. Problem

Modern coding agents frequently bind an entire task or session to one premium model.

A task such as:

> Understand authentication and fix this bug.

may contain dozens or hundreds of inference rounds.

Those rounds are not equally difficult.

A trajectory may contain:

```text
search repository
read package.json
inspect type
summarize file
follow import
classify error
edit boilerplate
run tests
interpret failure
design architecture
debug race condition
review final implementation
```

Using the same expensive model for every round creates three problems.

### Cost inefficiency

Simple retrieval, classification, summarization, and mechanical editing can often be performed by cheaper or free models.

### Resource inefficiency

Users already possess access to multiple pools of inference:

- Claude subscriptions;
- Codex;
- OpenRouter;
- Gemini;
- Mistral;
- NVIDIA;
- local models;
- free provider quotas;
- promotional capacity;
- other APIs.

Most of that capacity is fragmented and manually managed.

### Static routing

Existing routers commonly select a model based primarily on the incoming request.

But difficulty changes during an agent trajectory.

```text
Round 1   easy
Round 2   easy
Round 3   easy
Round 4   tool failure
Round 5   ambiguous
Round 6   difficult
Round 7   mechanical
Round 8   test failure
Round 9   difficult
Round 10  trivial
```

A decision made at the beginning of the task cannot efficiently govern all ten rounds.

Sabi therefore treats **the trajectory itself as a dynamic state machine**.

---

# 3. Product Vision

Sabi becomes the intelligence control plane shared by existing AI agents.

```text
                    USER
                      │
                      ▼
     ┌────────────────────────────────┐
     │ Claude Code / Codex / Hermes   │
     │ OpenCode / future harnesses    │
     └───────────────┬────────────────┘
                     │
                     │ inference boundary
                     ▼
              ┌──────────────┐
              │     SABI     │
              │              │
              │ availability │
              │ capability   │
              │ cost         │
              │ trajectory   │
              │ policy       │
              │ reliability  │
              │ escalation   │
              └──────┬───────┘
                     │
          ┌──────────┼────────────┐
          ▼          ▼            ▼
       Provider   Provider     Provider
          A          B            C
          │          │            │
          ▼          ▼            ▼
       Model      Model        Model
```

The harness owns **execution**.

Sabi owns **intelligence allocation**.

---

# 4. Strategic Product Boundary

This boundary is critical.

## Sabi owns

Sabi should own:

- provider selection;
- model selection;
- model capability metadata;
- availability;
- quota awareness;
- pricing/cost awareness;
- free-capacity discovery;
- fallback;
- circuit breaking;
- inference health;
- task/round classification;
- trajectory state;
- escalation;
- model effort selection;
- policy;
- routing telemetry;
- decision telemetry;
- fleet-level health intelligence;
- optional decision evaluation;
- routing recommendations to harnesses.

## Sabi does not own

Sabi should not become:

- a code editor;
- filesystem abstraction;
- shell environment;
- Git implementation;
- testing framework;
- browser automation framework;
- coding-agent UI;
- repository indexer;
- autonomous planning engine;
- CI platform;
- deployment platform;
- observability platform;
- task-management system.

Those functions belong to the harness or existing developer tooling.

Sabi may **consume signals** from those systems without replacing them.

---

# 5. Product Layers

# 5.1 Sabi Router — Adaptive Model Routing

Sabi Router is the local runtime.

Its responsibility is to choose where an inference round should execute.

Input:

```text
request
available providers
available models
local policy
model capabilities
current quotas
recent failures
cost preferences
```

Output:

```text
provider
model
effort
timeout
fallback sequence
```

Conceptually:

```text
request
   │
   ▼
classify
   │
   ▼
filter impossible candidates
   │
   ▼
rank valid candidates
   │
   ▼
select route
   │
   ▼
execute
   │
   ▼
observe
   │
   ├── success → update local state
   │
   └── failure → classify + reroute
```

This layer must work completely without Sabi Live.

Sabi must remain useful offline and without a Sabi account wherever provider APIs themselves remain reachable.

---

# 5.2 Sabi Live — Fleet Intelligence

Sabi Live adds shared knowledge.

A single router can know:

> NVIDIA returned a 429 for me.

A fleet can infer:

> This model is currently throttling across multiple independent installations.

That creates an intelligence network.

```text
Router A ─┐
Router B ─┤
Router C ─┼────► Sabi Live
Router D ─┤
Router E ─┘
              │
              ▼
      aggregate evidence
              │
              ▼
       fleet health feed
              │
       ┌──────┼──────┐
       ▼      ▼      ▼
       A      B      C
```

Live does not remotely control the router.

It provides evidence.

The local router always makes the final routing decision.

This makes the architecture resilient if:

- Sabi Live goes offline;
- telemetry is disabled;
- network connectivity is poor;
- fleet information is stale.

---

# 5.3 Sabi Control — Trajectory-Aware Decisions

Sabi Control introduces persistent awareness of the current agent trajectory.

Router asks:

> What model fits this round?

Control asks:

> What model fits this round **given what just happened?**

Example:

```text
Round 1
cheap model
repository search
success

Round 2
cheap model
read files
success

Round 3
cheap model
attempt fix
failure

Round 4
cheap model
attempt fix
same failure

Sabi Control:
repeated semantic failure detected

Round 5
strong model
diagnose root cause
success

Round 6
cheap model
mechanical implementation
success
```

Control therefore introduces a higher-order state:

```text
current task
+
previous rounds
+
tool results
+
model results
+
failure history
+
cost consumed
+
time consumed
+
context pressure
+
current environment signals
```

The output remains a **decision about intelligence**, not an execution command.

---

# 6. Core Product Principle

The fundamental primitive is:

```text
STATE → DECISION → RESULT → UPDATED STATE
```

Not:

```text
PROMPT → MODEL
```

Sabi becomes a stateful decision system.

---

# 7. Core Data Model

The primary object introduced by Sabi Control is the **Trajectory**.

```ts
interface Trajectory {
  id: string;

  startedAt: number;

  harness?: string;

  goal?: GoalDescriptor;

  rounds: Round[];

  state: TrajectoryState;

  policy: RoutingPolicy;
}
```

A trajectory is composed of rounds.

```ts
interface Round {
  id: string;

  timestamp: number;

  taskClass?: TaskClass;

  route: Route;

  inputMetadata: InputMetadata;

  result?: RoundResult;

  toolSignals?: ToolSignal[];

  evaluation?: Evaluation;

  durationMs?: number;

  tokenUsage?: TokenUsage;

  cost?: number;
}
```

Critically, the default system should **not require raw prompt content** in centralized telemetry.

Local classification can generate metadata such as:

```json
{
  "task_class": "debugging",
  "tool_use": true,
  "context_size_bucket": "large",
  "code_related": true,
  "difficulty": 0.63
}
```

without sending source code to Sabi Live.

---

# 8. Sabi State

The decision engine receives a normalized state.

```ts
interface SabiState {
  request: RequestMetadata;

  trajectory?: TrajectorySummary;

  providers: ProviderState[];

  models: ModelState[];

  fleet?: FleetState;

  policy: RoutingPolicy;

  localHealth: LocalHealthState;

  budget?: BudgetState;
}
```

Example:

```json
{
  "request": {
    "task_class": "debugging",
    "context_tokens": 58000,
    "requires_tools": true
  },

  "trajectory": {
    "round": 17,
    "recent_failures": 2,
    "same_error_repeated": true,
    "previous_model_tier": "cheap"
  },

  "local_health": {
    "openrouter/model-x": "healthy",
    "nvidia/model-y": "throttled"
  },

  "policy": {
    "strategy": "free-first",
    "max_retries_before_escalation": 2
  }
}
```

---

# 9. Decision Contract

The router returns a deterministic structured decision.

```ts
interface SabiDecision {
  provider: string;
  model: string;

  effort?: "low" | "medium" | "high";

  reasonCodes: ReasonCode[];

  confidence?: number;

  fallback: Route[];

  ttl?: number;
}
```

Example:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet",
  "effort": "high",

  "reason_codes": [
    "REPEATED_FAILURE",
    "DEBUGGING_COMPLEXITY_HIGH",
    "CHEAP_TIER_EXHAUSTED"
  ],

  "fallback": [
    {
      "provider": "openai",
      "model": "codex"
    }
  ]
}
```

The reason codes matter.

Sabi must remain inspectable.

Users should be able to answer:

> Why did Sabi escalate this round?

without reading an opaque model explanation.

---

# 10. Decision Pipeline

Routing should happen in stages.

## Stage A — Hard filtering

Remove candidates that cannot satisfy the request.

Examples:

```text
model unavailable
provider unavailable
context too small
tools unsupported
modality unsupported
quota exhausted
explicit user exclusion
security policy conflict
local circuit breaker open
```

This stage should be deterministic wherever possible.

---

## Stage B — Capability fit

Remaining candidates are scored against the task.

Possible dimensions:

```text
coding capability
reasoning capability
tool reliability
context capability
latency
structured output
instruction following
task-specific historical performance
```

---

## Stage C — Economic preference

Policy adjusts the ranking.

Example policies:

```text
free-first
balanced
quality-first
latency-first
local-first
provider-preferred
custom
```

`free-first` should not mean:

> Always choose free.

It should mean:

> Prefer zero-cost capacity when expected task success remains above policy thresholds.

---

## Stage D — Trajectory adjustment

Control modifies the ranking based on previous events.

Examples:

```text
repeated failure
same model failed twice
tool calls malformed repeatedly
context pressure increased
task moved from exploration to architecture
previous route succeeded
latency budget nearly exhausted
budget nearly exhausted
verification stage reached
```

---

## Stage E — Route selection

The highest valid candidate is selected and a fallback chain generated.

---

# 11. Scoring Model

The implementation should allow the exact scoring system to evolve.

Conceptually:

```text
score =
    capability_fit
  + availability
  + reliability
  + task_history
  + latency_fit
  + context_fit
  + policy_preference

  - expected_cost
  - local_failure_penalty
  - fleet_failure_penalty
  - quota_risk
  - trajectory_failure_penalty
```

Hard constraints happen before scoring.

A model that does not satisfy a required capability should not win merely because it is free.

---

# 12. Escalation

Escalation is one of Sabi Control's core primitives.

Examples:

```text
cheap → mid
mid → strong
free → paid
fast → reasoning
low effort → high effort
```

Escalation triggers may include:

- repeated task failure;
- repeated identical tool failure;
- judge rejection;
- high estimated difficulty;
- conflicting evidence;
- unusually large context;
- architecture-sensitive task;
- previous model explicitly requesting escalation;
- recovery from a failed patch;
- failed verification.

Example:

```text
attempt 1
FREE
↓
failure

attempt 2
FREE DIFFERENT MODEL
↓
same failure

Control:
semantic failure repeated
↓
STRONG
```

Escalation policy must be configurable.

---

# 13. De-escalation

Control should also move downward.

This is equally important.

Example:

```text
strong model
solves architecture
      ↓
trajectory enters implementation phase
      ↓
mechanical changes remain
      ↓
cheap model
```

Without de-escalation, adaptive routing eventually becomes:

> escalate once and stay expensive forever.

That defeats the purpose.

---

# 14. Task Classification

Sabi should classify rounds into a small stable taxonomy.

Initial classes:

```text
search
retrieval
summarization
classification

simple_generation
mechanical_edit
test_generation

debugging
error_analysis

architecture
planning
complex_reasoning

verification
review

tool_recovery

unknown
```

Classification should ideally happen locally.

It may use:

1. deterministic signals;
2. lightweight local model;
3. Jev-style decision model;
4. routed classifier;
5. combinations of the above.

Classification must not become a latency bottleneck.

---

# 15. Sabi Live Telemetry

Live should collect **operational evidence**, not user content.

Default allowed telemetry:

```text
installation pseudonym

timestamp

provider
model

route tier

HTTP status family

provider error classification

latency bucket

token count bucket

success/failure

retry count

tool success/failure

task class

context bucket

decision reason codes

fallback triggered

quota state bucket

Sabi version

adapter/harness type
```

Default prohibited telemetry:

```text
prompts
source code
file contents
model outputs
API keys
environment variables
repository contents
user messages
secrets
```

If richer telemetry is ever introduced, it must require separate explicit consent.

---

# 16. Error Classification

Failures must not be treated equally.

A failure should be classified by:

```text
error_type
scope
confidence
```

Possible scopes:

```text
request
account
API key
model
provider
OpenRouter
network
local machine
Sabi
unknown
```

Examples:

```text
401
likely account/key scoped

404 model missing
possibly model/provider scoped

429
possibly account or provider quota

timeout
possibly network/provider/model

invalid tool output
model/request scoped
```

A single user's failure must not globally disable a provider.

---

# 17. Local Circuit Breaker

The fastest health response happens locally.

Example:

```text
Model A
↓
three consecutive 429s
↓
local breaker opens
↓
Sabi stops routing there temporarily
```

This should not require Sabi Live.

State:

```text
CLOSED
normal operation

OPEN
temporarily excluded

HALF_OPEN
probe allowed
```

TTL must depend on failure class.

---

# 18. Fleet Intelligence

Live aggregates independent observations.

Example:

```text
1 installation:
404

do nothing globally


5 installations:
same model
same provider
same error
within 30 seconds

increase fleet risk


30 installations:
same failure pattern

mark degraded
```

A model should not disappear simply because a particular installation cannot access it.

Fleet scoring therefore needs:

```text
number of independent installations
geographic/provider diversity where appropriate
time window
failure type
success evidence
sample size
historical baseline
```

---

# 19. Fleet Health Feed

Sabi Live exposes a compact feed.

Potential API:

```text
GET /feed/v1/health
```

Response conceptually:

```json
{
  "generated_at": "...",

  "models": {
    "provider/model": {
      "status": "healthy",
      "confidence": 0.94,
      "latency_p50_ms": 810,
      "latency_p95_ms": 1920,
      "failure_rate": 0.014
    }
  }
}
```

The feed should be aggressively cacheable.

The local router should continue operating with the previous feed if refresh fails.

---

# 20. Catalogue Feed

Separate availability from catalogue metadata.

```text
GET /feed/v1/catalogue
```

Contains:

```text
models
providers
pricing
free status
context
tool support
modalities
known quotas
capabilities
metadata freshness
```

This allows Sabi to answer:

> What could I route to?

while health answers:

> What appears usable right now?

---

# 21. Live Storage Architecture

Recommended separation:

```text
POSTGRES
accounts
subscriptions
installations
policies
catalogue configuration
provider metadata
entitlements


CLICKHOUSE
routing events
latency
failures
availability evidence
trajectory telemetry
aggregate success
fleet health
historical model behavior
```

Postgres stores authoritative product state.

ClickHouse stores high-volume evidence.

---

# 22. Sabi Control Event Model

Harness integrations should emit normalized events.

Initial event families:

```text
trajectory.started

round.started
round.completed
round.failed

tool.started
tool.completed
tool.failed

verification.passed
verification.failed

context.pressure

agent.escalation_requested

user.override

trajectory.completed
trajectory.aborted
```

Not every harness will expose every event.

The architecture must tolerate partial instrumentation.

---

# 23. Harness Adapters

Each harness gets a thin adapter.

```text
Claude Code adapter
Codex adapter
Hermes adapter
OpenCode adapter
future adapters
```

Adapter responsibilities:

```text
translate harness state → Sabi events

call Sabi route/decision interface

apply returned model/provider configuration

report result

never implement agent reasoning itself
```

The adapter should remain as thin as possible.

---

# 24. Integration Modes

Sabi should support multiple integration paths.

### Native hook / plugin

Preferred when the harness exposes sufficient lifecycle hooks.

Provides highest-quality trajectory signals.

### OpenAI-compatible proxy

Provides broad compatibility.

Useful when the harness allows custom endpoints but has weak plugin support.

### Local daemon

The Sabi daemon maintains shared local state across integrations.

```text
Claude ──┐
Codex ───┤
Hermes ──┼──► localhost Sabi daemon
OpenCode ┘
```

This avoids duplicating:

- catalogue state;
- local health;
- provider keys;
- circuit breakers;
- Live feed;
- trajectory state.

---

# 25. Local-First Requirement

Core routing must not depend on Sabi servers.

Sabi Live enriches decisions.

It does not authorize them.

If Live fails:

```text
local catalogue
+
local health
+
cached fleet feed
+
local policy
```

must remain sufficient for routing.

Required failure behavior:

```text
Sabi Live unreachable
        ↓
router continues
        ↓
cached data expires gradually
        ↓
local-only routing
```

Never:

```text
Sabi Live unreachable
        ↓
coding agent stops working
```

---

# 26. Fail-Open Principle

Sabi should generally fail open toward the user's configured primary model.

Example:

```text
Sabi decision engine crashes
        ↓
adapter detects failure
        ↓
configured primary route
        ↓
agent continues
```

Sabi must not become a new single point of failure.

---

# 27. User Policy

Users need a simple policy layer.

Example:

```yaml
strategy: free-first

providers:
  allow:
    - openrouter
    - gemini
    - mistral
    - nvidia
    - anthropic

strong_model:
  provider: anthropic
  model: claude-sonnet

limits:
  free_attempts: 2
  max_latency_ms: 30000

privacy:
  fleet_telemetry: true
```

Advanced users may configure deeper rules, but the default experience should not require hand-authoring routing tables.

---

# 28. Automatic Provider Discovery

Sabi should gradually eliminate manual model lists.

Given configured provider credentials, Sabi should determine:

```text
what models exist
what models user can access
which are free
which are paid
current limits where observable
tool capability
context limits
availability
```

The ideal workflow becomes:

```text
add provider key
      ↓
Sabi discovers capacity
      ↓
Sabi incorporates it automatically
```

The user should not need to instruct the agent:

> Use NVIDIA for this request.

That defeats adaptive routing.

---

# 29. Quota Awareness

Free routing only works well if quota is modeled.

Possible quota states:

```text
unknown
healthy
approaching_limit
limited
exhausted
cooldown
```

Local provider observations have highest priority for account-specific quotas.

Fleet information must never override known local account state.

---

# 30. Control Without Becoming a Harness

This is a non-negotiable architecture rule.

Sabi Control may know:

```text
tests failed
```

It does not run the tests.

Sabi may know:

```text
tool call failed twice
```

It does not own the tool.

Sabi may conclude:

```text
escalate model
```

The harness still executes the next round.

Therefore:

```text
HARNESS
owns actions

SABI
owns intelligence decisions
```

This keeps Control portable across agents.

---

# 31. Evaluation

Sabi needs to distinguish:

```text
request completed
```

from:

```text
request succeeded
```

Signals may include:

```text
harness result

tool status

test status

structured evaluator

Jev decision

explicit user correction

retry requirement

later trajectory outcome
```

Evaluation should prefer objective evidence over model self-assessment.

Priority:

```text
deterministic result
       >
external verifier
       >
structured judge
       >
model self-report
```

---

# 32. Jev / Fast Decision Engine

A low-latency decision engine is appropriate for questions such as:

```text
Did this attempt meaningfully fail?

Does this trajectory need escalation?

Is this round likely simple or difficult?

Should this route be retried?

Is the evidence sufficient to change tier?
```

These decisions often do not need a generative frontier LLM.

The Control architecture should allow:

```text
rules
+
statistics
+
Jev
+
small classifiers
+
LLMs
```

to coexist.

No single classifier should be hard-coded as the permanent architecture.

---

# 33. Learning From Outcomes

The long-term advantage of Control comes from outcome data.

> **Editorial note added 2026-09-27** (flagged by automated PR review): the
> percentages below are illustrative — they show the *shape* of the pattern
> Sabi's learning loop should be able to detect, not measured results from any
> dataset, run, or commit. No such data exists yet. Do not cite these numbers
> as evidence anywhere else in this repo.

Example observation (hypothetical, not measured):

```text
task_class = debugging
model = X
first attempt success = 42%

after two cheap failures:
model = Claude
success = 89%
```

Sabi can learn that escalation should happen earlier.

Another (also hypothetical):

```text
task_class = search
strong model success = 98%
free model success = 97%

cost difference = enormous
```

Free should become strongly preferred.

Over time routing moves from:

```text
model reputation
```

toward:

```text
observed performance
for this type of work
under these conditions
```

---

# 34. No Global Learning From Raw Code Required

This is strategically important.

Sabi should be able to improve from:

```text
task class
route
environment
failure
latency
retry
eventual outcome
```

without receiving:

```text
source code
prompt
model output
repository
```

For example:

```text
debugging
+ large context
+ tools
+ model A
+ two retries
+ failure

followed by

model B
+ success
```

already provides valuable routing evidence.

---

# 35. Privacy

Default privacy promise:

> Sabi does not need your prompts, code, or model outputs to provide fleet intelligence.

Required principles:

1. Provider API keys remain local.
2. Raw prompts are not uploaded by default.
3. Raw outputs are not uploaded by default.
4. Source code is not uploaded.
5. Repository contents are not uploaded.
6. Telemetry identifiers are pseudonymous.
7. Users can disable telemetry.
8. Routing continues when telemetry is disabled.
9. Every telemetry field should have a documented reason for existence.

---

# 36. Telemetry Poisoning Protection

Fleet intelligence creates an attack surface.

An installation must not be able to send:

```text
"Claude is down"
```

and globally alter routing.

Mitigations:

```text
independent-install threshold
rate limits
per-install weighting
outlier rejection
historical reputation
provider corroboration
success evidence
TTL
minimum sample sizes
```

Fleet status must be probabilistic rather than absolute.

---

# 37. Freshness

Not all state ages equally.

Example TTL classes:

```text
local 429
minutes

provider outage
seconds/minutes

pricing
hours/day

catalogue capability
days

model benchmark evidence
weeks

account quota
request/session dependent
```

Sabi should not use one global cache TTL.

---

# 38. User Experience

The basic experience should be extremely small.

Installation:

```text
sabi install
```

Connect providers:

```text
sabi provider add openrouter
sabi provider add gemini
sabi provider add nvidia
```

Inspect:

```text
sabi status
```

Possible output:

```text
Sabi

Providers       5 connected
Models          431 discovered
Free usable     21
Degraded        3

Strategy        free-first
Strong fallback Claude Sonnet

Live            connected
Control         active
```

Users should not need to manually build a route graph.

---

# 39. Explainability

A routing log should be understandable.

Example:

```text
Round 14

Task:
debugging

Previous:
2 failed attempts

Route:
Claude Sonnet / high effort

Why:
+ repeated semantic failure
+ architecture-sensitive task
+ cheap retry threshold reached

Skipped:
NVIDIA Model X
reason: local circuit breaker

OpenRouter Model Y
reason: fleet degraded
```

This is vastly more useful than opaque scoring numbers.

---

# 40. User Override

Sabi must remain subordinate to explicit user intent.

Examples:

```text
always use Claude for this session

never use provider X

only use free models

maximum $2

disable Live

disable Control

pin this model

don't escalate automatically
```

Explicit user rules override adaptive policy unless technically impossible.

---

# 41. Product Metrics

Sabi should not optimize only for cost.

Primary product metrics:

```text
task success rate
cost per successful trajectory
premium-token reduction
free inference utilized
retries per successful task
time to successful completion
escalation rate
unnecessary escalation rate
routing-induced failure rate
fallback recovery rate
```

A useful north-star metric:

> **Successful work per paid token.**

Secondary metric:

> **Successful work per unit of wall-clock time.**

---

# 42. Router Success Criteria

Sabi Router is successful when:

- multiple providers can be configured;
- model catalogue is normalized;
- routing can happen without Sabi Live;
- local circuit breaking works;
- free-first policy uses free capacity without obvious quality collapse;
- provider failure triggers valid fallback;
- users can override decisions;
- routing adds negligible latency relative to inference.

---

# 43. Live Success Criteria

Sabi Live is successful when:

- routers can submit pseudonymous operational events;
- telemetry contains no prompt/code/output by default;
- provider/model failures are aggregated across installations;
- a single installation cannot globally disable a route;
- fleet health has confidence and freshness;
- catalogue metadata can update independently;
- local routers consume health/catalogue feeds;
- cached feeds work during Live outages;
- Live measurably prevents attempts against degraded capacity.

---

# 44. Control Success Criteria

Sabi Control is successful when the route chosen for the next round can change based on previous trajectory evidence.

Minimum demonstration:

```text
Round 1
cheap

Round 2
cheap

Round 3
cheap failure

Round 4
cheap failure

Round 5
automatic strong escalation

Round 6
automatic cheap de-escalation
```

without the user manually selecting models.

Additional criteria:

- trajectory identity persists across rounds;
- failure history influences routing;
- tool-result signals can influence routing;
- context pressure influences routing;
- users can inspect why escalation happened;
- Control works through at least two independent harness adapters;
- disabling Control returns behavior to normal Router mode.

---

# 45. Non-Goals for Control v1

Control v1 will not:

- independently plan coding tasks;
- run shell commands;
- edit files;
- manage Git branches;
- spawn arbitrary processes;
- deploy applications;
- approve production deployments;
- replace coding agents;
- autonomously modify repositories;
- create its own CI system;
- require a Sabi-specific coding environment.

These capabilities belong to harnesses.

---

# 46. Rollout Phases

## Phase 1 — Router Foundation

Deliver:

```text
provider normalization
model catalogue
capability metadata
free/paid detection
routing policy
fallback chains
local health
circuit breaker
routing logs
```

Primary question:

> Can Sabi reliably select usable inference?

---

## Phase 2 — Sabi Live

Deliver:

```text
telemetry SDK
event ingestion
ClickHouse events
health aggregation
catalogue service
/feed/v1/health
/feed/v1/catalogue
privacy controls
fleet confidence
```

Primary question:

> Can the fleet make each local router better informed?

---

## Phase 3 — Trajectory Instrumentation

Before sophisticated Control, capture:

```text
trajectory_id
round_id
harness
route
result
tool result
retry
error classification
task class
```

Do not change routing yet.

Run Control in shadow mode.

For each round:

```text
actual route
vs
route Control would have chosen
```

This creates evaluation data without affecting users.

---

## Phase 4 — Control Advisory

Control generates recommendations.

Example:

```text
recommended:
escalate strong

actual:
cheap
```

Adapters expose recommendations but do not automatically apply every one.

Measure:

```text
counterfactual quality
cost
latency
failure
```

---

## Phase 5 — Controlled Automation

Enable automatic:

```text
free → cheap
cheap → mid
mid → strong
retry alternate provider
de-escalate after resolution
```

under conservative thresholds.

Users can disable automatic escalation.

---

## Phase 6 — Learned Routing

Replace increasing portions of static policy with evidence-driven models.

Inputs:

```text
task
trajectory
local health
fleet health
model capability
historical outcomes
```

Outputs:

```text
expected success
expected cost
expected latency
route
```

Static rules remain as constraints.

---

# 47. Architecture

Final target:

```text
┌────────────────────────────────────────────────────┐
│                    HARNESS                         │
│                                                    │
│ Claude Code / Codex / Hermes / OpenCode / etc.    │
│                                                    │
│ tools • context • files • shell • agent loop       │
└───────────────────────┬────────────────────────────┘
                        │
                 normalized events
                        │
                        ▼
┌────────────────────────────────────────────────────┐
│                 SABI CONTROL                       │
│                                                    │
│ trajectory                                         │
│ task classification                                │
│ escalation                                         │
│ de-escalation                                      │
│ route policy                                       │
│ decision evaluation                                │
└───────────────────────┬────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────┐
│                  SABI ROUTER                       │
│                                                    │
│ candidate filtering                                │
│ provider selection                                 │
│ model selection                                    │
│ effort                                             │
│ fallback                                           │
│ local circuit breaker                              │
└───────────────┬────────────────┬───────────────────┘
                │                │
                ▼                ▼
       Local evidence       SABI LIVE
                           fleet health
                           catalogue
                           aggregated outcomes
                │                │
                └───────┬────────┘
                        ▼
                  FINAL ROUTE
                        │
                        ▼
           provider / model / effort
```

---

# 48. Key Architectural Invariant

Sabi Live can influence routing.

Sabi Control can influence routing.

Neither may be required for basic routing.

Therefore:

```text
Router
= independent

Router + Live
= better informed

Router + Live + Control
= trajectory aware
```

This modular degradation is important.

---

# 49. Product Evolution

The product narrative becomes:

```text
SABI ROUTER

Don't use your best model
for every request.


        ↓


SABI LIVE

Don't route based on a catalogue.
Route based on what is actually
working right now.


        ↓


SABI CONTROL

Don't choose intelligence once
for an entire coding task.

Choose the right intelligence
for every stage of the trajectory.
```

---

# 50. Long-Term Boundary

A future system may support persistent objectives such as:

```text
reduce repository complexity

fix flaky tests

keep dependencies current

reduce latency

investigate production failures
```

But those loops should execute **inside an existing harness**.

Sabi would provide:

```text
routing
availability
economics
trajectory intelligence
evaluation
escalation
```

while the harness continues providing:

```text
agency
tools
environment
execution
```

This preserves Sabi's strategic position regardless of which coding harness becomes dominant.

---

# 51. Core Product Thesis

Sabi should not compete to become the best coding agent.

That market already contains extremely capable systems.

Sabi should make all of them more economically and operationally efficient.

The durable abstraction is not:

> **Sabi routes LLM requests.**

It is:

> **Sabi allocates intelligence dynamically across an agent trajectory.**

And the product progression is therefore:

```text
SABI NOW
Where should this request go?


SABI LIVE
What intelligence is actually
available right now?


SABI CONTROL
Given everything that has happened,
what intelligence should handle
the next step?
```

That is one coherent product rather than three separate products.

---

# 52. The One Rule That Prevents Product Drift

Before adding a feature, ask:

> **Does this feature help Sabi decide what intelligence should be used, or does it help the agent perform the work?**

If it improves the decision:

**Sabi territory.**

If it performs the work:

**Harness territory.**

That rule should remain the architectural boundary for Sabi.
