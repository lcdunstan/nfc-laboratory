# Project Overview

NFC-LABORATORY is a desktop application for NFC signal sniffing and protocol decoding using Software Defined Radio (SDR) receivers and logic analyzers.

## Tech Stack

- Language: C++17
- Build system: CMake 3.21+
- GUI framework: Qt6
- Compiler: GCC / MinGW (SSE/SSE3 enabled on x86_64)
- License: GPL-3.0-or-later
- Platforms: Linux, Windows (macOS experimental)

## Module Layout

The source tree lives under `src/` and follows a Maven-like directory convention:

```
src/
  nfc-app/          # Application targets
    app-qt/         # Qt6 GUI application (main desktop app)
    app-rx/         # CLI receiver tool
  nfc-lib/          # Shared static libraries
    lib-ext/        # Third-party bundled libraries (nlohmann/json, microtar, mufft, etc.)
    lib-hw/         # Hardware abstraction layer
      hw-dev/       # Base device interfaces
      hw-logic/     # Logic analyzer device drivers
      hw-radio/     # SDR radio device drivers (Airspy, RTL-SDR, HackRF, HydraSdr, Miri)
    lib-lab/        # Core NFC laboratory logic (decoders, demodulators, protocol parsers)
    lib-rt/         # Runtime utilities (logging, threading, event system)
  nfc-test/         # Test executables
    test-dio/       # Device I/O tests
    test-parser/    # Protocol parser tests
    test-rpc/       # RPC/gRPC tests
    test-sdr/       # SDR signal processing tests
```

Each library module uses this internal structure:

```
<module>/
  CMakeLists.txt
  src/main/cpp/       # Private implementation sources
  src/main/include/   # Public headers (exported via target_include_directories PUBLIC)
```

## Key Dependencies

- libusb-1.0 (USB device access)
- libairspy, libhydrasdr, libhackrf, librtlsdr, libmirisdr (SDR hardware drivers)
- Qt6 (Widgets, Core, Network)
- Optional: gRPC + Protobuf (remote control API, gated by ENABLE_GRPC_API option)

## Architecture Patterns

- PImpl idiom: Classes expose a public interface with a nested `Impl` struct holding private state and logic.
- Static libraries: Each `lib-*` module compiles to a static library linked into the application targets.
- Namespace hierarchy mirrors the module path (e.g., `hw::radio`, `hw::logic`, `lab::nfc`).
- Signal buffers: Data flows through `SignalBuffer` objects passed between hardware drivers, demodulators, and decoders.
- Structured logging via `rt::Logger` with hierarchical logger names.
