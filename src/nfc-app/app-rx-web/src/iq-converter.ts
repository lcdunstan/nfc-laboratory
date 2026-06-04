// Replicates libairspy's iqconverter_float_process:
//   1. remove_dc  — leaky-integrator DC removal (HPF with coeff 0.01)
//   2. translate_fs_4 — Fs/4 rotation + symmetric half-band FIR on I + delay on Q
// After translate_fs_4 the caller should decimate ×2 (keep every other IQ pair).

const SCALE = 0.01;
const SIZE_FACTOR = 32;

// AIRSPY_HB_KERNEL_FLOAT decimated: every other coefficient (indices 0,2,4,…,46)
// Length = 47/2 + 1 = 24
const HB_KERNEL: Float32Array = new Float32Array([
  -0.000998606272947510,
   0.001695637278417295,
  -0.003054430179754289,
   0.005055504379767936,
  -0.007901319195893647,
   0.011873357051047719,
  -0.017411159379930066,
   0.025304817427568772,
  -0.037225225204559217,
   0.057533286997004301,
  -0.102327462004259350,
   0.317034472508947400,
   0.317034472508947400,
  -0.102327462004259350,
   0.057533286997004301,
  -0.037225225204559217,
   0.025304817427568772,
  -0.017411159379930066,
   0.011873357051047719,
  -0.007901319195893647,
   0.005055504379767936,
  -0.003054430179754289,
   0.001695637278417295,
  -0.000998606272947510,
]);

// hbc = AIRSPY_HB_KERNEL_FLOAT[23] = 0.5 (center tap of original 47-tap kernel)
const HBC = 0.5;

export class IqConverter {
  private avg = 0;

  // FIR state
  private firLen: number;
  private firKernel: Float32Array;
  private firQueue: Float32Array;
  private firIndex = 0;

  // Delay state
  private halfLen: number;
  private delayLine: Float32Array;
  private delayIndex = 0;

  constructor() {
    this.firLen = HB_KERNEL.length; // 24
    this.firKernel = HB_KERNEL;
    this.firQueue = new Float32Array(this.firLen * SIZE_FACTOR);
    this.halfLen = this.firLen >> 1; // 12
    this.delayLine = new Float32Array(this.halfLen);
    this.reset();
  }

  reset(): void {
    this.avg = 0;
    this.firIndex = 0;
    this.delayIndex = 0;
    this.firQueue.fill(0);
    this.delayLine.fill(0);
  }

  // Applies remove_dc + translate_fs_4 in-place on interleaved float32 IQ.
  // samples length must be a multiple of 4.
  process(samples: Float32Array): void {
    if (samples.length % 4 !== 0) {
      throw new Error(`IqConverter: samples.length (${samples.length}) must be a multiple of 4`);
    }
    this.removeDc(samples);
    this.translateFs4(samples);
  }

  // ---------------------------------------------------------------------------
  // remove_dc — leaky-integrator high-pass filter
  //   sample[i] -= avg;  avg += SCALE * sample[i];
  // ---------------------------------------------------------------------------
  private removeDc(samples: Float32Array): void {
    let avg = this.avg;
    for (let i = 0; i < samples.length; i++) {
      samples[i] -= avg;
      avg += SCALE * samples[i];
    }
    this.avg = avg;
  }

  // ---------------------------------------------------------------------------
  // translate_fs_4
  //   1. Multiply every group of 4 samples by rotation pattern
  //   2. Symmetric half-band FIR on I (even) samples
  //   3. Delay Q (odd) samples by halfLen to compensate for FIR group delay
  // ---------------------------------------------------------------------------
  private translateFs4(samples: Float32Array): void {
    const hbc = HBC;

    // Rotation: for each group of 4 floats (2 IQ pairs):
    //   I0 *= -1, Q0 *= -hbc, I1 *= 1, Q1 *= hbc
    for (let i = 0; i < samples.length; i += 4) {
      samples[i + 0] = -samples[i + 0];
      samples[i + 1] = -samples[i + 1] * hbc;
      // samples[i+2] unchanged (I1)
      samples[i + 3] = samples[i + 3] * hbc;
    }

    this.firInterleaved(samples);
    // delay on Q samples only: samples + 1, step by 2
    this.delayInterleaved(samples, 1);
  }

  // ---------------------------------------------------------------------------
  // Symmetric half-band FIR on the I channel (even indices)
  // Kernel length = 24, using symmetry: kernel[k] * (queue[k] + queue[len-1-k])
  // ---------------------------------------------------------------------------
  private firInterleaved(samples: Float32Array): void {
    const firLen = this.firLen;
    const kernel = this.firKernel;
    const queue = this.firQueue;
    let firIndex = this.firIndex;

    for (let i = 0; i < samples.length; i += 2) {
      const qBase = firIndex;
      // store current I sample at queue head
      queue[qBase] = samples[i];

      // symmetric dot product: kernel[k] * (queue[k] + queue[firLen-1-k])
      let acc = 0;
      const half = firLen >> 1; // 12
      for (let k = 0; k < half; k++) {
        acc += kernel[k] * (queue[qBase + k] + queue[qBase + firLen - 1 - k]);
      }

      samples[i] = acc;

      // decrement index, wrap around when negative
      firIndex--;
      if (firIndex < 0) {
        firIndex = firLen * (SIZE_FACTOR - 1);
        // copy the first (firLen-1) elements to just after the new position
        const dest = firIndex + 1;
        for (let j = 0; j < firLen - 1; j++) {
          queue[dest + j] = queue[j];
        }
      }
    }

    this.firIndex = firIndex;
  }

  // ---------------------------------------------------------------------------
  // Delay line for Q channel (odd indices in samples)
  // Delays Q samples by halfLen to match FIR group delay on I
  // ---------------------------------------------------------------------------
  private delayInterleaved(samples: Float32Array, offset: number): void {
    const halfLen = this.halfLen;
    const delayLine = this.delayLine;
    let delayIndex = this.delayIndex;

    for (let i = offset; i < samples.length; i += 2) {
      const res = delayLine[delayIndex];
      delayLine[delayIndex] = samples[i];
      samples[i] = res;

      delayIndex++;
      if (delayIndex >= halfLen) {
        delayIndex = 0;
      }
    }

    this.delayIndex = delayIndex;
  }
}
