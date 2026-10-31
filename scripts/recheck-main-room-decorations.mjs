import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(root, `docs/kimi/verification/main-scene-recheck-${stamp}`);
const base = process.env.MAIN_SCENE_URL || 'http://127.0.0.1:5174/leadership-always-right/';
const headed = process.env.HEADED === '1';
await mkdir(out, { recursive: true });
const report = {
  started: new Date().toISOString(),
  scope: '主场景只读诊断、正式碰撞快照的滚椅通行模拟、真实Chrome短操作；不含传送/状态写入，不是十分钟整局验收',
  url: `${base}?preview=scene`,
  headed,
  checks: [], errors: [], console: [], responses: [],
};
let browser;
const save = async () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const snapshot = page => page.evaluate(() => window.__OFFICE__.getSnapshot());
const waitPage = (page, name) => page.waitForFunction(name => window.__OFFICE__.getSnapshot().page === name, name, { timeout: name === 'ready' ? 120000 : 30000 });
async function record(name, run) {
  try {
    const evidence = await run();
    report.checks.push({ name, status: 'pass', evidence });
    console.log(`PASS ${name}`);
    return evidence;
  } catch (error) {
    report.checks.push({ name, status: 'fail', error: error.stack });
    console.log(`FAIL ${name}: ${error.message}`);
    return null;
  } finally { await save(); }
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) report.responses.push({ status: response.status(), url: response.url() }); });
  await page.goto(`${base}?preview=scene`);
  await waitPage(page, 'ready');
  const ready = await snapshot(page);
  await writeFile(path.join(out, 'ready-snapshot.json'), JSON.stringify(ready, null, 2));
  await record('default 618 main scene room decoration diagnostics', async () => {
    assert.equal(ready.world.seed, 618);
    assert.equal(ready.world.rooms.length, 10);
    const diagnostics = ready.visuals.roomDecorations;
    assert.ok(diagnostics);
    assert.deepEqual(diagnostics.missingModels, []);
    assert.deepEqual(diagnostics.violations, []);
    assert.deepEqual(diagnostics.rooms.map(room => room.roomId).sort((a, b) => a - b), ready.world.rooms.map(room => room.id).sort((a, b) => a - b));
    assert.ok(ready.world.decorationColliders.length >= diagnostics.colliders.length);
    assert.ok(diagnostics.colliders.length > 0);
    return {
      seed: ready.world.seed,
      rooms: diagnostics.rooms,
      skipped: diagnostics.skipped,
      missingModels: diagnostics.missingModels,
      violations: diagnostics.violations,
      decorationColliders: diagnostics.colliders.length,
      totalMeasuredColliders: ready.world.decorationColliders.length,
      wallAttachments: diagnostics.wallAttachments.length,
      worldValidation: ready.world.validation,
    };
  });

  const routes = await record('ten rooms rolling-chair paths through measured decoration colliders', async () => page.evaluate(async () => {
    const { makeWorldQuery, switchOperatingPoint } = await import('/leadership-always-right/src/world/query.ts');
    const snap = window.__OFFICE__.getSnapshot();
    const query = makeWorldQuery(snap.world);
    const variants = {
      base: {},
      raisedDesks: { deskHeights: Object.fromEntries(snap.world.desks.map(desk => [desk.id, 1.9])) },
      lowPressure: {
        pressureRooms: snap.world.rooms.filter(room => room.pressure).map(room => room.id),
        pressureHeights: Object.fromEntries(snap.world.rooms.filter(room => room.pressure).map(room => [room.id, 1.6])),
      },
      transparentPartitions: { transparentWalls: snap.world.walls.filter(wall => wall.partition).map(wall => wall.id) },
    };
    variants.combined = { ...variants.raisedDesks, ...variants.lowPressure, ...variants.transparentPartitions };
    const results = [];
    for (const [variant, patch] of Object.entries(variants)) {
      const state = { ...snap.state, ...patch };
      for (const room of snap.world.rooms) {
        const target = switchOperatingPoint(room);
        const path = query.path(snap.world.spawn, target, state);
        let current = { ...snap.world.spawn }, traveled = 0, stuck = false;
        for (const waypoint of path) {
          let steps = 0;
          while (Math.hypot(waypoint.x - current.x, waypoint.z - current.z) > .06 && steps++ < 1000) {
            const dx = waypoint.x - current.x, dz = waypoint.z - current.z, length = Math.hypot(dx, dz);
            const next = query.move(current, { x: dx / length * Math.min(.1, length), z: dz / length * Math.min(.1, length) }, .3, 1.42, state, 0);
            const moved = Math.hypot(next.x - current.x, next.z - current.z);
            if (moved < .00001) { stuck = true; break; }
            traveled += moved; current = next;
          }
          if (stuck) break;
        }
        const distance = Math.hypot(target.x - current.x, target.z - current.z);
        const finalRoom = query.roomAt(current);
        results.push({
          variant, roomId: room.id, name: room.name, kind: room.kind,
          pathPoints: path.length, traveled, distanceToTarget: distance,
          finalRoomId: finalRoom?.id ?? null,
          pass: path.length > 0 && !stuck && distance <= .12 && finalRoom?.id === room.id,
          stuck,
        });
      }
    }
    return results;
  }));
  if (routes) {
    report.routeFailures = routes.filter(item => !item.pass);
    if (report.routeFailures.length) process.exitCode = 1;
  } else process.exitCode = 1;

  await page.locator('.office-loader__enter').click();
  await waitPage(page, 'playing');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__OFFICE__.getSnapshot().state.player.pose === 'standing');
  await page.screenshot({ path: path.join(out, 'main-playing-start.png') });
  await page.evaluate(() => window.__OFFICE__.resetPerformance());
  const naturalRules = new Set();
  const actions = [
    ['KeyW', 1400], ['KeyD', 650], ['KeyS', 500], ['KeyA', 500],
    ['KeyW', 1000], ['KeyA', 700], ['KeyS', 600], ['KeyD', 500],
  ];
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const [key, duration] of actions) {
      await page.keyboard.down(key);
      await page.waitForTimeout(duration);
      await page.keyboard.up(key);
    }
    const current = await snapshot(page);
    for (const rule of current.state.rules) naturalRules.add(rule.kind);
  }
  for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space']) await page.keyboard.up(key).catch(() => {});
  const finalSnapshot = await snapshot(page);
  const performance = await page.evaluate(() => window.__OFFICE__.getPerformance());
  report.performance = performance;
  report.naturalRuleKinds = [...naturalRules];
  report.finalState = {
    page: finalSnapshot.page,
    elapsed: finalSnapshot.state.elapsed,
    remaining: finalSnapshot.state.remaining,
    ending: finalSnapshot.state.ending,
    player: finalSnapshot.state.player,
    bossMode: finalSnapshot.state.boss.mode,
    rules: finalSnapshot.state.rules,
    roomDecorationViolations: finalSnapshot.visuals.roomDecorations?.violations,
    roomDecorationSkipped: finalSnapshot.visuals.roomDecorations?.skipped,
  };
  await writeFile(path.join(out, 'final-snapshot.json'), JSON.stringify(finalSnapshot, null, 2));
  await page.screenshot({ path: path.join(out, 'main-playing-end.png') });
  await record('main scene short play completed without page errors', async () => {
    assert.equal(report.errors.length, 0);
    assert.equal(report.responses.length, 0);
    assert.ok(performance.frames > 0);
    assert.ok(finalSnapshot.visuals.roomDecorations);
    assert.deepEqual(finalSnapshot.visuals.roomDecorations.violations, []);
    return { page: finalSnapshot.page, elapsed: finalSnapshot.state.elapsed, performance, naturalRuleKinds: [...naturalRules] };
  });
  report.completed = new Date().toISOString();
  report.evidenceDirectory = out;
  await save();
  console.log(JSON.stringify({ evidence: out, headed, performance, routeFailures: report.routeFailures?.length ?? 0, errors: report.errors, responses: report.responses }, null, 2));
} catch (error) {
  report.fatalError = error.stack;
  process.exitCode = 1;
  await save();
  console.error(error);
} finally {
  if (browser) await browser.close();
}
