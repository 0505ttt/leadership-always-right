import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = Number(process.env.ROOM_DECORATIONS_SEED ?? '42');
const outputName = process.env.ROOM_DECORATIONS_OUT ?? 'room-decorations';
const output = path.join(root, 'docs/kimi/verification', outputName);
const port = 5192;
const base = `http://127.0.0.1:${port}/leadership-always-right/room-decoration-preview.html?seed=${seed}`;
const checksOnly = process.argv.includes('--checks-only');
function overlaps(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - .0001 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - .0001;
}
function reservations(world) {
  return [
    ...world.desks.flatMap(desk => {
      const workPoint = desk.workPoint ?? desk.seat;
      return [
        { id: `${desk.id}:seat`, x: desk.seat.x, z: desk.seat.z, w: .82, d: .86 },
        { id: `${desk.id}:workPoint`, x: workPoint.x, z: workPoint.z, w: .82, d: .86 },
        {
          id: `${desk.id}:docking`,
          x: (desk.seat.x + workPoint.x) / 2,
          z: (desk.seat.z + workPoint.z) / 2,
          w: Math.abs(desk.seat.x - workPoint.x) + .82,
          d: Math.abs(desk.seat.z - workPoint.z) + .86,
        },
      ];
    }),
    ...world.colleagues.map(person => ({ id: `colleague:${person.id}`, x: person.x, z: person.z, w: .76, d: .76 })),
    ...world.rooms.map(room => ({
      id: `switch:${room.id}`,
      x: room.switch.x + Math.sin(room.switch.yaw ?? 0) * .65,
      z: room.switch.z + Math.cos(room.switch.yaw ?? 0) * .65,
      w: .85, d: .85,
    })),
    ...world.patrol.map((point, index) => ({ id: `patrol:${index}`, x: point.x, z: point.z, w: .85, d: .85 })),
    ...world.props.filter(prop => prop.kind === 'cake').map(prop => ({ id: `${prop.id}:max`, x: prop.x, z: prop.z, w: 1.8, d: 1.8 })),
  ];
}
function safetyFailures(world, colliders) {
  const reserved = reservations(world);
  const failures = [];
  for (const collider of colliders) {
    for (const reservation of reserved) if (overlaps(collider, reservation)) failures.push({ colliderId: collider.id, reservationId: reservation.id });
    const room = world.rooms.find(item => item.id === collider.roomId);
    if (room?.pressure && collider.height > 1.5) failures.push({ colliderId: collider.id, reservationId: `pressure-height:${room.id}`, actualHeight: collider.height });
  }
  return failures;
}
await mkdir(output, { recursive: true });
const portIsOpen = () => new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const finish = value => { socket.removeAllListeners(); socket.destroy(); resolve(value); };
  socket.setTimeout(500);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});
