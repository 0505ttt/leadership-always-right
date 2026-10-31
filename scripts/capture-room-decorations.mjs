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
const setIndex = process.argv.indexOf('--set');
const set = setIndex >= 0 ? process.argv[setIndex + 1] : '';
if (!['a', 'b'].includes(set)) throw new Error('Use --set a for rooms 0–4 or --set b for rooms 5–9.');
const wantedIds = set === 'a' ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
const port = 5192;
const base = `http://127.0.0.1:${port}/leadership-always-right/room-decoration-preview.html?seed=${seed}`;
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
const report = { set, seed, rooms: wantedIds, scope: '分批真实浏览器截图与渲染统计；不做整局或硬件性能结论', captures: [], roomRenderInfo: {}, errors: [], warnings: [], failures: [], visualReview: 'pending-actual-image-review' };
let browser;
try {
  let ready = false;
  for (let index = 0; index < 240; index++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Preview server did not start: ${serverLog}`);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
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
  await page.waitForTimeout(1200);
  report.initialRenderInfo = await page.evaluate(() => window.__ROOM_DECORATIONS__.getRendererInfo());
  await page.evaluate(() => window.__ROOM_DECORATIONS__.setCaptureMode(true));
  const rooms = await page.evaluate(() => window.__ROOM_DECORATIONS__.rooms);
  const selected = wantedIds.map(id => rooms.find(room => room.id === id));
  if (selected.some(room => !room)) throw new Error('Selected room is absent from current world.');
  const views = [
    { mode: 'game', material: 'solid', slug: 'game' },
    { mode: 'sign', material: 'solid', slug: 'sign' },
    { mode: 'material', material: 'solid', slug: 'material-solid' },
    { mode: 'material', material: 'surface', slug: 'material-surface' },
    { mode: 'overview', material: 'solid', slug: 'overview' },
  ];
  for (const room of selected) {
    await page.evaluate(id => window.__ROOM_DECORATIONS__.setRoom(id), room.id);
    for (const view of views) {
      await page.evaluate(config => window.__ROOM_DECORATIONS__.setView(config.mode, config.material), view);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await page.evaluate(() => window.__ROOM_DECORATIONS__.getViewState());
      if (state.roomId !== room.id || state.viewMode !== view.mode || state.fallback) report.failures.push(`View mismatch/fallback: ${room.id}/${view.slug}`);
      const filename = `room-${String(room.id).padStart(2, '0')}-${view.slug}.png`;
      await page.screenshot({ path: path.join(output, filename), timeout: 60000, animations: 'disabled' });
      report.captures.push({ roomId: room.id, room: room.name, view: view.slug, file: `docs/kimi/verification/room-decorations/${filename}`, camera: state });
      if (view.slug === 'overview') report.roomRenderInfo[room.id] = await page.evaluate(() => window.__ROOM_DECORATIONS__.getRendererInfo());
    }
    console.log(`Captured room ${room.id} ${room.name}: five views`);
  }
  if (report.captures.length !== 25) report.failures.push(`Expected 25 captures, got ${report.captures.length}.`);
  if (report.errors.length || report.failures.length) process.exitCode = 1;
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
  await writeFile(path.join(output, `runtime-captures-${set}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ set, captures: report.captures.length, failures: report.failures, errors: report.errors, failure: report.failure, structuralPass: report.structuralPass, ownedServerStopped: report.ownedServerStopped, portReleased: report.portReleased }, null, 2));
}
