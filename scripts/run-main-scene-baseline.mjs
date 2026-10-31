import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 5174;
const base = `http://127.0.0.1:${port}/leadership-always-right/`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(root, `docs/kimi/verification/main-scene-baseline-${stamp}`);
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
  if (await portIsOpen()) throw new Error(`Owned server did not release port ${port}.`);
};
process.on('exit', () => {
  if (server.exitCode === null && server.signalCode === null) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already closed. */ }
  }
});
let child;
try {
  let ready = false;
  for (let index = 0; index < 240; index++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Preview server did not start: ${serverLog}`);
  child = spawn(process.execPath, ['.local/expansion-e2e.mjs'], { cwd: root, env: { ...process.env, E2E_OUT: out }, stdio: 'inherit' });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  console.log(JSON.stringify({ evidence: out, childExit: exit }));
  if (exit.code) process.exitCode = exit.code;
  if (exit.signal) process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await stop();
}
