import type { SdrDevice } from './sdr-device';
import { NfcDecoder, type NfcFrame, type NfcDecoderModule } from './decoder';

let decoder: NfcDecoder | null = null;
let iqProcessorPtr = 0;
let decoderModule: NfcDecoderModule | null = null;
let wasmInputBuf = 0;
let wasmOutputBuf = 0;
let wasmBufSize = 0;
let totalSamples = 0;
let frameCount = 0;
let lastLog = 0;
let lastLogSamples = 0;

let deviceInputRate = 0;
let deviceOutputRate = 0;
let decFactor = 2;

let isRecording = false;
let recordedChunks: Float32Array[] = [];
let maxRecordSamples = 0;
let recordedSamples = 0;
let onRecordingComplete: ((blob: Blob) => void) | null = null;

let isRecordingRaw = false;
let recordedRawChunks: Float32Array[] = [];
let maxRecordRawSamples = 0;
let recordedRawSamples = 0;
let onRecordingRawComplete: ((blob: Blob) => void) | null = null;

export type FrameCallback = (frame: NfcFrame) => void;
export type StatusCallback = (state: string, msg?: string) => void;

export function isRecordingActive(): boolean {
  return isRecording;
}

export function isRecordingRawActive(): boolean {
  return isRecordingRaw;
}

export function startRecording(
  durationSec: number,
  _sampleRate: number,
  onComplete: (blob: Blob) => void,
): void {
  recordedChunks = [];
  recordedSamples = 0;
  maxRecordSamples = deviceOutputRate * durationSec;
  isRecording = true;
  onRecordingComplete = onComplete;
}

export function startRecordingRaw(
  durationSec: number,
  sampleRate: number,
  onComplete: (blob: Blob) => void,
): void {
  recordedRawChunks = [];
  recordedRawSamples = 0;
  // For stereo IQ: each sample is 2 floats (I,Q), sampleRate pairs/sec
  maxRecordRawSamples = sampleRate * durationSec * 2;
  isRecordingRaw = true;
  onRecordingRawComplete = onComplete;
}

export function stopRecording(): void {
  isRecording = false;
  finishRecording();
}

function finishRecording(): void {
  if (recordedSamples === 0) {
    recordedChunks = [];
    onRecordingComplete = null;
    return;
  }

  const total = recordedSamples;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of recordedChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  recordedChunks = [];

  const blob = createWavBlob(merged, deviceOutputRate);

  const cb = onRecordingComplete;
  onRecordingComplete = null;
  if (cb) cb(blob);
}

export function stopRecordingRaw(): void {
  isRecordingRaw = false;
  finishRecordingRaw();
}

function finishRecordingRaw(): void {
  if (recordedRawSamples === 0) {
    recordedRawChunks = [];
    onRecordingRawComplete = null;
    return;
  }

  const total = recordedRawSamples;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of recordedRawChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  recordedRawChunks = [];

  // Stereo 16-bit WAV: I=left, Q=right
  const blob = createWavBlob(merged, deviceInputRate, 2);

  const cb = onRecordingRawComplete;
  onRecordingRawComplete = null;
  if (cb) cb(blob);
}

function createWavBlob(
  samples: Float32Array,
  sampleRate: number,
  channels: number = 1,
): Blob {
  // Convert float32 [-1,1] to int16
  const numSamples = samples.length;
  const int16 = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = Math.round(v * 32767);
  }

  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buf = new ArrayBuffer(headerSize + dataSize);
  const dv = new DataView(buf);

  // RIFF header
  dv.setUint8(0, 0x52); dv.setUint8(1, 0x49); dv.setUint8(2, 0x46); dv.setUint8(3, 0x46); // "RIFF"
  dv.setUint32(4, 36 + dataSize, true);
  dv.setUint8(8, 0x57); dv.setUint8(9, 0x41); dv.setUint8(10, 0x56); dv.setUint8(11, 0x45); // "WAVE"

  // fmt chunk
  dv.setUint8(12, 0x66); dv.setUint8(13, 0x6d); dv.setUint8(14, 0x74); dv.setUint8(15, 0x20); // "fmt "
  dv.setUint32(16, 16, true); // chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); // bits per sample

  // data chunk
  dv.setUint8(36, 0x64); dv.setUint8(37, 0x61); dv.setUint8(38, 0x74); dv.setUint8(39, 0x61); // "data"
  dv.setUint32(40, dataSize, true);

  // samples
  for (let i = 0; i < numSamples; i++) {
    dv.setInt16(44 + i * 2, int16[i], true);
  }

  return new Blob([buf], { type: 'audio/wav' });
}

export interface NfcProtocolConfig {
  nfca: boolean;
  nfcb: boolean;
  nfcf: boolean;
  nfcv: boolean;
}

