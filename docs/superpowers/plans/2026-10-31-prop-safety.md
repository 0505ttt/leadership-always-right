# Prop Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure cakes—and any future bed using the same adapter—cannot displace actors, obstruct workstation operation, or sever mandatory return/clock/exit routes at any point in creation, growth, pushing, throwing, or landing.

**Architecture:** Add one rules-level placement adapter around the existing `WorldQuery`. It will use the same square AABB dimensions as rendering/collision, exact actor/zone clearance, temporary state evaluation for route certification, and bounded caching so pathfinding is not repeated every animation frame. Existing environment, player, and object modules will call this adapter; no parallel physics state is introduced.

**Tech Stack:** TypeScript, Vitest, existing Three.js game rules and `WorldQuery` A* navigation.

## Global Constraints

- Cake collision/render dimensions remain `0.6 × scale` square and `0.4 × scale` height.
- Protect every desk's `seat`, real `workPoint`, computer/office interaction space, raised-chair mounting/dismounting space, the player's route home, the single clock, and a route from that clock to at least one exit.
- Use actual `world.decorationColliders` after scene assembly, not only base geometry.
- If no legal point exists, leave the object at its last legal position or keep it held; an announced unsafe expansion cancels/restores without creating a violation.
- Do not implement the bed or three-minute demo in this plan.
- Do not run full-map pathfinding unconditionally on every frame.

---

### Task 1: Shared final-volume and route certification

**Files:**
- Create: `src/rules/prop-safety.ts`
- Test: `tests/prop-safety.test.ts`

**Interfaces:**
- Produces: `safePropPlacement(state, world, query, prop, point?, scale?, checkRoutes?): boolean`.
- Consumes: existing `GameState`, `WorldDef`, `WorldQuery`, `PropState`, and `deskWorkingPoint(desk)`.

- [ ] **Step 1: Write failing behavior tests**

Cover an actor at a final-scale square corner, every desk's approach/chair space, a measured decoration collider, a cake sealing the only home/clock corridor, a legal side placement, and repeated identical evaluations with an instrumented `query.path`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/prop-safety.test.ts`
Expected: FAIL because `src/rules/prop-safety.ts` does not exist.

- [ ] **Step 3: Implement the shared adapter**

Use a circumscribed radius `Math.SQRT2 * halfSize` only for the existing broad `validPlacement` query; use exact square-vs-circle checks for actors and protected zones. During route tests, temporarily place the candidate at its requested final scale with `held=false`, then restore all mutable fields in `finally`.

The route certificate must verify:
```text
player → home.seat
home.seat → home.workPoint (short collision replay)
home.seat → the sole station
station → at least one exit
```
Replay route segments with radius `0.3` and height `1.42` so required routes remain rolling-chair accessible. Cache by candidate/final volume, other-prop geometry, measured decorations, opened exits, player position bucket and current game time; identical frame evaluations must not repeat A*.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/prop-safety.test.ts`
Expected: all shared-adapter tests PASS and repeated evaluations add zero path searches.

### Task 2: Creation and expansion integration

**Files:**
- Modify: `src/rules/environment.ts`
- Test: `tests/prop-safety-integration.test.ts`

**Interfaces:**
- Consumes: `safePropPlacement(...)` at scale `3` before warning/activation and at the desired scale plus final-route certification during growth.

- [ ] **Step 1: Write failing integration tests**

Announce a cake, place the player at a final-square corner before growth, and assert that the rule restores/cancels before overlap. Assert that a cake whose final volume would sever the return route never becomes active and creates no inspection-based punishment.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/prop-safety-integration.test.ts`
Expected: the corner case or route case grows under the legacy `safeCake` behavior.

- [ ] **Step 3: Replace `safeCake`**

Before selection/activation, evaluate the final scale `3`. During each growth frame, perform the cheap desired-volume checks and use the bounded final-route certificate. On failure retain the last legal scale and enter the existing safe restoration path.

- [ ] **Step 4: Verify GREEN and existing rules**

Run: `npm test -- tests/prop-safety.test.ts tests/prop-safety-integration.test.ts tests/rules-game.test.ts tests/complex-rules.test.ts`
Expected: PASS without weakening old route or collision assertions.

### Task 3: Push, drop, throw, and landing integration

**Files:**
- Modify: `src/rules/player.ts`
- Modify: `src/rules/objects.ts`
- Test: `tests/prop-safety-integration.test.ts`

**Interfaces:**
- Consumes: the same `safePropPlacement(...)`; no separate push/drop safety radius list remains authoritative.

- [ ] **Step 1: Write failing integration tests**

Attempt to push a scale-3 cake into a workstation zone and across a mandatory corridor; assert its coordinates do not change. Attempt to drop/land a cake in an unsafe final position; assert it stays held or remains airborne until a bounded nearby legal fallback is found.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/prop-safety-integration.test.ts`
Expected: at least one legacy push/drop path accepts the unsafe destination.

- [ ] **Step 3: Route all destinations through the adapter**

Use actual candidate scale and AABB for push, reserved throw destination, direct drop, and post-flight actor re-entry. Nearby fallback candidates must pass the same checks and line-of-sight/movement tests; failure preserves the prior held/airborne state.

- [ ] **Step 4: Verify GREEN and full regression**

Run: `npm test`
Expected: all existing and new tests PASS.

### Task 4: Browser and build evidence

**Files:**
- Create: `docs/kimi/verification/prop-safety-<timestamp>/report.json`
- Modify: `docs/kimi/Kimi主集成文件边界与实施顺序-20261031.md` only if evidence references are added.

- [ ] **Step 1: Run static checks**

Run: `npm run typecheck && npm run build`
Expected: PASS; retain any pre-existing chunk warning without calling it a failure.

- [ ] **Step 2: Run real-browser scenarios on the existing 5174 service**

Use normal 10-room/21-desk/7-colleague seeds with measured decorations. Exercise generation, expansion, push, drop and a combined raised-desk/low-ceiling/sticky-chair state. Save version, seed, before/after state, screenshots and any failure; do not inject a success result.

- [ ] **Step 3: Classify evidence**

Mark unit/integration/build/browser items separately. Do not mark public deployment or full-match acceptance complete from these tests alone.
