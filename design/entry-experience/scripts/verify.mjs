import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const project = path.resolve(root, '../..');
const out = path.join(root, 'output');
await fs.mkdir(out, { recursive: true });
const port = 5201;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(project, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const report = { checks: [], errors: [], screenshots: [], ownedServerStopped: false, portReleased: false };
const check = (name, condition, details) => {
  report.checks.push({ name, passed: Boolean(condition), details });
  if (!condition) report.errors.push(name);
};
let browser;
try {
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) throw new Error('Preview server exited early');
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });

  async function open(targetPage, state = 'home') {
    await targetPage.goto(`${origin}/?ui=${state}&chrome=0`, { waitUntil: 'domcontentloaded' });
    await targetPage.waitForSelector('.entry-line-field canvas');
    await targetPage.waitForFunction(() => {
      const image = document.querySelector('.stage-scene');
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && window.__ENTRY_PREVIEW__;
    });
    await targetPage.waitForTimeout(650);
  }
  async function shot(targetPage, name) {
    const file = path.join(out, name);
    await targetPage.screenshot({ path: file, fullPage: false });
    report.screenshots.push(name);
  }
  async function layoutCheck(targetPage, label) {
    const data = await targetPage.evaluate(() => {
      const root = document.documentElement;
      const buttons = [...document.querySelectorAll('button:not([disabled])')].filter(button => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 && !button.closest('.demo-toolbar') && !button.closest('dialog');
      }).map(button => {
        const rect = button.getBoundingClientRect();
        return { text: button.textContent.trim(), width: rect.width, height: rect.height, bottom: rect.bottom };
      });
      const primaryElement = document.querySelector('[data-view="home"]:not([hidden]) [data-action="start"], [data-view="loading"]:not([hidden]) [data-action="enter"]');
      const primary = primaryElement?.getBoundingClientRect();
      const primaryHit = primary && primary.top >= 0 && primary.bottom <= innerHeight
        ? document.elementFromPoint(primary.left + primary.width / 2, primary.top + primary.height / 2)?.closest('[data-action]') === primaryElement
        : false;
      return { width: innerWidth, height: innerHeight, scrollWidth: root.scrollWidth, buttons, primary: primary ? { top: primary.top, bottom: primary.bottom } : null, primaryHit };
    });
    check(`${label}: no horizontal overflow`, data.scrollWidth <= data.width, data);
    check(`${label}: pointer targets at least 44px`, data.buttons.every(button => button.height >= 44), data.buttons);
    check(`${label}: primary action in first viewport`, data.primary && data.primary.top >= 0 && data.primary.bottom <= data.height + 1, data.primary);
    check(`${label}: primary action is not covered`, data.primaryHit, data.primary);
  }

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ENTRY_PREVIEW__);
  check('default route preloads before home', (await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics())).phase === 'loading');
  await page.locator('.company').click();
  check('company link cannot bypass preload', (await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics())).phase === 'loading');
  await page.locator('[data-action="tutorial"]:visible').click();
  for (let i = 0; i < 3; i += 1) await page.locator('[data-tutorial="next"]').click();
  check('tutorial cannot bypass preload', (await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics())).phase === 'loading');

  await open(page, 'home');
  await shot(page, 'desktop-home-1440x900.png');
  await layoutCheck(page, 'desktop home');
  check('home has editable title', await page.locator('h1').innerText() === '领导说的\n都是真的。');
  check('home line field sampled once', (await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics())).cards[0].samples === 1);

  await open(page, 'loading');
  await shot(page, 'desktop-loading-1440x900.png');
  await layoutCheck(page, 'desktop loading');
  check('loading enter disabled', await page.locator('[data-action="enter"]').isDisabled());
  check('real stages visible', await page.locator('.resource-steps li').count() === 5);

  await open(page, 'ready');
  await shot(page, 'desktop-ready-1440x900.png');
  check('ready enter enabled', await page.locator('[data-action="enter"]').isEnabled());
  await page.locator('[data-action="enter"]').click();
  check('ready enters home', (await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics())).phase === 'home');
  check('enter callback visible in preview', await page.locator('.entry-toast').isVisible());

  await open(page, 'error');
  await shot(page, 'desktop-error-1440x900.png');
  check('error enter disabled', await page.locator('[data-action="enter"]').isDisabled());
  await page.locator('.retry-button').click();
  check('retry uses real resource id', (await page.locator('[data-loading-detail]').innerText()).includes('leader-v1'));
  check('retry does not fabricate ready', await page.locator('[data-action="enter"]').isDisabled());

  await open(page, 'home');
  await page.locator('[data-action="start"]').click();
  check('start does not enter loading again', (await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics())).phase === 'home');
  check('start emits immediate-play callback', (await page.locator('.entry-toast').innerText()).includes('立即开局'));
  await page.locator('[data-action="motion"]').click();
  await page.waitForTimeout(120);
  let diagnostics = await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics());
  check('decorative motion paused', !diagnostics.motionEnabled && !diagnostics.cards[0].scheduled, diagnostics);
  await page.evaluate(() => window.__ENTRY_PREVIEW__.update({ stage: 'ready', completedResources: 14, totalResources: 14 }));
  diagnostics = await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics());
  check('resource update continues while decoration paused', diagnostics.progress.stage === 'ready' && !diagnostics.motionEnabled);
  const samplesBeforeResize = diagnostics.cards[0].samples;
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);
  diagnostics = await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics());
  check('resize does not resample', diagnostics.cards[0].samples === samplesBeforeResize && diagnostics.cards[0].samples === 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.entry-line-field').focus();
  await page.waitForTimeout(450);
  diagnostics = await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics());
  check('keyboard focus scans luminance field', diagnostics.cards[0].scans > 0 && diagnostics.cards[0].targets > 0, diagnostics.cards[0]);
  await page.locator('[data-action="source"]').click();
  await page.waitForTimeout(100);
  diagnostics = await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics());
  check('source dialog pauses decorative loop', !diagnostics.cards[0].scheduled);
  check('source is not presented as AI', (await page.locator('[data-dialog="source"]').innerText()).includes('不是 AI 识别'));
  await page.keyboard.press('Escape');
  check('dialog escape restores source focus', await page.evaluate(() => document.activeElement?.dataset?.action === 'source'));

  await page.locator('[data-action="settings"]').click();
  check('settings opens modal', await page.locator('[data-dialog="settings"]').isVisible());
  await page.locator('[data-setting="motion"]').check();
  check('settings reduced motion syncs', !(await page.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics())).motionEnabled);
  await page.keyboard.press('Escape');
  await page.locator('[data-action="tutorial"]:visible').first().click();
  check('tutorial opens', await page.locator('[data-dialog="tutorial"]').isVisible());
  check('tutorial page one matches real controls', (await page.locator('[data-tutorial-content]').innerText()).includes('F') && (await page.locator('[data-tutorial-content]').innerText()).includes('Esc'));
  await page.locator('[data-tutorial="next"]').click();
  check('tutorial page advances', (await page.locator('[data-tutorial-count]').innerText()) === '02 / 03');
  check('tutorial page two matches real controls', (await page.locator('[data-tutorial-content]').innerText()).includes('Q') && (await page.locator('[data-tutorial-content]').innerText()).includes('R 轻放') && (await page.locator('[data-tutorial-content]').innerText()).includes('右键'));
  await page.locator('[data-tutorial="next"]').click();
  check('tutorial page three matches real controls', (await page.locator('[data-tutorial-content]').innerText()).includes('Tab') && (await page.locator('[data-tutorial-content]').innerText()).includes('触控'));
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__ENTRY_PREVIEW__.update({ stage: 'ready', completedResources: 14, totalResources: 14, failedItems: [{ id: 'chair-v1', label: '滚椅', message: '失败', retryable: false }] }));
  check('ready with failures stays blocked', await page.locator('[data-action="enter"]').isDisabled());
  check('non-retryable failure has no retry button', await page.locator('.retry-button').count() === 0);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => report.errors.push(String(error)));
  await open(mobile, 'home');
  await shot(mobile, 'mobile-home-390x844.png');
  await layoutCheck(mobile, 'mobile portrait home');
  const touchBox = await mobile.locator('.entry-line-field').boundingBox();
  await mobile.touchscreen.tap(touchBox.x + touchBox.width * .55, touchBox.y + touchBox.height * .55);
  await mobile.waitForTimeout(400);
  const touchDiagnostics = await mobile.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics());
  check('touch scans luminance field', touchDiagnostics.cards[0].scans > 0, touchDiagnostics.cards[0]);
  await open(mobile, 'ready');
  await shot(mobile, 'mobile-ready-390x844.png');
  await layoutCheck(mobile, 'mobile portrait ready');
  await open(mobile, 'error');
  await shot(mobile, 'mobile-error-390x844.png');
  await layoutCheck(mobile, 'mobile portrait error');
  await mobile.close();

  const landscape = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await open(landscape, 'home');
  await shot(landscape, 'mobile-landscape-home-844x390.png');
  await layoutCheck(landscape, 'mobile landscape home');
  await open(landscape, 'ready');
  await shot(landscape, 'mobile-landscape-ready-844x390.png');
  await layoutCheck(landscape, 'mobile landscape ready');
  await landscape.close();

  const smallPortrait = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await open(smallPortrait, 'home');
  await shot(smallPortrait, 'mobile-home-360x740.png');
  await layoutCheck(smallPortrait, 'small portrait home');
  await smallPortrait.locator('[data-action="tutorial"]:visible').click();
  await smallPortrait.locator('[data-tutorial="next"]').click();
  await smallPortrait.locator('[data-tutorial="next"]').click();
  await shot(smallPortrait, 'mobile-tutorial-360x740.png');
  const tutorialNext = await smallPortrait.locator('[data-tutorial="next"]').boundingBox();
  check('small portrait tutorial action remains reachable', tutorialNext && tutorialNext.y >= 0 && tutorialNext.y + tutorialNext.height <= 740, tutorialNext);
  await smallPortrait.keyboard.press('Escape');
  await open(smallPortrait, 'ready');
  await shot(smallPortrait, 'mobile-ready-360x740.png');
  await layoutCheck(smallPortrait, 'small portrait ready');
  await smallPortrait.close();

  const smallLandscape = await browser.newPage({ viewport: { width: 740, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await open(smallLandscape, 'home');
  await shot(smallLandscape, 'mobile-landscape-home-740x360.png');
  await layoutCheck(smallLandscape, 'small landscape home');
  await open(smallLandscape, 'ready');
  await shot(smallLandscape, 'mobile-landscape-ready-740x360.png');
  await layoutCheck(smallLandscape, 'small landscape ready');
  await smallLandscape.close();

  const reduced = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await open(reduced, 'loading');
  const reducedDiagnostics = await reduced.evaluate(() => window.__ENTRY_PREVIEW__.getDiagnostics());
  check('system reduced motion respected', !reducedDiagnostics.motionEnabled && !reducedDiagnostics.cards[0].scheduled, reducedDiagnostics);
  await reduced.close();

  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, errors: report.errors, screenshots: report.screenshots.length }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGKILL');
    await stopped;
  }
  report.ownedServerStopped = server.exitCode !== null || server.signalCode !== null;
  try { await fetch(origin, { signal: AbortSignal.timeout(500) }); } catch { report.portReleased = true; }
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
process.exit(report.errors.length ? 1 : 0);
