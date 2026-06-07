# nfc-laboratory — agent guide

## Build

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
```

Optional: `-DENABLE_GRPC_API=ON` for gRPC remote control, `-DFLATPAK_BUILD=ON` for Flatpak.

Dependencies (Debian/Ubuntu): `qt6-base-dev libusb-1.0-0-dev zlib1g-dev libgl1-mesa-dev` + optionally `libairspy-dev libhydrasdr-dev librtlsdr-dev`.

## Tests (standalone executables, not CTest)

```bash
cd build/src/nfc-test
./test-sdr/test-sdr ../../wav/      # 19 WAV → reference JSON comparison
./test-parser/test-parser ../../wav/ # JSON protocol frame parsing
./test-dio/test-dio                  # requires DreamSourceLab DSLogic hw
```

Test data is in `wav/` (`*.wav` + `*.json`). First run of `test-sdr` creates reference JSON if absent.

## WASM build (Emscripten)

Builds the hardware-independent subset (no libusb/SDR/Qt):

```bash
source ~/emsdk/emsdk_env.sh
cmake -S emscripten -B build-em -G "Unix Makefiles"
cmake --build build-em -j$(nproc)
```

## WASM test (test-sdr equivalent)

```bash
source ~/emsdk/emsdk_env.sh
cmake -S emscripten -B build-em -G "Unix Makefiles"
cmake --build build-em -j$(nproc) --target test-sdr-wasm
cd build-em && node test-sdr-wasm.js
```

Or via CTest:

```bash
source ~/emsdk/emsdk_env.sh
cmake -S emscripten -B build-em -G "Unix Makefiles"
cmake --build build-em -j$(nproc)
ctest --test-dir build-em -V
```

Runs all 19 WAV → reference JSON comparisons (same logic as native `test-sdr`). WAV/JSON test data is preloaded into Emscripten's virtual filesystem via `--preload-file`. All libraries (`lab-radio`, `hw-core`, `rt-lang`, `nlohmann/json`) already compile for WASM; no hardware (libusb/SDR) dependencies needed.

Outputs: `lib{hw-core,lab-data,lab-radio,lab-logic,lab-tasks,rt-lang,microtar,mufft,ed25519}.a`
`RadioDeviceTask.cpp` and `LogicDeviceTask.cpp` are excluded on WASM (require libusb).

## nfc-decoder-wasm (C-ABI bridge for browser)

Builds a modularized `.wasm` + `.js` glue exporting `decoder_create`, `decoder_feed`, `decoder_poll_frames`, `decoder_configure`, `decoder_destroy`:

```bash
source ~/emsdk/emsdk_env.sh
cmake -S emscripten -B build-em -G "Unix Makefiles"
cmake --build build-em --target nfc-decoder-wasm-bin -j$(nproc)
# Output: build-em/nfc-decoder-wasm-bin.{js,wasm}
```

Test in Node.js:
```bash
source ~/emsdk/emsdk_env.sh
node -e "
const mod = require('./build-em/nfc-decoder-wasm-bin.js');
mod().then(m => {
  const ptr = m._decoder_create(10000000);
  console.log('create:', ptr ? 'OK' : 'FAIL');
  m._decoder_destroy(ptr);
});
"
```

## nfc-rx-web (browser app)

The web app lives at `src/nfc-app/app-rx-web/`. To use it:

1. Build the WASM binary (above) and copy it next to the Vite app:
   ```bash
   cp build-em/nfc-decoder-wasm-bin.{js,wasm} src/nfc-app/app-rx-web/pkg/
   ```
   `pkg/` is what the Vite dev server and `index.html`'s `<script src="./pkg/...">` reference. For Playwright tests, also copy to `test/pkg/` (see below).

2. Install JS deps and start dev server:
   ```bash
   cd src/nfc-app/app-rx-web
   npm install
   npx vite
   ```

3. Open `http://localhost:5173` in a browser with WebUSB support (Chrome/Edge).

   **Frequency**: With an Airspy + Spyverter (120 MHz upconverter), tune to **133.56 MHz** (13.56 MHz + 120 MHz). Without a Spyverter, use 40.68 MHz (3rd harmonic of 13.56 MHz). The default in `index.html` is 133.56 MHz.

### WASM asset path gotcha (production)

`index.html` and `src/backend.ts` both reference the WASM via **relative** paths:

- `index.html`: `<script src="./pkg/nfc-decoder-wasm-bin.js">`
- `backend.ts`: `locateFile: (path) => './pkg/' + path` (called from `startRx` and `feedWav`)

Both must stay relative (no leading `/`). An absolute `/pkg/...` would resolve to the **host root** when served from a project site like `lcdunstan.github.io/nfc-laboratory/`, giving a 404. The `Vite` base is also set command-dependent (`/nfc-laboratory/` for `build`, `/` for `serve`) so dev stays at root.

## GitHub Actions: WASM build + Pages deploy

Workflow: `.github/workflows/wasm-app-build.yml`. Three jobs in sequence:

