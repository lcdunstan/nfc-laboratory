import { iqToMagnitude } from '../iq-to-magnitude';
import { IqConverter } from '../iq-converter';

const EPSILON = 1e-4;

export interface ConversionVector {
  name: string;
  iq: number[];
  mag: number[];
}

export const testVectors: ConversionVector[] = [
  { name: 'dc_zero',    iq: [2048, 2048, 2048, 2048], mag: [0.0, 0.0] },
  { name: 'max_iq',     iq: [4095, 4095],             mag: [1.4135] },
  { name: 'min_iq',     iq: [0, 0],                   mag: [1.4142] },
  { name: 'i_only_pos', iq: [4095, 2048],             mag: [0.9995] },
  { name: 'i_only_neg', iq: [0, 2048],                mag: [1.0] },
  { name: 'q_only_pos', iq: [2048, 4095],             mag: [0.9995] },
  { name: 'mid_range',  iq: [3072, 3072],             mag: [0.7071] },
  { name: 'mixed',      iq: [3072, 2048, 2048, 1024], mag: [0.5, 0.5] },
  { name: 'alternating', iq: [4095, 0, 0, 4095, 2048, 2048, 1024, 3072], mag: [1.4139, 1.4139, 0.0, 0.7071] },
];

export function runConversionTests(): { name: string; ok: boolean; detail?: string }[] {
  const results: { name: string; ok: boolean; detail?: string }[] = [];

  for (const tv of testVectors) {
    const result = iqToMagnitude(new Int16Array(tv.iq));
    let ok = true;
    let detail: string | undefined;

    for (let i = 0; i < tv.mag.length; i++) {
      const diff = Math.abs(result[i] - tv.mag[i]);
      if (diff > EPSILON) {
        ok = false;
        detail = `[${i}] got ${result[i]}, expected ${tv.mag[i]} (diff ${diff})`;
        break;
      }
    }

    results.push({ name: tv.name, ok, detail });
  }

  return results;
}

export function runConverterTests(): { name: string; ok: boolean; detail?: string }[] {
  const results: { name: string; ok: boolean; detail?: string }[] = [];

  // Test 1: DC removal — constant value converges to near zero
  {
    const cnv = new IqConverter();
    const len = 1024;
    const f32 = new Float32Array(len);
    f32.fill(1.0);
    cnv.process(f32);
    let maxVal = 0;
    for (let i = f32.length - 64; i < f32.length; i++) {
      if (Math.abs(f32[i]) > maxVal) maxVal = Math.abs(f32[i]);
    }
    const ok = maxVal < 0.02;
    results.push({
      name: 'dc_removal',
      ok,
      detail: ok ? undefined : `max trailing value ${maxVal} >= 0.02`,
    });
  }

  // Test 2: DC via all-2048 (zero after int16→float) stays zero
  {
    const cnv = new IqConverter();
    const len = 256;
    const f32 = new Float32Array(len);
    f32.fill(0.0);
    cnv.process(f32);
    let maxVal = 0;
    for (const v of f32) {
      if (Math.abs(v) > maxVal) maxVal = Math.abs(v);
    }
    const ok = maxVal < 1e-6;
    results.push({
      name: 'dc_zero_input',
      ok,
      detail: ok ? undefined : `max value ${maxVal} >= 1e-6`,
    });
  }

  // Test 3: process rejects non-multiple-of-4 lengths
  {
    const cnv = new IqConverter();
    const f32 = new Float32Array(6);
    let threw = false;
    try {
      cnv.process(f32);
    } catch {
      threw = true;
    }
    results.push({ name: 'bad_length_throws', ok: threw });
  }

  // Test 4: Full pipeline (converter → decimate ×2 → magnitude) produces finite output
  {
    const cnv = new IqConverter();
    const len = 64;
    const f32 = new Float32Array(len);
    for (let i = 0; i < len; i += 4) {
      f32[i] = 1.0;     // I₀
      f32[i + 1] = 0.0; // Q₀
      f32[i + 2] = -1.0; // I₁
      f32[i + 3] = 0.0; // Q₁
    }
    cnv.process(f32);
    const halfLen = f32.length / 2;
    const half = new Float32Array(halfLen);
    for (let i = 0, j = 0; i < f32.length; i += 4, j += 2) {
      half[j] = f32[i];
      half[j + 1] = f32[i + 1];
    }
    const mag = new Float32Array(half.length / 2);
    for (let i = 0; i < mag.length; i++) {
      const ii = half[i * 2];
      const qq = half[i * 2 + 1];
      mag[i] = Math.sqrt(ii * ii + qq * qq);
    }
    let allFinite = true;
    for (let i = 0; i < mag.length; i++) {
      if (!isFinite(mag[i])) { allFinite = false; break; }
    }
    results.push({ name: 'pipeline_finite_output', ok: allFinite, detail: allFinite ? undefined : 'non-finite magnitude' });
  }

  // Test 5: Reset clears internal state
  {
    const cnv = new IqConverter();
    const f32 = new Float32Array(8);
    f32.fill(1.0);
    cnv.process(f32);
    cnv.reset();
    const f32b = new Float32Array(8);
    f32b.fill(0.0);
    cnv.process(f32b);
    let maxVal = 0;
    for (const v of f32b) {
      if (Math.abs(v) > maxVal) maxVal = Math.abs(v);
    }
    const ok = maxVal < 1e-6;
    results.push({
      name: 'reset_clears_state',
      ok,
      detail: ok ? undefined : `after reset+zero: max ${maxVal}`,
    });
  }

  return results;
}
