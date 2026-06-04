import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wavDir = path.resolve(__dirname, '../wav');

test.describe('IQ magnitude conversion', () => {
  const APP_URL = 'http://localhost:5177';

  test('C++ and JS conversions produce identical results', async ({ page }) => {
    await page.goto(APP_URL);

    const results = await page.evaluate(async () => {
      const { runConversionTests, testVectors } = await import('/src/test/iq-conversion.ts');
      const passed: string[] = [];
      const failed: string[] = [];

      for (const r of runConversionTests()) {
        if (r.ok) passed.push(r.name);
        else failed.push(`${r.name}: ${r.detail}`);
      }

      return { passed, failed, total: testVectors.length };
    });

    console.log(`IQ conversion: ${results.passed.length}/${results.total} passed`);
    if (results.failed.length > 0) {
      for (const f of results.failed) console.log(`  FAIL: ${f}`);
    }

    expect(results.failed.length).toBe(0);
  });

  test('IqConverter unit tests pass', async ({ page }) => {
    await page.goto(APP_URL);

    const results = await page.evaluate(async () => {
      const { runConverterTests } = await import('/src/test/iq-conversion.ts');
      const passed: string[] = [];
      const failed: string[] = [];

      for (const r of runConverterTests()) {
        if (r.ok) passed.push(r.name);
        else failed.push(`${r.name}: ${r.detail}`);
      }

      return { passed, failed, total: passed.length + failed.length };
    });

    console.log(`IqConverter: ${results.passed.length}/${results.total} passed`);
    if (results.failed.length > 0) {
      for (const f of results.failed) console.log(`  FAIL: ${f}`);
    }

    expect(results.failed.length).toBe(0);
  });
});

const APP_URL = 'http://localhost:5177';

function compareFrameArrays(decoded: any[], reference: any[]): { match: boolean; total: number; mismatches: string[] } {
  const mismatches: string[] = [];
  const maxCheck = Math.min(decoded.length, reference.length);

  for (let i = 0; i < maxCheck; i++) {
    const d = decoded[i];
    const r = reference[i];

    if (d.techType !== r.techType) mismatches.push(`[${i}] techType: ${d.techType} != ${r.techType}`);
    if (d.frameType !== r.frameType) mismatches.push(`[${i}] frameType: ${d.frameType} != ${r.frameType}`);
    if (d.frameRate !== r.frameRate) mismatches.push(`[${i}] frameRate: ${d.frameRate} != ${r.frameRate}`);
    if (d.frameData !== r.frameData) mismatches.push(`[${i}] frameData: ${d.frameData} != ${r.frameData}`);
    if (d.frameFlags !== r.frameFlags) mismatches.push(`[${i}] frameFlags: ${d.frameFlags} != ${r.frameFlags}`);
    if (d.framePhase !== r.framePhase) mismatches.push(`[${i}] framePhase: ${d.framePhase} != ${r.framePhase}`);
  }

  if (decoded.length !== reference.length) {
    mismatches.push(`Frame count: ${decoded.length} decoded vs ${reference.length} expected`);
  }

  return { match: mismatches.length === 0, total: maxCheck, mismatches };
}

