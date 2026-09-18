---
name: nfc-lab-capture
description: "Capture live NFC ISO 14443/15693 traffic from an SDR receiver using nfc-rx.exe (the nfc-laboratory CLI receiver). Use when asked to capture, sniff, record, or acquire NFC signals from a Software Defined Radio; to run nfc-rx / the nfc-laboratory command-line receiver; to produce a JSONL frame capture from an Airspy, RTL-SDR, HackRF, or similar SDR; or to configure SDR frequency, sample rate, gain, or protocol selection for an NFC capture."
---

# NFC Live Capture with nfc-rx (nfc-laboratory)

`nfc-rx` (built as `nfc-rx.exe` on Windows) is the command-line receiver from
the nfc-laboratory project. It captures NFC signals **live from an SDR** in
real time, decodes them, and prints frames to stdout — as human-readable text
or as JSON (JSONL) compatible with `nfc-lab --json-frames`.

## Critical facts (read first)

- **Live SDR only.** `nfc-rx` requires a physically connected, supported SDR
  receiver. It has **no file-input mode** and **no config file**. It cannot
  decode a `.wav` or `.trz` recording — replaying recordings is a GUI-only
  feature of the desktop app (`nfc-lab`). Do not attempt to pass it a capture
  file; there is no positional file argument.
- **stdout vs stderr.** Decoded frames go to **stdout**; log messages go to
  **stderr**. So `-j` (JSON frames) and `-l INFO` (logging) can be combined and
  redirected independently, e.g. `nfc-rx -j -l INFO > capture.jsonl`.
- **Runs until stopped.** By default it captures until Ctrl+C. Use `-t SECONDS`
  for a bounded capture.
- **Silent by default.** With no `-l`, there is no logging at all — only frames.

If the user asks to "decode a capture file," that is a job for the companion
`nfc-decode` skill / `nfcdecode.py`, not `nfc-rx`. This skill is for acquiring
new captures from hardware.

## Locating or building the binary

This skill assumes access to a built `nfc-rx` / `nfc-rx.exe`. To find it:

1. Search the workspace for `nfc-rx.exe` (Windows) or `nfc-rx` (Linux/macOS).
   In a standard build it is under `build/src/nfc-app/app-rx/`.
2. If it is not built yet, build the nfc-laboratory project first (CMake +
   the platform toolchain), then re-locate the binary.

The commands below use `<nfc-rx>` as a placeholder for that path.

### Windows runtime note (MSYS2 / MinGW builds)

MSYS2 is only needed to **build** `nfc-rx.exe`, not to run it. At runtime the
exe just needs its dependent DLLs discoverable — MSYS2 is one convenient source
of them, not a requirement.

A MinGW build of `nfc-rx.exe` depends on three groups of DLLs:

- SDR/driver DLLs already staged next to the exe by the build
  (e.g. `hydrasdr.dll`, `librtlsdr.dll`, `pthreadVC3.dll`).
- Windows system DLLs (always present).
- Four MinGW/UCRT64 runtime DLLs that, out of the box, resolve only from
  `C:\msys64\ucrt64\bin`: `libgcc_s_seh-1.dll`, `libwinpthread-1.dll`,
  `libstdc++-6.dll`, `libusb-1.0.dll`.

That last group is the only reason a fresh `nfc-rx.exe` fails outside MSYS2.
Pick one of these to run it anywhere:

- **Stage the DLLs once (recommended).** Copy the four UCRT64 runtime DLLs next
  to `nfc-rx.exe` (in `build/src/nfc-app/app-rx/`). After that it runs from
  plain PowerShell, cmd, or a double-click with no MSYS2 on PATH:

  ```powershell
  $ucrt = "C:\msys64\ucrt64\bin"
  $dst  = "<dir containing nfc-rx.exe>"
  'libgcc_s_seh-1.dll','libwinpthread-1.dll','libstdc++-6.dll','libusb-1.0.dll' |
    ForEach-Object { Copy-Item -Force (Join-Path $ucrt $_) $dst }
  <nfc-rx> --version   # sanity check: prints version, exit 0
  ```

- **Or run from the UCRT64 login shell** (DLLs resolve via PATH automatically),
  which is handy during development:

  ```powershell
  $env:MSYSTEM = "UCRT64"; & C:\msys64\usr\bin\bash.exe -lc "<nfc-rx> [options]"
  ```

  Use POSIX-style paths (`/c/...`) inside the bash command.

Note: the project's `build/build-runenv.ps1` stages DLLs for the **GUI app**
(`app-qt/nfc-lab.exe`) only — it does **not** stage `nfc-rx.exe`. For the CLI
receiver, stage the four DLLs yourself as shown above.