1. `build-wasm` — Emscripten build of `nfc-decoder-wasm-bin` + runs `node test-sdr-wasm.js`.
2. `build-web` — downloads the WASM artifact into `src/nfc-app/app-rx-web/pkg/`, runs `npm ci && npm run build`, copies `pkg/nfc-decoder-wasm-bin.{js,wasm}` into `dist/pkg/`, uploads `dist/` as the `nfc-rx-web` artifact.
3. `deploy` — downloads the `nfc-rx-web` artifact into `./webapp/`, then `configure-pages` + `upload-pages-artifact` + `deploy-pages`.

### Triggers

- `push` to `master` or `develop` → build-wasm + build-web (smoke test, no deploy).
- `workflow_dispatch` → all three jobs (build + deploy).

There is **no tag trigger** (deliberate — it would also fire `cmake-build.yml`'s multiplatform release job on any tag, which fails on test tags). Deploy is opt-in via `gh workflow run`.

### Deploying

From a clone with `gh` authenticated:

```bash
gh workflow run wasm-app-build.yml            # uses default branch
gh workflow run wasm-app-build.yml --ref wasm # or any branch
```

Live site: `https://lcdunstan.github.io/nfc-laboratory/`.

### One-time setup (already done for this repo)

1. Repo Settings → Pages → Source: **GitHub Actions**. (GITHUB_TOKEN can't create the Pages site itself; it has to exist first.)
2. Settings → Environments → `github-pages` → Deployment branches and tags → add `master` and `wasm` (or `*`). The env protection rule rejects deploys from refs not on the allowlist.

### Gotchas baked into the workflow

- `actions/configure-pages@v5` is still on Node 20 (no v6 yet). The deploy job sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true` to silence the deprecation warning and prepare for the June 16, 2026 default switch.
- `actions/upload-artifact@v4+` (and v5/v6/v7) flatten the uploaded path — the directory prefix is stripped. So the `nfc-rx-web` artifact contains `index.html`, `assets/...`, `pkg/...` at its root, **not** at `src/nfc-app/app-rx-web/dist/...`. The deploy job downloads into `./webapp/` and feeds that path to `upload-pages-artifact` (don't reuse `src/nfc-app/app-rx-web/dist`).
- Each job starts on a fresh runner. The deploy job explicitly `actions/checkout@v6` + `actions/download-artifact@v8` to populate the workspace; without those, `dist/` is missing.

## Playwright E2E tests (Tier 1)

```bash
source ~/emsdk/emsdk_env.sh
cmake -S emscripten -B build-em -G "Unix Makefiles"
cmake --build build-em --target nfc-decoder-wasm-bin -j$(nproc)
cp build-em/nfc-decoder-wasm-bin.{js,wasm} src/nfc-app/app-rx-web/test/pkg/
cd tests && npm install && npx playwright test nfc-rx-web.e2e.ts
```

Requires: Vite dev server automatically started by Playwright's `webServer` config.

## Airspy WebUSB perf test (requires hardware)

Measures raw USB bulk throughput from an Airspy via WebUSB in a headless browser.

**Pre-authorization** (one-time): 
```bash
AIRSPY_SETUP=1 npx playwright test airspy-perf.e2e.ts
```
A browser window opens. Click "Connect Airspy", select your device. After that, subsequent runs use the same persistent profile.

```bash
cd tests && npx playwright test airspy-perf.e2e.ts
```

Throughput: **~9.7 MSps (36.9 MiB/s, 310 Mbps)** peak 10.02 MSps for Airspy Mini at 10 MSps int16 IQ.

### Pump design (airspy.ts:runPump)

The pump uses **depth-8** `.then()` chaining instead of a shallow `await`-in-loop pipeline. Each completed transfer immediately re-seeds itself via `.then()`, keeping the USB bus fully saturated. This was the key to going from 5.8 → 9.7 MSps:

- **Depth 3, `await`-in-loop**: 5.81 MSps (pipeline runs dry ~40% of the time)
- **Depth 8, `.then()` chaining**: 9.68 MSps (97% of 10 MSps)

### Sample rate (airspy.ts:setSampleRate)

Uses the kHz fallback path (`rate × 2 / 1000` for IQ) for all rates instead of passing a firmware index. The index method would require per-model knowledge (Mini vs R2) since their `supported_samplerates` arrays differ:

- Mini: `[6000000, 3000000]` — index 0 = 6M, index 1 = 3M
- R2: `[10000000, 2500000]` — index 0 = 10M, index 1 = 2.5M

The kHz method (`wIdx=20000` for 10M) matches native libairspy's behavior for unsupported rates and works universally.

### Packing

Sample packing (`AIRSPY_SET_PACKING`, cmd 26) is **disabled** (wIndex=0, matching native libairspy). Testing showed packing helps with shallow pipelines (3 → 7.26 MSps) but hurts with depth-8 (9.68 → 7.26 MSps), likely due to added firmware-side batching latency.

## Architecture

```
src/
  nfc-app/
    app-qt/   → nfc-lab  (Qt6 GUI, primary app)
    app-rx/   → nfc-rx   (CLI SDR receiver)
    app-rx-web/ → nfc-rx-web (browser WebUSB SDR receiver)
  nfc-lib/
    lib-rt/   → runtime: Logger, Executor, Subject, Event, FileSystem
    lib-hw/   → hw abstraction: hw-core (platform-independent types),
                 hw-dev (USB), hw-logic (DSLogic), hw-radio (SDR)
    lib-lab/  → lab logic: lab-data, lab-logic, lab-radio, lab-tasks
    lib-ext/  → vendored: nlohmann/json, airspy, hydrasdr, rtlsdr, ed25519, etc.
  nfc-test/   → test tools (test-sdr, test-parser, test-dio, test-rpc)
```

Key dependency boundary: `hw-core` is the hardware-independent layer (SignalBuffer, RecordDevice, DeviceFactory — no libusb).
`lab-data`, `lab-radio`, `lab-logic` link `hw-core` directly (not `hw-dev`). `lab-tasks` links `hw-core` + conditionally `hw-radio`/`hw-logic`.

## Native Airspy USB command sequence (from usbmon pcap)

`nfc-rx-airspy.pcapng` captures the native `nfc-rx` talking to Airspy Mini (1d50:60a1). Extract with:

```bash
tshark -r nfc-rx-airspy.pcapng -T json | python3 -c "
import json, sys
data = json.load(sys.stdin)
...
"
```

Five phases (vendor requests only, device addr 5):

### Phase 1 — `airspy_open` (t=2.197s)
```
PARTID_SERIALNO_READ (25)  wIdx=0       # part ID
PARTID_SERIALNO_READ (25)  wIdx=2       # serial no
SET_PACKING         (26)  wIdx=0       # disable packing
BOARD_ID_READ       (10)  wIdx=0
VERSION_READ        (11)  wIdx=0
```

### Phase 2 — `open()` initial config (t=2.200s)
```
SET_FREQ        (13)  OUT, data=4B LE     # 40.68 MHz (3rd harmonic)
SET_SAMPLERATE  (12)  IN,  wIdx=20000     # see samplerate logic below
SET_LNA_AGC     (17)  wIdx=0              # OFF
SET_MIXER_AGC   (18)  wIdx=0              # OFF
GPIO_WRITE      (21)  wVal=0  wIdx=45     # bias tee OFF
```

### Phase 3 — user settings applied (t=2.552s, 352ms later)
```
SET_FREQ        (13)  OUT, data=4B LE     # 133.56 MHz (with Spyverter)
GPIO_WRITE      (21)  wVal=1  wIdx=45     # bias tee ON
SET_MIXER_AGC   (18)  wIdx=0              # OFF
SET_LNA_AGC     (17)  wIdx=0              # OFF
SET_VGA_GAIN    (16)  wIdx=10
SET_MIXER_GAIN  (15)  wIdx=2
SET_LNA_GAIN    (14)  wIdx=0
```

### Phase 4 — `airspy_start_rx` (t=3.056s, 504ms later)
```
RECEIVER_MODE   (1)   wVal=0             # OFF (reset state)
RECEIVER_MODE   (1)   wVal=1             # RX  (start streaming)
```

### Phase 5 — stop (t=7.245s)
```
RECEIVER_MODE   (1)   wVal=0             # OFF
GPIO_WRITE      (21)  wVal=0  wIdx=45    # bias tee OFF
RECEIVER_MODE   (1)   wVal=0             # OFF
```

### Samplerate logic (airspy.c:1050)
```c
if (samplerate >= MIN_SAMPLERATE_BY_VALUE /* 1000000 */) {
    for (i = 0; i < device->supported_samplerate_count; i++)
        if (samplerate == device->supported_samplerates[i])
            { samplerate = i; break; }       // Hz → index
    if (samplerate >= MIN_SAMPLERATE_BY_VALUE) {
        if (SAMPLE_TYPE_IS_IQ(device->sample_type))
            samplerate *= 2;
        samplerate /= 1000;                  // → kHz
    }
}
```
So passing 10000000 (10 MHz) produces wIdx=0 if firmware supports it. The pcap's wIdx=20000 remains unexplained — maybe different firmware/app version.

### Key takeaways for WebUSB
- `device.reset()` is NOT called by native libairspy — removing it avoids unexpected firmware state.
- Gains + bias tee are set BEFORE `RECEIVER_MODE=RX` (Phase 3 before Phase 4), not after.
- Direction bit: most "SET" commands (12,14-18,26) use IN (0xC0) despite being writes; only RECEIVER_MODE, SET_FREQ, GPIO_WRITE use OUT (0x40).
- SET_FREQ carries 4-byte LE frequency in data stage, not wValue/wIndex.
- Board info reads (PARTID_SERIALNO, BOARD_ID, VERSION) are informational; omitting them is fine.

## Conventions

- C++17. Formatting config: `src/clion-c++-formatter.xml` (CLion).
- PRs target `develop` branch, not master.
- No linter, no typechecker, no conventional test framework (Catch2/GoogleTest).
- No generated code except optional gRPC protobuf stubs (`-DENABLE_GRPC_API=ON`).
- GPLv3.
- Linux CI uses `dpkg-buildpackage` (Debian packaging); Windows uses MSYS2 UCRT64 + NSIS.
