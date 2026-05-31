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

## Architecture

```
src/
  nfc-app/
    app-qt/   → nfc-lab  (Qt6 GUI, primary app)
    app-rx/   → nfc-rx   (CLI SDR receiver)
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

## Conventions

- C++17. Formatting config: `src/clion-c++-formatter.xml` (CLion).
- PRs target `develop` branch, not master.
- No linter, no typechecker, no conventional test framework (Catch2/GoogleTest).
- No generated code except optional gRPC protobuf stubs (`-DENABLE_GRPC_API=ON`).
- GPLv3.
- Linux CI uses `dpkg-buildpackage` (Debian packaging); Windows uses MSYS2 UCRT64 + NSIS.