export async function startRx(
  sdrDevice: SdrDevice,
  sampleRate: number,
  useIqConverter: boolean,
  nfcProtocol: NfcProtocolConfig,
  onFrame: FrameCallback,
  onStatus: StatusCallback,
): Promise<void> {
  try {
    const mod = (window as any).NfcDecoderModule;
    if (!mod) throw new Error('NfcDecoderModule not loaded');

    decoderModule = await mod({
      locateFile: (path: string) => './pkg/' + path,
    });
    if (!decoderModule) throw new Error('decoder module init failed');

    deviceInputRate = sampleRate;
    deviceOutputRate = sampleRate / decFactor;
    iqProcessorPtr = useIqConverter ? decoderModule._iq_processor_create() : 0;
    decoder = new NfcDecoder(decoderModule, deviceOutputRate);

    // Pre-allocate WASM buffers for the max USB transfer size (262144 bytes = 65536 IQ pairs)
    wasmBufSize = 262144;
    wasmInputBuf = decoderModule._malloc(wasmBufSize);
    wasmOutputBuf = decoderModule._malloc(65536 * 4);

    // Enable protocols per UI selection. Each adds ~25% CPU per type.
    decoder.configure({
      streamTime: Math.floor(Date.now() / 1000),
      protocol: {
        nfca: { enabled: nfcProtocol.nfca },
        nfcb: { enabled: nfcProtocol.nfcb },
        nfcf: { enabled: nfcProtocol.nfcf },
        nfcv: { enabled: nfcProtocol.nfcv },
      },
    });

    onStatus('connected');
    lastLog = performance.now();

    let tCopyIn = 0, tWasm = 0, tCopyOut = 0, tStats = 0, tFeed = 0, tPoll = 0;
    let timingCount = 0;

    await sdrDevice.startRx((data: ArrayBufferView) => {
      if (!decoder || !decoderModule) return;

      const iqCount = data.byteLength / 4;
      if (data.byteLength > wasmBufSize) {
        wasmBufSize = data.byteLength;
        decoderModule._free(wasmInputBuf);
        decoderModule._free(wasmOutputBuf);
        wasmInputBuf = decoderModule._malloc(wasmBufSize);
        wasmOutputBuf = decoderModule._malloc(65536 * 4);
      }

      let t0 = performance.now();

      // Copy raw int16 data to WASM heap
      decoderModule.HEAPU8.set(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        wasmInputBuf,
      );
      const t1 = performance.now();
      tCopyIn += t1 - t0;

      if (iqProcessorPtr) {
        decoderModule._iq_processor_process(iqProcessorPtr, wasmInputBuf, wasmOutputBuf, iqCount);
      } else {
        decoderModule._iq_to_magnitude_simd(wasmInputBuf, wasmOutputBuf, iqCount);
      }
      const t2 = performance.now();
      tWasm += t2 - t1;

      // Decimate in-place (keep every Nth sample) before feeding decoder
      const decCount = decoderModule._decimate_f32(wasmOutputBuf, iqCount, decFactor);

      // Magnitude view directly in WASM heap (no copy)
      const mag = new Float32Array(decoderModule.HEAPF32.buffer, wasmOutputBuf, decCount);
      const t3 = performance.now();
      tCopyOut += t3 - t2;

      // Capture raw IQ recording (use JS fallback — rare, so simplicity over speed)
      if (isRecordingRaw) {
        const int16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
        const f32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          f32[i] = (int16[i] - 2048) / 2048;
        }
        const remaining = maxRecordRawSamples - recordedRawSamples;
        if (remaining > 0) {
          const take = Math.min(f32.length, remaining);
          recordedRawChunks.push(new Float32Array(f32.buffer, f32.byteOffset, take));
          recordedRawSamples += take;
          if (recordedRawSamples >= maxRecordRawSamples) {
            isRecordingRaw = false;
            finishRecordingRaw();
          }
        }
      }

      let magSum = 0;
      let magMin = Infinity;
      let magMax = -Infinity;
      for (let i = 0; i < mag.length; i++) {
        const m = mag[i];
        magSum += m;
        if (m < magMin) magMin = m;
        if (m > magMax) magMax = m;
      }
      const t4 = performance.now();
      tStats += t4 - t3;

      totalSamples += iqCount;

      if (isRecording) {
        const remaining = maxRecordSamples - recordedSamples;
        if (remaining > 0) {
          const take = Math.min(mag.length, remaining);
          recordedChunks.push(new Float32Array(mag)); // copy out for recording
          recordedSamples += take;
          if (recordedSamples >= maxRecordSamples) {
            isRecording = false;
            finishRecording();
          }
        }
      }

      // Feed decoder directly from WASM heap — no malloc/copy needed
      decoder.feedPtr(wasmOutputBuf, mag.length);
      const t5 = performance.now();
      tFeed += t5 - t4;

      const frames = decoder.pollFrames();
      frameCount += frames.length;

      for (const frame of frames) {
        onFrame(frame);
      }
      const t6 = performance.now();
      tPoll += t6 - t5;
      timingCount++;

      const now = performance.now();
      if (now - lastLog > 500) {
        const avg = (magSum / mag.length).toFixed(5);
        const samplesPerSec = ((totalSamples - lastLogSamples) / ((now - lastLog + 1) / 1000)).toFixed(0);
        lastLogSamples = totalSamples;
        const totalMs = tCopyIn + tWasm + tCopyOut + tStats + tFeed + tPoll;
        const pct = (v: number) => ((v / totalMs) * 100).toFixed(0);
        onStatus('timing',
          `${samplesPerSec}/s  ch=${timingCount}  ` +
          `in=${pct(tCopyIn)} w=${pct(tWasm)} out=${pct(tCopyOut)} ` +
          `st=${pct(tStats)} feed=${pct(tFeed)} poll=${pct(tPoll)}`
        );
        lastLog = now;
        tCopyIn = tWasm = tCopyOut = tStats = tFeed = tPoll = 0;
        timingCount = 0;
      }
    });
  } catch (err) {
    onStatus('error', String(err));
  }
}