if (await portIsOpen()) throw new Error(`Port ${port} is already in use; refusing to touch another server.`);
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', data => { serverLog += data; });
server.stderr.on('data', data => { serverLog += data; });
const serverExit = new Promise(resolve => server.once('exit', resolve));
const stop = async () => {
  if (server.exitCode === null && server.signalCode === null) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Owned server already exited. */ }
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
  scope: '正式房间装饰模块的独立浏览器预览；不是 Codex 主场景、完整玩法或硬件帧率验收',
  seed,
  url: base,
  additionalTripoCreditsConsumed: 0,
  captures: [], roomRenderInfo: {}, errors: [], warnings: [], failures: [],
  visualReview: 'pending-actual-image-review',
  integratedByCodex: false,
  gameplayVerified: false,
};
let browser;
try {
  let ready = false;
  for (let index = 0; index < 240; index++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Preview server did not start: ${serverLog}`);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(`pageerror: ${String(error)}`));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(`console: ${message.text()}`);
    if (message.type() === 'warning') report.warnings.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => report.errors.push(`requestfailed: ${request.url()} · ${request.failure()?.errorText || 'unknown'}`));
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`http ${response.status()}: ${response.url()}`); });
  await page.goto(base, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__ROOM_DECORATIONS__?.ready === true, undefined, { timeout: 120000 });
  await page.evaluate(() => window.__ROOM_DECORATIONS__.setCaptureMode(true));
  if (await page.locator('#error').isVisible()) report.failures.push(`Error panel: ${await page.locator('#error').textContent()}`);
  const rooms = await page.evaluate(() => window.__ROOM_DECORATIONS__.rooms);
  const loadedModels = await page.evaluate(() => ({ loaded: window.__ROOM_DECORATIONS__.loadedModels, errors: window.__ROOM_DECORATIONS__.loadErrors }));
  report.loadedModels = loadedModels;
  if (rooms.length !== 10 || new Set(rooms.map(room => room.id)).size !== 10) report.failures.push('Expected ten unique rooms.');
  if (loadedModels.loaded.length !== 10 || loadedModels.errors.length) report.failures.push('One or more local GLB assets did not load.');
  const initialDiagnostics = await page.evaluate(() => window.__ROOM_DECORATIONS__.getDiagnostics());
  report.diagnostics = initialDiagnostics;
  report.decorationResources = await page.evaluate(() => window.__ROOM_DECORATIONS__.getDecorationResourceInfo());
  const currentWorld = await page.evaluate(() => window.__ROOM_DECORATIONS__.getWorld());
  report.safetyViolations = safetyFailures(currentWorld, initialDiagnostics.colliders);
  if (report.safetyViolations.length) report.failures.push(`Safety reservations intersect: ${report.safetyViolations.map(item => `${item.colliderId}/${item.reservationId}`).join(', ')}`);
  const pressureProbe = await page.evaluate(async () => {
    const { generateWorld } = await import('/leadership-always-right/src/world/generate.ts');
    const { createRoomDecorations } = await import('/leadership-always-right/src/presentation/room-decorations.ts');
    const world = generateWorld(42);
    for (const room of world.rooms) room.pressure = room.kind === 'storage';
    const decorations = createRoomDecorations(world);
    const result = { world, colliders: decorations.getDiagnostics().colliders };
    decorations.dispose();
    return result;
  });
  report.pressureProbeViolations = safetyFailures(pressureProbe.world, pressureProbe.colliders);
  if (report.pressureProbeViolations.length) report.failures.push(`Low-pressure probe contains over-height furniture: ${report.pressureProbeViolations.map(item => `${item.colliderId}/${item.actualHeight}`).join(', ')}`);
  if (initialDiagnostics.missingModels.length) report.failures.push(`Missing models: ${initialDiagnostics.missingModels.join(', ')}`);
  if (initialDiagnostics.violations.length) report.failures.push(...initialDiagnostics.violations);
  for (const room of initialDiagnostics.rooms) {
    if (room.placed < 1 || room.signs < 1) report.failures.push(`Room ${room.roomId} lacks decoration or signs.`);
  }
  const wallOverlaps = [];
  const attachmentGroups = new Map();
  for (const item of initialDiagnostics.wallAttachments) {
    const key = `${item.roomId}:${item.wallId}`;
    attachmentGroups.set(key, [...attachmentGroups.get(key) ?? [], item]);
  }
  for (const group of attachmentGroups.values()) {
    for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
      const first = group[a], second = group[b];
      if (first.id.startsWith('partition-board:') && second.id.startsWith('partition-board:')) continue;
      const vertical = Math.abs(first.position[0] - second.position[0]) < .001;
      const alongA = vertical ? first.position[2] : first.position[0];
      const alongB = vertical ? second.position[2] : second.position[0];
      if (Math.abs(alongA - alongB) < (first.width + second.width) / 2 - .005) wallOverlaps.push([first.id, second.id]);
    }
  }
  report.wallOverlaps = wallOverlaps;
  if (wallOverlaps.length) report.failures.push('Wall attachments overlap on the same room/wall face.');
  for (const room of rooms.filter(item => item.pressure)) {
    for (const item of initialDiagnostics.wallAttachments.filter(attachment => attachment.roomId === room.id)) {
      if (item.position[1] + item.height / 2 > 1.505) report.failures.push(`Low-clearance attachment exceeds 1.50m: ${item.id}`);
    }
  }

  const views = [
    { mode: 'game', material: 'solid', slug: 'game' },
    { mode: 'sign', material: 'solid', slug: 'sign' },
    { mode: 'material', material: 'solid', slug: 'material-solid' },
    { mode: 'material', material: 'surface', slug: 'material-surface' },
    { mode: 'overview', material: 'solid', slug: 'overview' },
  ];
  for (const room of checksOnly ? [] : rooms) {
    await page.evaluate(id => window.__ROOM_DECORATIONS__.setRoom(id), room.id);
    for (const view of views) {
      await page.evaluate(config => window.__ROOM_DECORATIONS__.setView(config.mode, config.material), view);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(100);
      const state = await page.evaluate(() => window.__ROOM_DECORATIONS__.getViewState());
      if (state.roomId !== room.id || state.viewMode !== view.mode || state.fallback) report.failures.push(`View mismatch/fallback: ${room.id}/${view.slug}`);
      const filename = `room-${String(room.id).padStart(2, '0')}-${view.slug}.png`;
      await page.screenshot({ path: path.join(output, filename), timeout: 60000, animations: 'disabled' });
      report.captures.push({ roomId: room.id, room: room.name, view: view.slug, file: `docs/kimi/verification/room-decorations/${filename}`, camera: state });
      if (view.slug === 'overview') report.roomRenderInfo[room.id] = await page.evaluate(() => window.__ROOM_DECORATIONS__.getRendererInfo());
    }
    console.log(`Captured room ${room.id} ${room.name}: five views`);
  }
  if (report.captures.length !== (checksOnly ? 0 : 50)) report.failures.push(`Unexpected capture count ${report.captures.length}.`);

  const measurements = await page.evaluate(() => window.__ROOM_DECORATIONS__.measureColliders());
  report.colliderMeasurements = measurements;
  for (const item of measurements) {
    if (item.missing) { report.failures.push(`Collider visual missing: ${item.id}`); continue; }
    const numbers = [item.actual.w, item.actual.d, item.actual.height, item.ground, item.delta.w, item.delta.d, item.delta.height];
    if (!numbers.every(Number.isFinite)) report.failures.push(`Non-finite collider measurement: ${item.id}`);
    if (item.delta.w > .035 || item.delta.d > .035 || item.delta.height > .035) report.failures.push(`Underestimated collider: ${item.id}`);
    if (item.delta.w < -.3 || item.delta.d < -.3 || item.delta.height < -.3) report.failures.push(`Excessively conservative collider: ${item.id}`);
    if (item.ground < -.04 || item.ground > .08) report.failures.push(`Unexpected collider ground height: ${item.id}/${item.ground}`);
  }
  const reception = measurements.find(item => item.id.startsWith('reception-desk:'));
  report.receptionMeasureExclude = reception ? { excludedNodes: reception.excludedNodes, delta: reception.delta } : null;
  if (!reception?.excludedNodes?.length) report.failures.push('Reception rug was not excluded from solid measurement.');

  const stateResult = await page.evaluate(() => window.__ROOM_DECORATIONS__.verifyStates());
  report.stateResult = stateResult;
  for (const key of ['wallHidden', 'wallRestored', 'floorPreserved', 'deskFollows', 'computerFollows', 'desktopFollows', 'tagFound', 'pressureSafe', 'pressureUnaffected', 'pressureDiagnosticsSync', 'pressureRestored']) {
    if (!stateResult[key]) report.failures.push(`State assertion failed: ${key}`);
  }
  if (stateResult.pressureViolations.length) report.failures.push('Dynamic pressure diagnostics reported violations.');

  const stateBeforeVariableDesks = await page.evaluate(() => window.__ROOM_DECORATIONS__.getTestState());
  const deskIds = await page.evaluate(() => window.__ROOM_DECORATIONS__.measureDeskBindings().map(item => item.deskId));
  const variableHeights = Object.fromEntries(deskIds.map((id, index) => [id, .93 + (index % 3) * .2]));
  await page.evaluate(heights => window.__ROOM_DECORATIONS__.setTestState({ deskHeights: heights }), variableHeights);
  const variableDeskBindings = await page.evaluate(() => window.__ROOM_DECORATIONS__.measureDeskBindings());
  report.variableDeskBindings = variableDeskBindings;
  for (const item of variableDeskBindings) {
    if (Math.abs(item.computerY - item.expectedY) > .0001 || Math.abs(item.desktopY - item.expectedY) > .0001) report.failures.push(`Variable desk height mismatch: ${item.deskId}`);
    if (item.hasTag && Math.abs(item.tagY - item.expectedY) > .0001) report.failures.push(`Variable desk tag mismatch: ${item.deskId}`);
  }
  await page.evaluate(state => window.__ROOM_DECORATIONS__.setTestState(state), stateBeforeVariableDesks);

  const firstRoom = rooms[0].id;
  await page.evaluate(id => window.__ROOM_DECORATIONS__.setRoom(id), firstRoom);
  await page.evaluate(() => window.__ROOM_DECORATIONS__.startTour());
  await page.waitForTimeout(4550);
  const tourRoom = await page.evaluate(() => window.__ROOM_DECORATIONS__.getViewState().roomId);
  report.tour = { startedAt: firstRoom, afterOneInterval: tourRoom };
  if (tourRoom === firstRoom) report.failures.push('Continuous room tour did not advance.');
  await page.evaluate(() => window.__ROOM_DECORATIONS__.stopTour());

  report.seedAudits = await page.evaluate(async seeds => {
    const { generateWorld } = await import('/leadership-always-right/src/world/generate.ts');
    const { createRoomDecorations } = await import('/leadership-always-right/src/presentation/room-decorations.ts');
    const results = [];
    for (const seed of seeds) {
      const world = generateWorld(seed);
      const decorations = createRoomDecorations(world);
      try {
        const diagnostics = decorations.getDiagnostics();
        const requiredPrefix = { front: 'company-sign:', meeting: 'meeting-agenda:', print: 'print-workflow:', storage: 'archive-index:', tea: 'tea-duty:', boss: 'boss-award:', admin: 'admin-notice:' };
        const roomChecks = world.rooms.map(room => {
          const prefix = requiredPrefix[room.kind] ?? 'work-board:';
          return {
            roomId: room.id, name: room.name, kind: room.kind,
            roomNameSign: Boolean(decorations.root.getObjectByName(`room-sign:${room.id}`)),
            identitySign: Boolean(decorations.root.children.find(object => object.name.startsWith(prefix) && object.name.endsWith(`:${room.id}`))),
          };
        });
        results.push({
          seed,
          world,
          colliders: diagnostics.colliders,
          roomOrder: world.rooms.map(room => ({ id: room.id, name: room.name, kind: room.kind })),
          roomChecks,
          violations: diagnostics.violations,
          skipped: diagnostics.skipped,
          colliderCount: diagnostics.colliders.length,
          wallAttachmentCount: diagnostics.wallAttachments.length,
        });
      } finally { decorations.dispose(); }
    }
    return results;
  }, [618, 1, 2, 3, 4, 5, 42, 2026]);
  for (const audit of report.seedAudits) {
    audit.safetyViolations = safetyFailures(audit.world, audit.colliders);
    if (audit.safetyViolations.length) report.failures.push(`Seed ${audit.seed} safety reservations intersect: ${audit.safetyViolations.map(item => `${item.colliderId}/${item.reservationId}`).join(', ')}`);
    if (audit.violations.length) report.failures.push(`Seed ${audit.seed}: ${audit.violations.join('; ')}`);
    for (const room of audit.roomChecks) {
      if (!room.roomNameSign || !room.identitySign) report.failures.push(`Seed ${audit.seed} room ${room.roomId} lacks name/identity sign.`);
    }
  }
  if (report.errors.length) process.exitCode = 1;
  if (report.failures.length) process.exitCode = 1;
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
  report.structuralPass = !report.failure && !report.failures.length && !report.errors.length;
  await writeFile(path.join(output, 'runtime-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ captures: report.captures.length, failures: report.failures, errors: report.errors, failure: report.failure, structuralPass: report.structuralPass, visualReview: report.visualReview, ownedServerStopped: report.ownedServerStopped, portReleased: report.portReleased }, null, 2));
}
