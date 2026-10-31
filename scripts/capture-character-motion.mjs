import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/kimi/verification/motion');
const port = 5193;
const base = `http://127.0.0.1:${port}/leadership-always-right/character-motion-preview.html`;
const capturesByPose = {
  'seated-low': ['side'],
  'chair-mount': ['side'],
  'chair-work': ['front', 'side', 'back', 'perspective'],
  'chair-pot': ['side', 'perspective'],
  'chair-dismount': ['side'],
  'chair-recover': ['side', 'perspective'],
  'leader-patrol': ['perspective'],
  'leader-inspect': ['side', 'perspective'],
  'leader-search-left': ['front', 'perspective'],
  'leader-search-right': ['front', 'perspective'],
};
const sourceFiles = [
  'src/presentation/character-motion.ts',
  'src/presentation/character-rig.ts',
  'src/presentation/character-motion-preview.ts',
  'src/presentation/character-motion-preview.css',
  'character-motion-preview.html',
  'tests/character-motion.test.ts',
  'scripts/capture-character-motion.mjs',
  'public/assets/tripo/employee-base-v1.glb',
  'public/assets/tripo/leader-v1.glb',
  'public/assets/tripo/chair-v1.glb',
  'public/assets/tripo/pot-v1.glb',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha256(await readFile(path.join(root, file)))])));
await mkdir(output, { recursive: true });

const portIsOpen = () => new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const finish = value => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(value);
  };
  socket.setTimeout(500);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});
if (await portIsOpen()) throw new Error(`Port ${port} is already in use; refusing to touch another server.`);

const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', data => { serverLog += data; });
server.stderr.on('data', data => { serverLog += data; });
const serverExit = new Promise(resolve => server.once('exit', resolve));
const stop = async () => {
  if (server.exitCode === null && server.signalCode === null) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* The owned server already exited. */ }
    await Promise.race([serverExit, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  for (let index = 0; index < 30 && await portIsOpen(); index++) await new Promise(resolve => setTimeout(resolve, 100));
  if (await portIsOpen()) throw new Error(`Owned preview server did not release port ${port}.`);
};
process.on('exit', () => {
  if (server.exitCode === null && server.signalCode === null) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already closed. */ }
  }
});

const report = {
  scope: '独立正式角色、动作补丁与浏览器测量；不是主场景、整局游玩、FPS或追踪验收',
  url: base,
  viewport: { width: 1440, height: 900 },
  coordinateConvention: 'actualBodyMaxY、actualCombinedMaxY、脚底与椅面均为世界坐标；手部与脚踝目标来自motion诊断',
  sourceHashesBefore: await hashes(),
  captures: [],
  transitionSamples: [],
  errors: [],
  warnings: [],
  contractFailures: [],
  benchmark: null,
  playbackControl: null,
  serverLog: '',
  visualReview: '待实际查看截图；脚本不自动判定自然度、穿插或整局通过',
};
const finiteArray = values => values.every(Number.isFinite);
let browser;
const check = (condition, message, context = {}) => {
  if (!condition) report.contractFailures.push({ ...context, message });
};
const checkState = (state, context = {}) => {
  check(state.actors.length > 0, 'No active actor state', context);
  for (const actor of state.actors) {
    const label = `${actor.kind}/${actor.assetId}`;
    check(actor.matrixFinite, `Non-finite world matrix: ${label}`, context);
    check(finiteArray(actor.rootPosition) && finiteArray(actor.chairPosition), `Non-finite root or chair position: ${label}`, context);
    check(Number.isFinite(actor.actualBodyMaxY) && Number.isFinite(actor.actualCombinedMaxY), `Non-finite deformed height: ${label}`, context);
    check(actor.materials.length > 0, `Missing material inventory: ${label}`, context);
    for (const side of ['Left', 'Right']) {
      const sole = actor.soles[side];
      check(Number.isFinite(sole.minY) && Number.isFinite(sole.seatY) && Number.isFinite(sole.error), `Non-finite sole measurement: ${label}/${side}`, context);
    }
    for (const contacts of [actor.diagnostics.feet, actor.diagnostics.hands]) {
      for (const side of ['left', 'right']) {
        const contact = contacts[side];
        check(finiteArray(contact.position) && finiteArray(contact.target) && Number.isFinite(contact.error), `Non-finite contact diagnostics: ${label}/${side}`, context);
      }
    }
  }
};