export function stopRx(): void {
  if (isRecording) {
    isRecording = false;
    finishRecording();
  }
  if (isRecordingRaw) {
    isRecordingRaw = false;
    finishRecordingRaw();
  }
  if (decoder) {
    decoder.destroy();
    decoder = null;
  }
  if (iqProcessorPtr && decoderModule) {
    decoderModule._iq_processor_destroy(iqProcessorPtr);
    iqProcessorPtr = 0;
  }
  if (wasmInputBuf && decoderModule) {
    decoderModule._free(wasmInputBuf);
    wasmInputBuf = 0;
  }
  if (wasmOutputBuf && decoderModule) {
    decoderModule._free(wasmOutputBuf);
    wasmOutputBuf = 0;
  }
  wasmBufSize = 0;
  decoderModule = null;
}

export async function feedWav(
  wavBuffer: ArrayBuffer,
  onFrame: FrameCallback,
  onStatus: StatusCallback,
): Promise<void> {
  const mod = (window as any).NfcDecoderModule;
  if (!mod) throw new Error('NfcDecoderModule not loaded');

  const decoderModule = await mod({
    locateFile: (path: string) => './pkg/' + path,
  });

  // Parse WAV header
  const view = new DataView(wavBuffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a RIFF file');

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') throw new Error('Not a WAVE file');

  let channels = 1, sampleRate = 10000000, bitsPerSample = 16;
  let dataOffset = 0, dataLen = 0;
  for (let off = 12; off < wavBuffer.byteLength - 8;) {
    const chunkId = String.fromCharCode(view.getUint8(off), view.getUint8(off+1), view.getUint8(off+2), view.getUint8(off+3));
    const chunkLen = view.getUint32(off + 4, true);
    if (chunkId === 'fmt ') {
      const audioFormat = view.getUint16(off + 8, true);
      if (audioFormat !== 1) throw new Error('Only PCM WAV supported');
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bitsPerSample = view.getUint16(off + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = off + 8;
      dataLen = chunkLen;
    }
    off += 8 + chunkLen + (chunkLen % 2);
  }

  if (!dataLen) throw new Error('No data chunk found');

  // Convert raw PCM to Float32Array magnitude
  const decoder = new NfcDecoder(decoderModule, sampleRate);
  decoder.configure({
    streamTime: Math.floor(Date.now() / 1000),
    protocol: { nfca: { enabled: true }, nfcb: { enabled: true }, nfcf: { enabled: true }, nfcv: { enabled: true } },
  });

  const bytesPerSample = bitsPerSample / 8;
  const totalFrames = dataLen / (bytesPerSample * channels);

  onStatus('connected');

  if (channels === 1)
  {
    // Mono: already magnitude
    const mag = new Float32Array(totalFrames);
    if (bitsPerSample === 16) {
      for (let i = 0; i < totalFrames; i++) {
        mag[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
      }
    } else if (bitsPerSample === 32) {
      for (let i = 0; i < totalFrames; i++) {
        mag[i] = view.getFloat32(dataOffset + i * 4, true);
      }
    } else {
      throw new Error(`Unsupported bitsPerSample: ${bitsPerSample}`);
    }
    decoder.feed(mag);
  }
  else
  {
    // Stereo: IQ → iqconverter → magnitude
    const f32 = new Float32Array(totalFrames * 2);
    if (bitsPerSample === 16) {
      for (let i = 0; i < totalFrames * 2; i++) {
        f32[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
      }
    } else {
      throw new Error(`Unsupported bitsPerSample for stereo: ${bitsPerSample}`);
    }
    const { IqConverter } = await import('./iq-converter');
    const iqConv = new IqConverter();
    iqConv.process(f32);
    const mag = new Float32Array(totalFrames);
    for (let i = 0; i < totalFrames; i++) {
      mag[i] = Math.sqrt(f32[i*2]*f32[i*2] + f32[i*2+1]*f32[i*2+1]);
    }
    decoder.feed(mag);
  }

  // Poll frames
  const frames = decoder.pollFrames();
  for (const frame of frames) {
    onFrame(frame);
  }
  console.log(`[feedWav] decoded ${frames.length} frames from WAV (${sampleRate} Hz, ${channels} ch, ${totalFrames} frames)`);

  decoder.destroy();
}
