// Browser end-to-end check with a fake camera playing a synthetic curled-page scene.
// Usage: npm run build && node scripts/e2e.mjs   (needs Playwright + Chromium)
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(resolve(execSync('npm root -g').toString().trim(), 'playwright')); }

const out = resolve('test/out');
mkdirSync(out, { recursive: true });
const video = resolve(out, 'scene.y4m');
if (!existsSync(video)) throw new Error('Run: GEN_E2E=1 npx vitest run test/e2e-assets.test.ts');

const server = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => { server.stdout.on('data', (d) => { if (String(d).includes('4179')) r(); }); setTimeout(r, 8000); });

const browser = await pw.chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
});
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true, permissions: ['camera'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (name) => page.screenshot({ path: resolve(out, `e2e-${name}.png`) });
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(`✓ ${name} (${Date.now() - t} ms)`); };

try {
  await step('setup screen', async () => {
    await page.goto('http://localhost:4179/');
    await page.getByText('Start scanning').waitFor();
    await page.waitForTimeout(700);
    await shot('1-setup');
  });
  await step('sheet screen + PDF', async () => {
    await page.goto('http://localhost:4179/#/sheet');
    await page.getByRole('radio', { name: 'A4' }).first().waitFor();
    const dl = page.waitForEvent('download', { timeout: 60000 });
    await page.getByText('Download PDF').click();
    const d = await dl;
    await d.saveAs(resolve(out, 'e2e-sheet.pdf'));
    await shot('2-sheet');
  });
  await step('capture: live detection', async () => {
    await page.goto('http://localhost:4179/#/capture');
    await page.getByText('Sheet detected').waitFor({ timeout: 90000 });
    await page.waitForTimeout(500);
    await shot('3-capture');
  });
  await step('capture: shoot + background processing', async () => {
    await page.getByRole('button', { name: 'Capture page' }).click();
    await page.waitForTimeout(400);
    await shot('4-capturing');
    await page.getByText(/Processing page 1/).waitFor({ timeout: 20000 }).catch(() => undefined);
    await page.waitForFunction(() => !document.querySelector('.bgnote')?.textContent?.includes('Processing'), null, { timeout: 120000 });
    await shot('5-captured');
  });
  await step('batch + review', async () => {
    await page.getByRole('button', { name: 'Review batch' }).click();
    await page.getByText('Page 1').first().waitFor();
    await shot('6-batch');
    console.log('   batch meta:', await page.locator('.pages .meta span').first().textContent());
    await page.getByRole('button', { name: 'Open page 1' }).click();
    await page.getByText(/Full resolution/).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
    await shot('7-review');
    console.log('   size:', await page.locator('.measure .size').textContent(), '|', await page.locator('.measure .mono').textContent());
    await page.getByRole('radio', { name: 'Grey' }).click();
    await page.waitForTimeout(800);
    await shot('8-review-grey');
    await page.getByRole('button', { name: 'Edges' }).click();
    await page.getByText('Drag the corners').waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    await shot('9-edges');
    await page.getByRole('button', { name: 'Flat' }).click();
    await page.getByRole('radio', { name: 'B&W' }).click();
    await page.getByText('Keep page').click();
  });
  await step('export PDF', async () => {
    await page.getByText(/Export 1 page/).waitFor();
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await page.getByText(/Export 1 page/).click();
    const d = await dl;
    await d.saveAs(resolve(out, 'e2e-scan.pdf'));
    await shot('10-exported');
  });
  await step('import photo from file', async () => {
    await page.goto('http://localhost:4179/#/capture');
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(resolve(out, 'scene.jpg'));
    await page.waitForFunction(() => !document.querySelector('.bgnote')?.textContent?.includes('Processing') && document.querySelector('.tray .count')?.textContent === '2', null, { timeout: 120000 });
    await shot('11-imported');
  });
} catch (e) {
  console.error('✗', e.message);
  await shot('error');
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(out, 'e2e-console.log'), logs.join('\n'));
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  if (errs.length) console.log('console errors:\n' + errs.slice(0, 10).join('\n'));
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
  process.exit(process.exitCode ?? 0);
}
