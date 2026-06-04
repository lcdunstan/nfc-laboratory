# nfc-rx-web: Browser-Based NFC Decoder with WebUSB

## Overview

Port `nfc-rx` (CLI SDR NFC decoder) to the browser using WebUSB for SDR access and the existing WASM-compilable C++ decoder library for NFC frame decoding. Model WebUSB device drivers on BrowSDR's existing Airspy implementation.

## Architecture

```
 Browser Tab (Chrome/Edge)
 ┌─────────────────────────────────────────────────────┐
 │          Main Thread (UI)                           │
 │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
 │  │Device    │ │Frequency │ │ Frame Log        │    │
 │  │Selector  │ │+Gain     │ │ (scrolling text) │    │
 │  └─────┬────┘ └─────┬────┘ └──────┬───────────┘    │
 └────────┼────────────┼─────────────┼────────────────┘
          │postMessage │             │
 ┌────────┴────────────┴─────────────┴────────────────┐
 │          Web Worker (Backend)                      │
 │                                                     │
 │  ┌─────────────────────┐  ┌────────────────────┐   │
 │  │  SdrDevice          │  │  IQ -> Magnitude   │   │
 │  │  (WebUSB impl)      │──>  (JS typed arrays)  │   │
 │  │  AirspyDevice       │  │                     │   │
 │  │  MockSdrDevice      │  └────────┬───────────┘   │
 │  └─────────────────────┘           │                │
 │                     ┌──────────────┴────────────┐  │
 │                     │  NfcDecoder (WASM)        │  │
 │                     │  via C-ABI bridge         │  │
 │                     └──────────────┬────────────┘  │
 │                     ┌──────────────┴────────────┐  │
 │                     │  Frame collection         │  │
 │                     │  + postMessage to UI      │  │
 │                     └───────────────────────────┘  │
 └────────────────────────────────────────────────────┘
```

## Directory Structure

```
nfc-laboratory/
  wav/                                        # Existing test data (19 WAV + 19 JSON)
  emscripten/
    CMakeLists.txt                            # Existing; add nfc-decoder-wasm target
    decoder-bridge.cpp                        # NEW: C-ABI wrapper around NfcDecoder
  src/nfc-app/app-rx-web/                     # NEW: web app root
    PLAN.md                                   # This file
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.ts                                 # Entry: create Backend worker, bind UI
      backend.ts                              # Worker orchestrator (device -> conversion -> decode -> output)
      decoder.ts                              # WASM NfcDecoder wrapper (JS side)
      wav-parser.ts                           # WAV RIFF parser (PCM int16 -> float)
      sdr-device.ts                           # SdrDevice interface + driver registry
      device-catalog.ts                       # USB VID/PID filter catalog for device picker
      app.ts                                  # UI logic (device picker, freq, gain, frame log)
      devices/
        airspy.ts                             # WebUSB Airspy driver (ported from BrowSDR)
      test/
        index.html                            # Minimal test page for Playwright
        synthetic-iq.ts                       # Synthetic IQ generator for Tier 2
        mock-sdr-device.ts                    # Mock SDR device for Tier 2
  tests/
    nfc-rx-web.e2e.ts                         # Playwright E2E test runner
```

## WASM Decoder Bridge

### New file: `emscripten/decoder-bridge.cpp`

A thin C-ABI wrapper around the existing `NfcDecoder`. No threading, no Subjects, no Event bus — just synchronous feed-and-poll:

```cpp
#include <lab/nfc/NfcDecoder.h>
#include <hw/SignalBuffer.h>
#include <hw/SignalType.h>

extern "C" {

struct DecoderState {
    lab::NfcDecoder decoder;
    hw::SignalBuffer buffer;
    unsigned int sampleRate;
    double streamTime;
};

DecoderState* decoder_create(unsigned int sampleRate);
void decoder_feed(DecoderState* state, const float* samples, int count);
int decoder_poll_frames(DecoderState* state, char* jsonOut, int maxLen);
void decoder_configure(DecoderState* state, const char* jsonConfig);
void decoder_destroy(DecoderState* state);

}
```

