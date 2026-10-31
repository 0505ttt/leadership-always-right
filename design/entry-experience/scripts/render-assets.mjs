import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const project = path.resolve(root, '../..');
const port = 5198;
const server = spawn(process.execPath, [path.join(project, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: project, stdio: 'ignore' });
let browser;
try {
  const url = `http://127.0.0.1:${port}/leadership-always-right/design/entry-experience/render-assets.html`;
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/leadership-always-right/`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  page.on('pageerror', error => console.error(error));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__ENTRY_RENDER__ || window.__ENTRY_RENDER_ERROR__, null, { timeout: 60000 });
  const error = await page.evaluate(() => window.__ENTRY_RENDER_ERROR__);
  if (error) throw new Error(error);
  const result = await page.evaluate(() => window.__ENTRY_RENDER__);
  const buffer = Buffer.from(result.dataUrl.split(',')[1], 'base64');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/entry-scene.png'), buffer);
  await fs.writeFile(path.join(root, 'audit/render-diagnostics.json'), JSON.stringify(result.diagnostics, null, 2));
  console.log(JSON.stringify({ bytes: buffer.length, assets: result.diagnostics.assets }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) server.kill('SIGKILL');
}
process.exit(0);
