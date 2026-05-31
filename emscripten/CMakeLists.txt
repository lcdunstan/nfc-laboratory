cmake_minimum_required(VERSION 3.21)

# Pass -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
# or source emsdk_env.sh first so EMSDK is set.
if(DEFINED ENV{EMSDK})
  set(CMAKE_TOOLCHAIN_FILE "$ENV{EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake" CACHE FILEPATH "Emscripten toolchain file")
endif()

project(nfc-lab-emscripten LANGUAGES C CXX)

include(CTest)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_C_STANDARD 99)

# Use emscripten's port of zlib
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -sUSE_ZLIB")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -sUSE_ZLIB")

set(SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/..)

# ── vendored libs (hardware-independent) ──────────────────────────────────

# microtar (pure C, no deps)
add_library(microtar STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/microtar/src/main/c/microtar.c)
target_include_directories(microtar PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/microtar/src/main/include)

# nlohmann json (header-only interface)
add_library(nlohmann INTERFACE)
target_include_directories(nlohmann INTERFACE
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/nlohmann/src/main/include)

# ed25519 (pure C, no deps)
add_library(ed25519 STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/add_scalar.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/fe.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/ge.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/key_exchange.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/keypair.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/sc.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/seed.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/sha512.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/sign.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c/verify.c)
target_compile_options(ed25519 PRIVATE -DED25519_NO_SEED)
target_include_directories(ed25519 PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/ed25519/src/main/c)

# mufft (pure C FFT, no hw deps; skip x86-specific SIMD variants for WASM)
add_library(mufft STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/mufft/src/main/c/fft.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/mufft/src/main/c/kernel.c
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/mufft/src/main/c/cpu.c)
target_include_directories(mufft PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-ext/mufft/src/main/include)
target_link_libraries(mufft m)

# ── runtime library (depends on microtar + zlib) ──────────────────────────

add_library(rt-lang STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Executor.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/FileSystem.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Format.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Library.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Map.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Package.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Worker.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Tokenizer.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp/Logger.cpp)
target_include_directories(rt-lang PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/include)
target_include_directories(rt-lang PRIVATE
    ${SOURCE_DIR}/src/nfc-lib/lib-rt/rt-lang/src/main/cpp)
target_link_libraries(rt-lang microtar z)

# ── hardware-core library (platform-independent hw abstractions) ──────────

add_library(hw-core STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-hw/hw-core/src/main/cpp/hw/SignalBuffer.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-hw/hw-core/src/main/cpp/hw/RecordDevice.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-hw/hw-core/src/main/cpp/hw/DeviceFactory.cpp)
target_include_directories(hw-core PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-hw/hw-core/src/main/include)
target_include_directories(hw-core PRIVATE
    ${SOURCE_DIR}/src/nfc-lib/lib-hw/hw-core/src/main/cpp)
target_link_libraries(hw-core rt-lang)

# ── lab-data (pure data types, no hw deps) ────────────────────────────────

add_library(lab-data STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-data/src/main/cpp/Crc.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-data/src/main/cpp/RawFrame.cpp)
target_include_directories(lab-data PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-data/src/main/include)
target_include_directories(lab-data PRIVATE
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-data/src/main/cpp)
target_link_libraries(lab-data rt-lang)

# ── lab-radio (NFC-A/B/F/V decoders, no hw deps beyond hw-core) ──────────

add_library(lab-radio STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/cpp/NfcDecoder.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/cpp/NfcTech.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/cpp/tech/NfcA.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/cpp/tech/NfcB.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/cpp/tech/NfcF.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/cpp/tech/NfcV.cpp)
target_include_directories(lab-radio PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/include)
target_include_directories(lab-radio PRIVATE
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-radio/src/main/cpp)
target_link_libraries(lab-radio lab-data rt-lang hw-core)

# ── lab-logic (ISO7816 decoder, no hw deps beyond hw-core) ────────────────

add_library(lab-logic STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-logic/src/main/cpp/IsoDecoder.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-logic/src/main/cpp/tech/Iso7816.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-logic/src/main/cpp/IsoTech.cpp)
target_include_directories(lab-logic PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-logic/src/main/include)
target_include_directories(lab-logic PRIVATE
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-logic/src/main/cpp)
target_link_libraries(lab-logic lab-data rt-lang hw-core)

# ── lab-tasks (hardware-independent task subset for WASM) ─────────────────

add_library(lab-tasks STATIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/cpp/tasks/FourierProcessTask.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/cpp/tasks/LogicDecoderTask.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/cpp/tasks/RadioDecoderTask.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/cpp/tasks/SignalStreamTask.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/cpp/tasks/SignalStorageTask.cpp
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/cpp/tasks/TraceStorageTask.cpp)
target_include_directories(lab-tasks PUBLIC
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/include)
target_include_directories(lab-tasks PRIVATE
    ${SOURCE_DIR}/src/nfc-lib/lib-lab/lab-tasks/src/main/cpp)
target_link_libraries(lab-tasks lab-logic lab-radio rt-lang hw-core nlohmann microtar mufft z)

# ── test-sdr-wasm (WASM equivalent of test-sdr, auto-runs on preloaded WAV data) ──

add_executable(test-sdr-wasm
    ${SOURCE_DIR}/src/nfc-test/test-sdr/src/main/cpp/main.cpp
)
target_link_libraries(test-sdr-wasm lab-radio hw-core rt-lang nlohmann)
target_link_options(test-sdr-wasm PRIVATE
    --preload-file ${SOURCE_DIR}/wav/@/
    -sALLOW_MEMORY_GROWTH
    -sEXIT_RUNTIME=1
)

add_test(NAME test-sdr-wasm COMMAND test-sdr-wasm)