try {
  let ready = false;
  for (let index = 0; index < 300; index++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Preview server did not start: ${serverLog}`);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(`pageerror: ${String(error)}`));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(`console: ${message.text()}`);
    if (message.type() === 'warning') report.warnings.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => report.errors.push(`requestfailed: ${request.url()} · ${request.failure()?.errorText || 'unknown'}`));
  page.on('response', response => {
    if (response.status() >= 400) report.errors.push(`http ${response.status()}: ${response.url()}`);
  });

  await page.goto(base, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__characterMotionQA?.ready === true, undefined, { timeout: 120000 });
  await page.locator('.asset-gallery__stage[data-ready="true"]').waitFor({ timeout: 120000 });
  if (await page.locator('.asset-gallery__error').isVisible()) throw new Error(await page.locator('.asset-gallery__error').textContent());

  for (const [pose, views] of Object.entries(capturesByPose)) {
    await page.evaluate(id => window.__characterMotionQA.setPose(id), pose);
    for (const view of views) {
      await page.evaluate(id => window.__characterMotionQA.setView(id), view);
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => window.__characterMotionQA.state());
      const context = { pose, view };
      check(state.pose === pose && state.view === view, `QA state mismatch: ${state.pose}/${state.view}`, context);
      checkState(state, context);
      if (!pose.startsWith('leader')) {
        check(state.actors.length === 2, `Expected player and colleague, received ${state.actors.length}`, context);
        check(state.actors.every(actor => actor.chairCount === 1), 'Each actor must retain exactly one internal formal chair', context);
      } else {
        check(state.actors.length === 1 && state.actors[0].kind === 'leader', 'Leader pose must isolate the formal leader', context);
      }
      if (pose === 'chair-work' || pose === 'chair-pot') {
        for (const actor of state.actors) {
          check(actor.diagnostics.activity === 'chair-work' && actor.diagnostics.support === 1, `Elevated work did not settle: ${actor.kind}`, context);
          check(actor.chairVisible && Math.abs(actor.chairWorldPosition[1]) < 1e-8, `Internal chair is not visible and grounded: ${actor.kind}`, context);
          for (const side of ['Left', 'Right']) {
            check(Math.abs(actor.soles[side].error) <= .025, `${actor.kind}/${side} deformed sole differs from seat by ${(actor.soles[side].error * 1000).toFixed(1)} mm`, context);
            const surface = actor.handSurfaces[side];
            check(surface.samples > 0 && Number.isFinite(surface.clearance), `${actor.kind}/${side} has no real hand skin over the desktop`, context);
            check(surface.clearance >= -.006 && surface.clearance <= .012, `${actor.kind}/${side} real hand skin clears the desktop by ${(surface.clearance * 1000).toFixed(1)} mm; allowed -6…+12 mm`, context);
          }
          for (const side of ['left', 'right']) {
            check(actor.diagnostics.feet[side].verticalError < .006, `${actor.kind}/${side} ankle target error exceeds 6 mm`, context);
            check(actor.diagnostics.hands[side].error < .006, `${actor.kind}/${side} hand target error exceeds 6 mm`, context);
            check(Math.abs(actor.diagnostics.hands[side].target[1] - 1.985) < 1e-6, `${actor.kind}/${side} desktop wrist target is not 1.985 m`, context);
          }
        }
      }
      if (pose === 'chair-mount') {
        for (const actor of state.actors) {
          check(actor.diagnostics.activity === 'chair-mount', `Wrong mounting activity: ${actor.kind}`, context);
          const feet = actor.diagnostics.feet;
          check(Math.abs(feet.left.position[1] - feet.right.position[1]) > .08, `${actor.kind} feet are not staggered`, context);
        }
      }
      if (pose === 'chair-dismount' || pose === 'chair-recover') {
        for (const actor of state.actors) check(actor.diagnostics.support > 0 && actor.diagnostics.support < 1, `${actor.kind} is not in a recovery transition`, context);
      }
      if (pose === 'chair-pot') {
        for (const actor of state.actors) check(actor.actualCombinedMaxY <= 2.35, `${actor.kind} actual skin/pot maximum exceeds 2.35 m: ${actor.actualCombinedMaxY}`, context);
      }
      if (pose === 'leader-inspect') check(state.actors[0].diagnostics.transitionProgress > 0 && state.actors[0].diagnostics.transitionProgress < 1, 'Inspection is not captured mid-blend', context);
      if (pose.startsWith('leader-search')) {
        const expected = pose.endsWith('left') ? Math.PI / 2 : -Math.PI / 2;
        const diagnostics = state.actors[0].diagnostics;
        check(diagnostics.cadence === 1.5, `Search cadence is ${diagnostics.cadence}, expected 1.5`, context);
        check(Math.abs(diagnostics.appliedLookYaw - expected) < 1e-8, `Incorrect applied scan yaw: ${diagnostics.appliedLookYaw}`, context);
      }
      const file = path.join(output, `${pose}-${view}.png`);
      await page.screenshot({ path: file, timeout: 60000, animations: 'disabled' });
      report.captures.push({ pose, view, file: path.relative(root, file), state });
    }
  }

  for (const [pose, phases] of Object.entries({
    'chair-mount': [.01, .15, .32, .55, .66, .72, .78, 1],
    'chair-dismount': [.01, .10, .18, .31, .57, .9],
    'chair-recover': [.01, .18, .39, .57, .9],
    'leader-inspect': [.01, .08, .2, .5],
    'leader-search-left': [.01, .08, .2, .65],
    'leader-search-right': [.01, .08, .2, .65],
  })) {
    for (const phase of phases) {
      const state = await page.evaluate(({ id, phase }) => { window.__characterMotionQA.setPose(id, phase); return window.__characterMotionQA.state(); }, { id: pose, phase });
      const context = { pose, phase, transitionSample: true };
      checkState(state, context);
      if (pose.startsWith('chair-')) {
        const desktopY = pose === 'chair-recover' ? .75 : 1.9;
        for (const actor of state.actors) {
          for (const side of ['Left', 'Right']) {
            const surface = actor.handSurfaces[side];
            if (!surface.samples) continue;
            check(!(surface.minY < desktopY - .006 && surface.maxY > desktopY + .006), `${actor.kind}/${side} hand skin straddles the desktop during transition: ${surface.minY.toFixed(4)}…${surface.maxY.toFixed(4)} around ${desktopY}`, context);
          }
        }
      }
      report.transitionSamples.push({ pose, phase, actors: state.actors.map(actor => ({ kind: actor.kind, diagnostics: actor.diagnostics, handSurfaces: actor.handSurfaces, matrixFinite: actor.matrixFinite })) });
    }
  }

  await page.locator('[data-pose="chair-mount"]').click();
  await page.locator('.character-motion-preview__play').click();
  await page.waitForTimeout(180);
  const playing = await page.evaluate(() => window.__characterMotionQA.state().playing);
  await page.locator('.character-motion-preview__play').click();
  const stopped = await page.evaluate(() => !window.__characterMotionQA.state().playing);
  report.playbackControl = { playing, stopped, scope: '预览播放按钮与关键帧复位；不是连续整局操作验收' };
  check(playing && stopped, 'Preview playback controls did not toggle correctly');
  report.benchmark = await page.evaluate(() => window.__characterMotionQA.benchmark(180));
  report.sourceHashesAfter = await hashes();
  report.sourcesUnchanged = sourceFiles.every(file => report.sourceHashesBefore[file] === report.sourceHashesAfter[file]);
  check(report.sourcesUnchanged, 'One or more source files changed during browser capture');
  const expectedCaptures = Object.values(capturesByPose).reduce((sum, views) => sum + views.length, 0);
  if (report.captures.length !== expectedCaptures) throw new Error(`Expected ${expectedCaptures} captures, received ${report.captures.length}`);
  if (report.errors.length || report.contractFailures.length) process.exitCode = 1;
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try {
    await stop();
    report.ownedServerStopped = true;
    report.portReleased = true;
  } catch (error) {
    report.ownedServerStopped = false;
    report.portReleased = false;
    report.errors.push(String(error));
    process.exitCode = 1;
  }
  report.serverLog = serverLog;
  await writeFile(path.join(output, 'motion-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    captures: report.captures.length,
    transitionSamples: report.transitionSamples.length,
    errors: report.errors,
    warnings: report.warnings,
    contractFailures: report.contractFailures,
    benchmark: report.benchmark,
    playbackControl: report.playbackControl,
    sourcesUnchanged: report.sourcesUnchanged,
    failure: report.failure,
    ownedServerStopped: report.ownedServerStopped,
    portReleased: report.portReleased,
    output: path.relative(root, output),
  }, null, 2));
}
