import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.join(root, 'design/entry-experience/audit');
const port = 5197;
const base = `http://127.0.0.1:${port}/leadership-always-right/`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const enter = page.getByRole('button', { name: '进入办公室' });
  await enter.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => !(document.querySelector('button[disabled]')?.textContent?.includes('进入办公室')));
  await enter.click({ timeout: 10000 });
  await page.getByRole('button', { name: '开始上班' }).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'current-ui-home-1440x900.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'current-ui-home-390x844.png'), fullPage: true });
  console.log(JSON.stringify({ text: (await page.locator('body').innerText()).slice(0, 6000), out }, null, 2));
} finally {
  if (browser) await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}
