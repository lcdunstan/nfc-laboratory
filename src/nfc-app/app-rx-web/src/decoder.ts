export interface NfcDecoderModule {
  _decoder_create(sampleRate: number): number;
  _decoder_feed(ptr: number, samples: number, count: number): void;
  _decoder_poll_frames(ptr: number, buf: number, maxLen: number): number;
  _decoder_configure(ptr: number, jsonConfig: number): void;
  _decoder_get_status(ptr: number, buf: number, maxLen: number): number;
  _decoder_destroy(ptr: number): void;
  _iq_to_magnitude_simd(input: number, output: number, count: number): number;
  _iq_processor_create(): number;
  _iq_processor_destroy(ptr: number): void;
  _iq_processor_process(ptr: number, input: number, output: number, count: number): number;
  _decimate_f32(buf: number, count: number, factor: number): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
}

export interface NfcFrame {
  techType: number;
  dateTime: number;
  sampleStart: number;
  sampleEnd: number;
  sampleRate: number;
  timeStart: number;
  timeEnd: number;
  frameType: number;
  frameRate: number;
  frameFlags: number;
  framePhase: number;
  frameData: string;
}

export class NfcDecoder {
  private module: NfcDecoderModule;
  private ptr: number;
  private jsonBuf: number;
  private jsonBufSize = 65536;

  constructor(module: NfcDecoderModule, sampleRate: number) {
    this.module = module;
    this.ptr = module._decoder_create(sampleRate);
    if (!this.ptr) throw new Error('decoder_create failed');
    this.jsonBuf = module._malloc(this.jsonBufSize);
  }

  feed(samples: Float32Array): void {
    const bytes = samples.length * 4;
    const buf = this.module._malloc(bytes);
    this.module.HEAPF32.set(samples, buf >> 2);
    this.module._decoder_feed(this.ptr, buf, samples.length);
    this.module._free(buf);
  }

  feedPtr(ptr: number, count: number): void {
    this.module._decoder_feed(this.ptr, ptr, count);
  }

  pollFrames(): NfcFrame[] {
    const len = this.module._decoder_poll_frames(this.ptr, this.jsonBuf, this.jsonBufSize);
    if (len <= 0) return [];

    const bytes = new Uint8Array(this.module.HEAPU8.buffer, this.jsonBuf, len);
    const jsonStr = new TextDecoder().decode(bytes);
    return JSON.parse(jsonStr);
  }

  configure(config: Record<string, unknown>): void {
    const jsonStr = JSON.stringify(config);
    const bytes = new TextEncoder().encode(jsonStr);
    const buf = this.module._malloc(bytes.length + 1);
    this.module.HEAPU8.set(bytes, buf);
    this.module.HEAPU8[buf + bytes.length] = 0;
    this.module._decoder_configure(this.ptr, buf);
    this.module._free(buf);
  }

  getStatus(): Record<string, unknown> {
    const len = this.module._decoder_get_status(this.ptr, this.jsonBuf, this.jsonBufSize);
    if (len <= 0) return {};
    const bytes = new Uint8Array(this.module.HEAPU8.buffer, this.jsonBuf, len);
    const jsonStr = new TextDecoder().decode(bytes);
    return JSON.parse(jsonStr);
  }

  destroy(): void {
    if (this.ptr) {
      this.module._decoder_destroy(this.ptr);
      this.ptr = 0;
    }
    if (this.jsonBuf) {
      this.module._free(this.jsonBuf);
      this.jsonBuf = 0;
    }
  }
}
