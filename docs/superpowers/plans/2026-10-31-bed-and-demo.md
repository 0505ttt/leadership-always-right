# Bed and Three-minute Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real playable 180-second demo and a bounded, physically safe falling-bed rule without changing normal rounds or shipped assets.

**Architecture:** `createGame(world, roundSeconds)` owns the single authoritative countdown; `src/main.ts` only selects demo configuration from `?demo=1`. A new `src/rules/bed.ts` validates final-volume placement and animates rule-owned bed state, while shared prop dimensions keep collision, camera, safety and procedural rendering consistent.

**Tech Stack:** TypeScript, Three.js, Vitest, Playwright, Vite, existing GameState/WorldQuery contracts.

---

### Task 1: One countdown, two entry configurations

**Files:**
- Modify: `src/rules/game.ts`, `src/contracts/game.ts`, `src/main.ts`, `src/entry-integration.css`
- Test: `tests/demo-mode.test.ts`

- [ ] Write tests proving `createGame(world, 180)` expires at exactly 180 seconds and `createGame(world)` still expires at 600 seconds. Step real game updates; do not assign `ending` or `remaining` directly.
- [ ] Run `npx vitest run tests/demo-mode.test.ts --exclude '.local/**' --maxWorkers=1`; expect failure because the optional duration does not exist.
- [ ] Add optional `GameState.roundSeconds`, default 600, and use it for `remaining`, elapsed clamp and overtime. Keep all other rules unchanged.
- [ ] In `src/main.ts`, select `42` and `180` only when `demo=1`; preserve unified loading, seed reuse, ordinary restart and `new-seed` behavior. Add a visible note that this is a real three-minute playable demo.
- [ ] Re-run the focused test and `npm run typecheck`; commit only after both pass.

### Task 2: Final-volume bed placement and lifecycle

**Files:**
- Create: `src/rules/bed.ts`
- Modify: `src/contracts/game.ts`, `src/rules/prop-safety.ts`, `src/rules/environment.ts`, `src/world/query.ts`, `src/world/generate.ts`, `src/gameplay/camera.ts`, `src/rules/objects.ts`, `src/rules/player.ts`, `src/presentation/props.ts`, `src/presentation/room-decorations.ts`, `src/audio/types.ts`, `src/audio/engine.ts`, `src/audio/observer.ts`
- Test: `tests/bed-rule.test.ts`, `tests/bed-placement.test.ts`

- [ ] Write failing tests for dormant bed geometry, a three-second warning, a 0.8-second landing, real collision, withdrawal, relocation away from actors, and cancellation when `validPlacement` rejects every point.
- [ ] Run the tests and confirm the current contracts fail rather than passing vacuously.
- [ ] Add `Prop.kind='bed'` and optional `PropState.dormant`. Dormant beds do not collide or render, cannot be picked up and do not add runtime asset IDs.
- [ ] Use final dimensions 2.05 × 1.25 × 0.58 m in one shared physical-spec helper. Include beds in physical support, camera and collision only after landing; preserve the cake’s rule-level sight mask.
- [ ] Extend `safePropPlacement` to bed rectangles. Use it before landing and when actors move into the landing zone. Try a bounded set of same-room points; cancel with a clear message when no legal point exists.
- [ ] Add the “公司就是你家，还回什么家。” rule to existing spatial selection with the same two-rule budget and no pressure-room overlap. Animate descent and withdrawal in `src/rules/bed.ts`; never sleep, heal or teleport a player.
- [ ] Render bed geometry procedurally in `props.ts`; keep all 16 runtime asset IDs and all dynamic collision/query paths aligned.
- [ ] Run focused tests and the existing prop-safety, navigation, inspection and scene-lifecycle tests; commit after green.

### Task 3: Regression, public demo and honest performance status

**Files:**
- Create: `.local/verify-bed-demo.mjs` (local evidence only)
- Test: full project suite and production build
- Evidence: `output/playwright/bed-demo-*`

- [ ] Run `npm test -- --exclude '.local/**' && npm run build`; expect zero failures.
- [ ] Exercise `?demo=1` in real Chrome: initial 03:00, seed 42, 16 model classes, ordinary input, pause and restart. Advance real gameplay to the overtime boundary without a fake UI timer.
- [ ] Exercise a naturally selected bed rule with final-volume diagnostics, actor avoidance and route checks; save a real screenshot and JSON, not a fabricated scene.
- [ ] Re-run the frozen native GPU fixture without lowering any criterion. Report performance separately from feature acceptance.
- [ ] Commit the verified source, deploy only the reviewed candidate, and verify public version and demo URL before calling it online.
