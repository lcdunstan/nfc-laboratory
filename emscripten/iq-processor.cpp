#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <wasm_simd128.h>
#endif

// 14-tap symmetric half-band FIR (truncated from 24-tap; outermost 5 taps per side < 0.01)
#define FIR_LEN 14
#define HALF_LEN (FIR_LEN / 2)
#define SIZE_FACTOR 32
#define FIR_QUEUE_LEN (FIR_LEN * SIZE_FACTOR)

// AIRSPY_HB_KERNEL_FLOAT decimated, indices 5,7,9,…,23 (half-length: every other of remaining 14)
static const float HB_KERNEL[HALF_LEN] = {
    0.011873357051047719f,
   -0.017411159379930066f,
    0.025304817427568772f,
   -0.037225225204559217f,
    0.057533286997004301f,
   -0.102327462004259350f,
    0.317034472508947400f,
};

// hbc = AIRSPY_HB_KERNEL_FLOAT[23] = 0.5 (center tap of original 47-tap kernel)
#define HBC 0.5f

extern "C" {

// ── SIMD-optimized int16 IQ → float32 magnitude (no IQ processing) ─────

// ── In-place float32 decimation ───────────────────────────────────────────

int decimate_f32(float *buf, int count, int factor)
{
   if (factor <= 1) return count;
   int outCount = count / factor;
   for (int i = 0; i < outCount; i++)
      buf[i] = buf[i * factor];
   return outCount;
}

int iq_to_magnitude_simd(const int16_t *input, float *output, int count)
{
   const float scale = 1.0f / 2048.0f;
   int i = 0;

#ifdef __EMSCRIPTEN__
   for (; i + 4 <= count; i += 4)
   {
      v128_t vec = wasm_v128_load(input + i * 2);

      v128_t i16_i = wasm_i16x8_shuffle(vec, vec, 0, 2, 4, 6, 8, 10, 12, 14);
      v128_t i16_q = wasm_i16x8_shuffle(vec, vec, 1, 3, 5, 7, 9, 11, 13, 15);

      v128_t i32_i = wasm_i32x4_extend_low_i16x8(i16_i);
      v128_t i32_q = wasm_i32x4_extend_low_i16x8(i16_q);
      v128_t f32_i = wasm_f32x4_convert_i32x4(i32_i);
      v128_t f32_q = wasm_f32x4_convert_i32x4(i32_q);

      v128_t off = wasm_f32x4_splat(2048.0f);
      v128_t s = wasm_f32x4_splat(scale);
      f32_i = wasm_f32x4_mul(wasm_f32x4_sub(f32_i, off), s);
      f32_q = wasm_f32x4_mul(wasm_f32x4_sub(f32_q, off), s);

      v128_t mag = wasm_f32x4_sqrt(wasm_f32x4_add(
         wasm_f32x4_mul(f32_i, f32_i),
         wasm_f32x4_mul(f32_q, f32_q)
      ));

      wasm_v128_store(output + i, mag);
   }
#endif

   for (; i < count; i++)
   {
      float fi = (float)(input[i * 2] - 2048) * scale;
      float fq = (float)(input[i * 2 + 1] - 2048) * scale;
      output[i] = sqrtf(fi * fi + fq * fq);
   }

   return count;
}

// ── Stateful IQ processor (DC removal + Fs/4 + FIR + delay + magnitude) ─

typedef struct
{
   float avg;

   float firQueue[FIR_QUEUE_LEN];
   int firIndex;

   float delayLine[HALF_LEN];
   int delayIndex;

   float *tempBuf;
   int tempBufSize;
} IqProcessor;

void *iq_processor_create()
{
   IqProcessor *p = (IqProcessor *)calloc(1, sizeof(IqProcessor));
   if (!p) return 0;
   p->tempBuf = 0;
   p->tempBufSize = 0;
   return p;
}

void iq_processor_destroy(void *ptr)
{
   if (ptr)
   {
      IqProcessor *p = (IqProcessor *)ptr;
      free(p->tempBuf);
      free(p);
   }
}

int iq_processor_process(void *ptr, const int16_t *input, float *output, int count)
{
   if (!ptr || !input || !output || count <= 0)
      return 0;

   IqProcessor *p = (IqProcessor *)ptr;

   const float scale = 1.0f / 2048.0f;
   const int total = count * 2; // number of raw int16 samples (I,Q pairs)

   // Pre-allocate temp buffer (grow if needed, never shrink)
   if (total > p->tempBufSize)
   {
      p->tempBuf = (float *)realloc(p->tempBuf, (size_t)total * sizeof(float));
      p->tempBufSize = total;
   }
   float *f32 = p->tempBuf;
   if (!f32) return 0;

   // 1. int16 → float32 with DC removal, merged with Fs/4 rotation
   float avg = p->avg;
   const float hbc = HBC;
   int i = 0;
   for (; i + 4 <= total; i += 4)
   {
      float v0 = (float)(input[i+0] - 2048) * scale; v0 -= avg; avg += 0.01f * v0; f32[i+0] = -v0;
      float v1 = (float)(input[i+1] - 2048) * scale; v1 -= avg; avg += 0.01f * v1; f32[i+1] = -v1 * hbc;
      float v2 = (float)(input[i+2] - 2048) * scale; v2 -= avg; avg += 0.01f * v2; f32[i+2] = v2;
      float v3 = (float)(input[i+3] - 2048) * scale; v3 -= avg; avg += 0.01f * v3; f32[i+3] = v3 * hbc;
   }
   for (; i < total; i++)
   {
      float v = (float)(input[i] - 2048) * scale;
      v -= avg;
      avg += 0.01f * v;
      f32[i] = v;
   }
   p->avg = avg;

   // Symmetric half-band FIR on I channel (even indices)
   {
      int firIndex = p->firIndex;
      float *firQueue = p->firQueue;

      for (int i = 0; i < total; i += 2)
      {
         int qBase = firIndex;
         firQueue[qBase] = f32[i];

         float acc = 0;
         for (int k = 0; k < HALF_LEN; k++)
            acc += HB_KERNEL[k] * (firQueue[qBase + k] + firQueue[qBase + FIR_LEN - 1 - k]);

         f32[i] = acc;

         firIndex--;
         if (firIndex < 0)
         {
            firIndex = FIR_LEN * (SIZE_FACTOR - 1);
            memmove(firQueue + firIndex + 1, firQueue, (FIR_LEN - 1) * sizeof(float));
         }
      }

      p->firIndex = firIndex;
   }

   // Delay Q channel (odd indices) by HALF_LEN
   {
      int delayIndex = p->delayIndex;
      float *delayLine = p->delayLine;

      for (int i = 1; i < total; i += 2)
      {
         float res = delayLine[delayIndex];
         delayLine[delayIndex] = f32[i];
         f32[i] = res;

         delayIndex++;
         if (delayIndex >= HALF_LEN)
            delayIndex = 0;
      }

      p->delayIndex = delayIndex;
   }

   // 3. Magnitude: sqrt(I² + Q²)
   for (int i = 0; i < count; i++)
   {
      float fi = f32[i * 2];
      float fq = f32[i * 2 + 1];
      output[i] = sqrtf(fi * fi + fq * fq);
   }

   return count;
}

}
