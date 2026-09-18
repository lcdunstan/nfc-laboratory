# Build and Test

## Prerequisites

### Linux (Ubuntu/Debian)

```bash
sudo apt install build-essential cmake qt6-base-dev libusb-1.0-0-dev zlib1g-dev libgl1-mesa-dev
# Optional SDR drivers (install whichever are available):
sudo apt install libairspy-dev libhydrasdr-dev librtlsdr-dev
```

### Windows (MSYS2 / MinGW64)

```bash
pacman -S mingw-w64-x86_64-cmake mingw-w64-x86_64-qt6-base mingw-w64-x86_64-libusb mingw-w64-x86_64-zlib
```

SDR libraries that are not found on the system fall back to bundled versions in `dll/`.

### macOS (experimental)

```bash
brew install libusb qt cmake gcc
```

## Building

Standard CMake out-of-source build:

```bash
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_PROJECT_VERSION="1.0.0"
make -j$(nproc)
```

### CMake Options

| Option | Default | Description |
|--------|---------|-------------|
| `CMAKE_BUILD_TYPE` | (none) | `Debug` or `Release` |
| `BUILD_PROJECT_VERSION` | `0.0.0` | Semantic version embedded in the binary |
| `ENABLE_GRPC_API` | `OFF` | Enable gRPC remote control service (requires gRPC + protobuf) |

### Debug vs Release Flags

- Debug: `-g -Og -fno-omit-frame-pointer`
- Release: `-O3 -fno-math-errno -falign-functions=32 -falign-loops=32 -march=native -fopenmp` (Linux/Windows)

### Architecture

On x86_64 targets, SSE and SSE3 are enabled; AVX is explicitly disabled (`-mno-avx`).

## Tests

Test executables live under `src/nfc-test/`. They are standalone binaries (no test framework harness). Build and run them individually:

```bash
cd build
./src/nfc-test/test-parser/test-parser
./src/nfc-test/test-sdr/test-sdr
```

## Packaging

### Linux (.deb)

The project supports `dpkg-buildpackage` via the `debian/` directory:

```bash
dpkg-buildpackage -us -uc -j4
```

### Windows (NSIS installer)

After building, run the generated PowerShell script:

```powershell
.\build-installer.ps1
```

### Flatpak

See `dat/flatpak/` for the Flatpak manifest and metadata.

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

- `cmake-build.yml` — Multi-platform build and release (triggered on tags)
- `flatpak-build.yml` — Flatpak package build
- `flatpak-update-check.yml` — Checks for Flatpak dependency updates