A silent exit with code `0xc0000135` (STATUS_DLL_NOT_FOUND) means a required
DLL was not found — that is the missing-DLL/PATH problem, not a usage error.

On Linux/macOS just run `<nfc-rx>` directly once built.

## Options (verified against `nfc-rx --help`)

| Option | Arg | Effect |
|--------|-----|--------|
| `-h`, `--help` | — | Show help and exit. |
| `-v`, `--version` | — | Show version and exit. |
| `-l`, `--log-level` | LEVEL | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR`, `TRACE`. Logs go to **stderr**. Default: silent. |
| `-j`, `--json-frames` | — | Emit decoded frames as JSON (one object per line) to **stdout**. Default: human-readable text. |
| `-d` | — | Debug mode: write a WAV file of raw signals. **Significantly hurts performance**; for diagnostics only. |
| `-p` | PROTOCOLS | Comma-separated subset of `nfca`, `nfcb`, `nfcf`, `nfcv`. Default: all enabled. |
| `-f` | FREQUENCY | Receiver center frequency in Hz. Default: auto per hardware. |
| `-s` | SAMPLERATE | Receiver sample rate in Hz. Default: auto per hardware. |
| `-g`, `--gain-mode` | MODE | Receiver gain mode (integer). |
| `-G`, `--gain-value` | VAL | Receiver gain value (integer). |
| `-a`, `--mixer-agc` | — | Enable mixer AGC. |
| `-u`, `--tuner-agc` | — | Enable tuner AGC. |
| `-b`, `--bias-tee` | — | Enable bias-tee (required for a Spyverter up-converter). |
| `-t` | SECONDS | Stop after N seconds. Default: run until Ctrl+C. |

There is no config file and no positional argument. Frequency/sample-rate/gain
default to sensible per-device values (Airspy, RTL-SDR, Miri, etc.); only
override them when you have a reason to.

## Output formats

Text (default), one line per frame:

```
0001234.567 (Poll) [NfcA@106]: 26 00
```

JSON with `-j`, one object per line (JSONL). Real records carry snake_case
fields such as `time_start`, `frame_type`, `tech`, `data` (colon-separated
hex), and `flags` — the same shape the `nfc-decode` skill consumes. This is
explicitly compatible with `nfc-lab --json-frames`.

Note: a persisted `.trz` trace from the GUI uses different (camelCase) JSON
keys internally; `nfc-rx -j` streaming output is the snake_case JSONL form.

## Typical workflows

Bounded JSON capture to a file (most common for later decoding):

```powershell
$env:MSYSTEM = "UCRT64"; & C:\msys64\usr\bin\bash.exe -lc "<nfc-rx> -j -p nfca,nfcb -t 60 > /c/path/to/capture.jsonl"
```

Then decode it with the `nfc-decode` skill:

```
uv run nfcdecode.py capture.jsonl
```

Live text view with INFO logging (frames on stdout, logs on stderr):

```powershell
$env:MSYSTEM = "UCRT64"; & C:\msys64\usr\bin\bash.exe -lc "<nfc-rx> -l INFO"
```

Specific SDR tuning (example: Airspy at 40.68 MHz / 10 MS/s):

```powershell
$env:MSYSTEM = "UCRT64"; & C:\msys64\usr\bin\bash.exe -lc "<nfc-rx> -f 40680000 -s 10000000 -j -t 30 > /c/path/to/capture.jsonl"
```

## Running it as an agent

- `nfc-rx` is **long-running and interactive** (it captures until Ctrl+C).
  Never launch an unbounded capture as a blocking foreground command — always
  use `-t SECONDS` to bound it, or start it as a background process and stop it
  explicitly.
- A real capture needs the RF field active (a reader energizing a card in
  front of the SDR antenna). With no field/traffic you will get only carrier
  events or nothing. If the user is running the capture by hand, ask them to
  present the card / start the terminal during the capture window.
- Confirm which SDR is connected before overriding `-f`/`-s`; wrong values for
  the hardware yield empty or noisy captures.

## Notes and caveats

- Supported hardware includes RTL-SDR, Airspy (Mini/R2/HF+), HackRF One, and
  other driver-compatible SDRs. An unrecognized/unconnected device ends the
  capture with an error.
- The `-d` WAV dump is a decoder diagnostic, not the normal way to record
  signals; expect a large file and slower decoding.
- This skill acquires captures. Interpreting them (activation sequences,
  APDUs, EMV TLV, DESFire, CRC errors) is the `nfc-decode` skill's job.
