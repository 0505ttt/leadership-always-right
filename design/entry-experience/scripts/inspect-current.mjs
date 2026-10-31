import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '../../..');
const outputDir = path.join(projectRoot, 'design/entry-experience/audit');
await fs.mkdir(outputDir, { recursive: true });
const port = 5197;
const origin = `http://127.0.0.1:${port}`;
const base = `${origin}/leadership-always-right/`;
const server = spawn(process.execPath, [path.join(projectRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited early: ${serverLog}`);
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not start: ${serverLog}`);
}

const observations = { errors: [], pages: {} };
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => observations.errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') observations.errors.push(message.text());
  });

  await page.goto(`${base}?preview=gallery`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outputDir, 'current-ui-home-1440x900.png'), fullPage: true });
  observations.pages.uiHome = {
    title: await page.title(),
    text: (await page.locator('body').innerText()).slice(0, 8000),
    buttons: await page.getByRole('button').allTextContents(),
  };

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(outputDir, 'current-home-1440x900.png'), fullPage: true });
  observations.pages.home = {
    title: await page.title(),
    text: (await page.locator('body').innerText()).slice(0, 8000),
    buttons: await page.getByRole('button').allTextContents(),
  };

  await page.goto(`${base}loading-preview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(outputDir, 'current-loading-1440x900.png'), fullPage: true });
  observations.pages.loading = {
    title: await page.title(),
    text: (await page.locator('body').innerText()).slice(0, 8000),
  };

  await page.goto(`${base}character-preview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(6500);
  await page.screenshot({ path: path.join(outputDir, 'current-characters-1440x900.png'), fullPage: true });
  observations.pages.characters = {
    title: await page.title(),
    text: (await page.locator('body').innerText()).slice(0, 8000),
  };

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => observations.errors.push(String(error)));
  await mobile.goto(base, { waitUntil: 'domcontentloaded' });
  await mobile.waitForTimeout(5000);
  await mobile.screenshot({ path: path.join(outputDir, 'current-home-390x844.png'), fullPage: true });
  observations.pages.mobileHome = {
    text: (await mobile.locator('body').innerText()).slice(0, 8000),
    scrollWidth: await mobile.evaluate(() => document.documentElement.scrollWidth),
  };
  await mobile.close();

  await fs.writeFile(path.join(outputDir, 'current-observations.json'), JSON.stringify(observations, null, 2));
  console.log(JSON.stringify({ outputDir, observations }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}