test.describe('App UI controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('all static controls exist with correct defaults', async ({ page }) => {
    // Frequency input
    const freq = page.locator('#freq');
    await expect(freq).toBeVisible();
    await expect(freq).toHaveValue('133560000');

    // Sample rate select
    const rate = page.locator('#sample-rate');
    await expect(rate).toBeVisible();
    await expect(rate).toHaveValue('10000000');
    const rateOptions = await rate.locator('option').all();
    expect(rateOptions.length).toBe(3);

    // Bias Tee checkbox (checked by default)
    const biasTee = page.locator('#bias-tee');
    await expect(biasTee).toBeVisible();
    await expect(biasTee).toBeChecked();

    // Gain mode dropdown (pre-populated with Airspy defaults)
    const gainMode = page.locator('#gain-mode');
    await expect(gainMode).toBeVisible();
    await expect(gainMode.locator('option')).toHaveText(['Auto', 'Linearity', 'Sensitivity']);

    // Gain controls container (pre-populated with Airspy defaults)
    const gainControls = page.locator('#gain-controls');
    await expect(gainControls).toHaveCount(1);
    await expect(gainControls.locator('input[type="range"]')).toHaveCount(3);

    // Start/Stop buttons
    const start = page.locator('#btn-start');
    const stop = page.locator('#btn-stop');
    await expect(start).toBeVisible();
    await expect(start).toBeEnabled();
    await expect(stop).toBeVisible();
    await expect(stop).toBeDisabled();

    // Status bar
    const status = page.locator('#status');
    await expect(status).toBeVisible();
    await expect(status).not.toBeEmpty();

    // Frame log
    const frameLog = page.locator('#frame-log');
    await expect(frameLog).toBeVisible();
    await expect(frameLog).toBeEmpty();

    // Device selector
    const deviceSelect = page.locator('#device-select');
    await expect(deviceSelect).toBeVisible();
  });

  test('start/stop buttons have correct initial state', async ({ page }) => {
    const start = page.locator('#btn-start');
    const stop = page.locator('#btn-stop');
    await expect(start).toBeEnabled();
    await expect(stop).toBeDisabled();
  });

  test('sample rate options are selectable', async ({ page }) => {
    const rate = page.locator('#sample-rate');

    await rate.selectOption('6000000');
    await expect(rate).toHaveValue('6000000');

    await rate.selectOption('3000000');
    await expect(rate).toHaveValue('3000000');

    await rate.selectOption('10000000');
    await expect(rate).toHaveValue('10000000');
  });

  test('frequency input accepts valid values', async ({ page }) => {
    const freq = page.locator('#freq');

    await freq.fill('');
    await freq.type('13560000');
    await expect(freq).toHaveValue('13560000');

    await freq.fill('27120000');
    await expect(freq).toHaveValue('27120000');
  });

  test('bias tee checkbox toggles (starts checked)', async ({ page }) => {
    const biasTee = page.locator('#bias-tee');

    await expect(biasTee).toBeChecked();
    await biasTee.uncheck();
    await expect(biasTee).not.toBeChecked();
    await biasTee.check();
    await expect(biasTee).toBeChecked();
  });

  test('gain mode dropdown is populated dynamically via App.populateGainMode', async ({ page }) => {
    // Verify the gain-modes exported from airspy match expectations
    const modeData = await page.evaluate(async () => {
      const { AirspyDevice } = await import('/src/devices/airspy.ts');
      const dev = new AirspyDevice();
      return dev.gainModes;
    });

    expect(modeData).toEqual([
      { value: 0, name: 'Auto' },
      { value: 1, name: 'Linearity' },
      { value: 2, name: 'Sensitivity' },
    ]);
  });

  test('gain controls metadata matches Airspy device spec', async ({ page }) => {
    const ctrlData = await page.evaluate(async () => {
      const { AirspyDevice } = await import('/src/devices/airspy.ts');
      const dev = new AirspyDevice();
      return dev.gainControls.map(g => ({ name: g.name, min: g.min, max: g.max, step: g.step, defaultValue: g.defaultValue }));
    });

    expect(ctrlData).toEqual([
      { name: 'LNA', min: 0, max: 14, step: 1, defaultValue: 6 },
      { name: 'Mixer', min: 0, max: 15, step: 1, defaultValue: 6 },
      { name: 'VGA', min: 0, max: 15, step: 1, defaultValue: 6 },
    ]);
  });
});

test.describe('NFC WASM decoder in browser', () => {
  for (const wavFile of fs.readdirSync(wavDir).filter((f: string) => f.endsWith('.wav'))) {
    test(`decodes ${wavFile} correctly`, async ({ page }) => {
      test.setTimeout(60000);

      await page.goto(`${APP_URL}/test/index.html`);
      await page.waitForFunction(() => (window as any).runDecoder !== undefined, { timeout: 30000 });

      const wavPath = path.join(wavDir, wavFile);
      const jsonPath = path.join(wavDir, wavFile.replace('.wav', '.json'));
      const wavBuffer = fs.readFileSync(wavPath);
      const jsonRef = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

      const result = await page.evaluate(
        async ([wavBuf, reference]) => {
          const frames = await (window as any).runDecoder(wavBuf);
          const mismatches: string[] = [];
          const maxCheck = Math.min(frames.length, reference.frames.length);

          for (let i = 0; i < maxCheck; i++) {
            const d = frames[i];
            const r = reference.frames[i];

            if (d.techType !== r.techType) mismatches.push(`[${i}] techType`);
            if (d.frameType !== r.frameType) mismatches.push(`[${i}] frameType`);
            if (d.frameRate !== r.frameRate) mismatches.push(`[${i}] frameRate`);
            if (d.frameData !== r.frameData) mismatches.push(`[${i}] frameData`);
          }

          if (frames.length !== reference.frames.length) {
            mismatches.push(`count: ${frames.length} vs ${reference.frames.length}`);
          }

          return { match: mismatches.length === 0, mismatches };
        },
        [new Uint8Array(wavBuffer), jsonRef]
      );

      if (!result.match) {
        console.log(`Mismatches for ${wavFile}:`, result.mismatches);
      }

      expect(result.match).toBe(true);
    });
  }
});
