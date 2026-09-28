# Tasks: Harness-Native Model Selection

**Input**: `specs/017-harness-native-model-selection/spec.md`
**Prerequisites**: 016 (decision interface) for the recommendation shape.
Independent of the borrowed-credential work shipped in `c159208`.

## Phase 1: Probe before building

Everything downstream depends on the answer. Do not skip to Phase 2.

- [ ] **T001** Probe OMP's extension surface: does
  `registerMessageCacheInvalidator` fire at a turn boundary, and is
  `runtime.setModel` safe to call mid-session? Record the result in
  `docs/decisions.md` with the observed behaviour, not an inference.
- [ ] **T002** Probe whether an OMP extension can READ the model catalog
  (`getModels` / `listModels` / `availableModels` reachable from the extension
  object, or only from internals). This decides whether acceptance criterion 3
  is achievable or degrades to the configured list.
- [ ] **T003** From T001, fix the OMP adapter's `selectionScope`. Per-turn only
  if the probe showed a turn boundary; otherwise `session`, stated plainly
  rather than left implied.

## Phase 2: The capability contract

- [ ] **T004** `HarnessSelection` in `packages/core/src/types.ts`: `harness`,
  `canApplyRecommendation`, `selectionScope`, `reportsCatalog`. Closed shape,
  no metadata bag — the same rule 016 applies to its decision type.
- [ ] **T005** Default-deny: an adapter that does not export the field resolves
  to `canApplyRecommendation: false`. A missing declaration is not consent.
- [ ] **T006** Every existing adapter (`opencode`, `oh-my-pi`, `command-code`,
  `hermes`, `orca`, `prime-agent`, `deepseek-harness`) declares its field, each
  from what that harness actually exposes. `opencode` declares
  `canApplyRecommendation: true, selectionScope: 'turn'`; the rest start `false`
  until probed.
- [ ] **T007** `candidateUniverse` takes the session's `HarnessSelection` and
  excludes `executor: 'host'` pools when the host cannot apply them, with the
  reason carried onto the exclusion.
- [ ] **T008** A round whose candidate universe excluded a host-native pool
  records the exclusion in its receipt. Silent exclusion is how a router
  becomes unexplainable.
- [ ] **T009** Tests: a default-deny adapter excludes host-native pools; a
  capable adapter includes them; a request never fails with
  `route to host: Sabi cannot dial it`.

## Phase 3: The host side, per harness

- [ ] **T010** OpenCode: extend the `chat.message` hook's action set with a
  host-native selection, applied through the same `output.parts` mechanism the
  delegation path already uses. Reuse that path rather than inventing a second
  one.
- [ ] **T011** OMP: adapter calls `runtime.setModel(concreteId)` at the
  granularity T003 fixed. Sabi leaves the request path entirely for
  host-served rounds.
- [ ] **T012** Receipt: a host-served round records pool, executor, and the
  granularity the host actually applied. Never finer than the declared scope.
- [ ] **T013** Receipt: a host-native route that fails (404/401 from the host)
  carries that evidence onto the pool so the next round can deprioritise it.
  A host-native pool is only as current as the last report.
- [ ] **T014** Test per harness: the OpenCode plugin applies a host-native
  selection; the OMP adapter sets the model and the session serves it. Both
  assert the receipt, not just the HTTP response.

## Dependencies

Phase 1 blocks all of Phase 3. Phase 2 blocks Phase 3. T010 and T011 are
independent of each other and can run in parallel once Phase 2 lands.

## Explicitly not in this spec

- Credential sharing. `borrowedCredentials` is shipped and separate.
- Changing `ensureRouteCompatible`'s refusal of a route Sabi cannot dial. That
  refusal stays: Sabi answering from a route it did not reach is a lie about
  what served.
- A cross-vendor capability negotiation standard.
