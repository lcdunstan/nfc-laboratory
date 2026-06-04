import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import os from 'os';

const APP_URL = 'http://localhost:5177';
const USER_DATA_DIR = path.join(os.homedir(), '.config', 'nfc-lab-web-test');

/*
  FIRST-TIME SETUP — authorize the Airspy for the test profile:

    AIRSPY_SETUP=1 npx playwright test airspy-perf.e2e.ts

  A browser window will open. Click "Connect Airspy", select your device
  from the chooser. The window auto-closes once authorized.
  Subsequent runs (without AIRSPY_SETUP) are headless.
*/

const isSetup = process.env.AIRSPY_SETUP === '1';

test.describe('Airspy WebUSB performance', () => {
  test('measure raw USB throughput for 5 seconds', async () => {
    test.setTimeout(120000);

    const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: !isSetup,
      args: ['--no-sandbox'],
    });

    const page = await browser.newPage();
    await page.goto(APP_URL + '/test/perf-test.html');
    await page.waitForFunction(
      () => typeof (window as any).runPerfTest === 'function',
      { timeout: 30000 },
    );

    const connectBtn = page.locator('#connect-btn');
    if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      if (isSetup) {
        console.log('Setup mode: click "Connect Airspy" in the browser and select your device.');
        await connectBtn.click();
        // Wait for the device to be authorized (page stores it globally)
        await page.waitForFunction(() => {
          // The page stores the device in _storedDevice after authorization
          const el = document.getElementById('status');
          return el && el.textContent && el.textContent.startsWith('Device authorized');
        }, { timeout: 60000 });
        console.log('Device authorized. Setup complete.');
        await browser.close();
        return; // Don't run the perf test during setup
      } else {
        await connectBtn.click();
        // Brief wait in case CDP permission grant helped
        await page.waitForTimeout(3000);
      }
    }

    if (isSetup) return;

    const result = await page.evaluate(async () => {
      return await (window as any).runPerfTest(5);
    });

    await browser.close();

    console.log('Performance test result:', result);

    if (result.error) {
      console.warn('SKIP — no Airspy device available:', result.error);
      console.warn(
        'Run setup:\n' +
        '  AIRSPY_SETUP=1 npx playwright test airspy-perf.e2e.ts\n' +
        'A browser window opens. Click "Connect Airspy" and select your device.\n' +
        'Then re-run without AIRSPY_SETUP.',
      );
      test.skip();
      return;
    }

    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.totalTransfers).toBeGreaterThan(0);
    expect(result.mbps).toBeGreaterThan(0);

    console.log(
      `Throughput: ${result.msps.toFixed(2)} MSps ` +
      `(${(result.bytesPerSec / 1024 / 1024).toFixed(1)} MiB/s, ${result.mbps.toFixed(1)} Mbps) ` +
      `peak=${result.peakMsps.toFixed(2)} MSps`,
    );
  });
});