**Key design decisions:**
- No C++ exceptions across the boundary — wrap in try/catch, return error codes
- Frame output as JSON string — simplest serialization; nlohmann/json already produces the exact format the test infrastructure uses
- Single-threaded — caller must ensure sequential access (natural in the worker's event loop)

### Addition to `emscripten/CMakeLists.txt`

```cmake
add_library(nfc-decoder-wasm STATIC
    decoder-bridge.cpp
)
target_link_libraries(nfc-decoder-wasm lab-radio hw-core rt-lang lab-data nlohmann)
target_link_options(nfc-decoder-wasm PRIVATE
    -sALLOW_MEMORY_GROWTH
    -sEXPORTED_FUNCTIONS=_decoder_create,_decoder_feed,_decoder_poll_frames,_decoder_configure,_decoder_destroy
    -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,getValue,setValue
)
```

Build:
```bash
source ~/emsdk/emsdk_env.sh
cmake -S emscripten -B build-em -G "Unix Makefiles"
cmake --build build-em --target nfc-decoder-wasm
# Outputs: build-em/libnfc-decoder-wasm.a + .wasm + .js glue
```

## WebUSB Driver: Airspy (from BrowSDR)

File: `src/nfc-app/app-rx-web/src/devices/airspy.ts`

Direct copy of BrowSDR's `src/client/devices/airspy.ts` with minimal adjustments:

| Aspect | BrowSDR | nfc-rx-web |
|--------|---------|------------|
| SdrDevice interface | Same | Same (copy interface) |
| deviceType | `'airspy'` | `'airspy'` |
| sampleFormat | `'int16'` | `'int16'` |
| sampleRates | `[3e6, 6e6, 10e6]` | Default NFC: `[10000000]` |
| gainControls | LNA 0-14, Mixer 0-15, VGA 0-15, Bias-T | Same |
| Streaming | 4 parallel `transferIn` promises | Same |
| Sample conversion | 12-bit int16 right-shift by 4 | Same |
| USB VID/PID | `0x1d50:0x60a1` | Same |

The USB protocol implementation (vendor control transfers for tuning/gain/sample rate, bulk transfer for streaming) is identical — Airspy has a fixed command set regardless of platform.

## JavaScript -> WASM Pipeline

### `decoder.ts` — Decoder wrapper

```typescript
import type { NfcDecoderModule } from '../pkg/nfc-decoder-wasm';

export class NfcDecoder {
  private module: NfcDecoderModule;
  private ptr: number; // DecoderState*

  constructor(sampleRate: number) { /* Module._decoder_create(sampleRate) */ }
  feed(samples: Float32Array) { /* Module._decoder_feed(ptr, samples.byteOffset, samples.length) */ }
  pollFrames(): string { /* Module._decoder_poll_frames(ptr, buf, len) */ }
  destroy() { /* Module._decoder_destroy(ptr) */ }
}
```

### `backend.ts` — Worker orchestrator

```
Message flow:
  main thread -> worker: { type: 'start', freqHz, sampleRate }
  main thread -> worker: { type: 'stop' }
  worker -> main thread: { type: 'frame', json: '...' }
  worker -> main thread: { type: 'status', state: 'connected'|'error'|'disconnected' }
```

Pipeline for each USB transfer:
1. Receive raw int16 IQ pairs from `USBDevice.transferIn()`
2. Convert IQ -> magnitude: `mag[i] = sqrt(i*i + q*q)` for each IQ pair
3. Scale magnitude values to float range expected by decoder
4. Call `decoder.feed(mag)`
5. Call `decoder.pollFrames()` and post any decoded frames to main thread

## Tier 1 — Browser WAV Decode Test (Playwright)

**Goal**: Verify the WASM decoder + JS bridge produces identical results to the native `test-sdr` for all 19 WAV/JSON pairs — in a browser context.

### Test runner: `tests/nfc-rx-web.e2e.ts`

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('NFC WASM decoder in browser', () => {
  const wavDir = path.resolve(__dirname, '../wav');

  for (const wavFile of fs.readdirSync(wavDir).filter(f => f.endsWith('.wav'))) {
    test(`decodes ${wavFile} correctly`, async ({ page }) => {
      await page.goto('http://localhost:5173/src/nfc-app/app-rx-web/test/');
      const wavData = fs.readFileSync(path.join(wavDir, wavFile));
      const jsonRef = JSON.parse(
        fs.readFileSync(path.join(wavDir, wavFile.replace('.wav', '.json')), 'utf-8')
      );
      const result = await page.evaluate(async ([wavBuf, reference]) => {
        const frames = await window.runDecoder(wavBuf);
        return compareFrames(frames, reference.frames);
      }, [wavData.buffer, jsonRef]);
      expect(result.match).toBe(true);
    });
  }
});
```

### Test page: `src/nfc-app/app-rx-web/test/index.html`

A minimal HTML page that:
1. Loads `nfc-decoder-wasm.js` (Emscripten glue)
2. Exposes `window.runDecoder(wavArrayBuffer)` which:
   - Parses the WAV RIFF header (using `wav-parser.ts`)
   - Extracts int16 PCM samples, converts to float32: `float_val = int16_val / 32768.0f`
   - Creates `NfcDecoder` with sample rate from WAV header (10 MHz)
   - Feeds floats in chunks of 65536
   - Polls frames, collects them
   - Returns array of frame JSON objects
3. The Playwright test compares these against the reference JSON

### `wav-parser.ts`

Parses standard RIFF/WAVE: validates "RIFF"/"WAVE" headers, reads `fmt ` chunk for sample rate/channels/bit depth, locates `data` chunk, converts int16 PCM to Float32Array.

### What Tier 1 validates

| Component | Validated? |
|-----------|-----------|
| WASM decoder correctness | Yes — exact frame comparison vs reference |
| JS↔WASM memory passing | Yes — float arrays in, JSON strings out |
| WAV parsing | Yes — must match RecordDevice's int16->float logic |
| Frame JSON serialization | Yes — must match existing JSON format exactly |
| Browser WASM loading | Yes — Emscripten glue + WebAssembly instantiation |

### How to run

```bash
# Build WASM decoder
source ~/emsdk/emsdk_env.sh
cmake -S emscripten -B build-em -G "Unix Makefiles"
cmake --build build-em --target nfc-decoder-wasm

# Copy to test directory
cp build-em/nfc-decoder-wasm.{wasm,js} src/nfc-app/app-rx-web/test/pkg/

# Run Playwright tests
cd tests && npx playwright test nfc-rx-web.e2e.ts
```

---

## Tier 2 — Mock SDR Device Integration Test

**Goal**: Test the full pipeline from SdrDevice interface -> IQ->magnitude conversion -> WASM decoder, without requiring physical hardware.

### `mock-sdr-device.ts`

```typescript
export class MockSdrDevice implements SdrDevice {
  readonly deviceType = 'mock';
  readonly sampleRates = [10000000];
  readonly sampleFormat = 'int16' as const;
  readonly gainControls = [];

  private sampleData: Int16Array; // IQ interleaved pairs

  constructor(iqData: Int16Array) {
    this.sampleData = iqData;
  }

  async open(_device: USBDevice): Promise<void> {}
  async close(): Promise<void> {}
  async getInfo(): Promise<SdrDeviceInfo> {
    return { name: 'Mock SDR', serial: 'mock-001' };
  }
  async setSampleRate(rate: number): Promise<void> {}
  async setFrequency(freqHz: number): Promise<void> {}
  async setGain(name: string, value: number): Promise<void> {}

  async startRx(callback: (data: ArrayBufferView) => void): Promise<void> {
    const chunkSize = 32768;
    for (let i = 0; i < this.sampleData.length; i += chunkSize) {
      const chunk = this.sampleData.slice(i, i + chunkSize);
      callback(new Uint8Array(chunk.buffer));
    }
  }

  async stopRx(): Promise<void> {}
}
```

### Synthetic IQ from existing WAV magnitude data

Convert WAV magnitude envelopes to synthetic Airspy-format IQ pairs:

```typescript
function wavToMockIq(wavFloats: Float32Array, sampleRate: number): Int16Array {
  const fc = 13560000; // NFC carrier
  const iq = new Int16Array(wavFloats.length * 2);
  for (let t = 0; t < wavFloats.length; t++) {
    const phase = 2 * Math.PI * fc * t / sampleRate;
    const mag = wavFloats[t];
    iq[t * 2]     = Math.round(mag * Math.cos(phase) * 2047);
    iq[t * 2 + 1] = Math.round(mag * Math.sin(phase) * 2047);
  }
  return iq;
}
```

### Tier 2 test flow

1. Load WAV file, parse to float magnitude samples
2. Convert magnitude -> synthetic IQ pairs (13.56 MHz carrier AM-modulated)
3. Create `MockSdrDevice` with the synthetic IQ
4. Run through the same pipeline as the real WebUSB Airspy:
   - `startRx()` feeds int16 IQ in chunks
   - Each chunk: IQ int16 -> magnitude float (same conversion as AirspyDevice)
   - Feed magnitude to `NfcDecoder`
   - Poll frames
5. Compare decoded frames against reference JSON

### What Tier 2 additionally validates (beyond Tier 1)

| Component | Validated? |
|-----------|-----------|
| IQ->magnitude conversion | Yes — int16 IQ pairs -> sqrt(I^2+Q^2) |
| Airspy 12-bit scaling | Yes — right-shift by 4 to match Airspy format |
| Chunked streaming | Yes — data flows through startRx callback like real USB |
| SdrDevice interface | Yes — Mock implements same interface as AirspyDevice |
| End-to-end pipeline | Yes — no mocked-out steps in the signal path |

---

## Vite Configuration

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['nfc-decoder-wasm'],
  },
  worker: {
    format: 'es',
  },
});
```

COOP/COEP headers are required because WebUSB needs cross-origin isolation when SharedArrayBuffer is used (needed if IQ->magnitude runs in a WASM helper, or for precise timing).

---

## Implementation Order

| Step | What | Dependencies |
|------|------|-------------|
| 1 | `emscripten/decoder-bridge.cpp` — C-ABI wrapper | Existing lab-radio, hw-core, rt-lang |
| 2 | `emscripten/CMakeLists.txt` — add nfc-decoder-wasm target | Step 1 |
| 3 | Build and verify WASM decoder in Node.js | Step 2 |
| 4 | `package.json`, `vite.config.ts`, `tsconfig.json` | — |
| 5 | `wav-parser.ts` — WAV RIFF parser | — |
| 6 | `decoder.ts` — WASM decoder wrapper | Step 3 |
| 7 | `test/index.html` + `browser-test.spec.ts` — Tier 1 Playwright test | Steps 4-6 |
| 8 | `sdr-device.ts` + `device-catalog.ts` — SDR interface | BrowSDR pattern |
| 9 | `devices/airspy.ts` — WebUSB Airspy driver | Step 8, BrowSDR code |
| 10 | `backend.ts` — Worker orchestrator | Steps 6, 9 |
| 11 | `main.ts` + `app.ts` — UI (device picker, freq, gain, frame log) | Step 10 |
| 12 | `mock-sdr-device.ts` — Mock SDR | Step 8 |
| 13 | `synthetic-iq.ts` — WAV->IQ converter | Steps 5, 12 |
| 14 | `tier2-test.spec.ts` — Tier 2 Playwright test | Steps 7, 12, 13 |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| WASM decoder needs sample rate per buffer; test files are 10 MHz but Airspy may use other rates | `decoder_create(sampleRate)` stores it; `decoder_feed()` creates SignalBuffer with that rate. Re-init on rate change (already handled by NfcDecoder::Impl::initialize()) |
| WAV files are magnitude, not IQ — synthetic IQ from WAV may not exactly match real Airspy output | Compare frameData and techType/frameType only (not exact sample positions). Accept minor frame timing differences |
| Airspy Mini minimum frequency ~24 MHz, NFC is 13.56 MHz | Tune to 40.68 MHz (3rd harmonic) and rely on Airspy's mixing. Decoder only needs baseband magnitude — LO frequency is irrelevant |
| COOP/COEP breaks CDN resources | Self-host all JS; no third-party scripts required |
| Emscripten memory growth adds latency | -sALLOW_MEMORY_GROWTH is already used; decoder allocates upfront (1024-sample ring buffer). Growth unlikely during normal operation |
