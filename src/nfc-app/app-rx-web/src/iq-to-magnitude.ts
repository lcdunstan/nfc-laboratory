export function iqToMagnitude(iq: Int16Array): Float32Array {
  const out = new Float32Array(iq.length / 2);
  for (let i = 0; i < out.length; i++) {
    const fi = (iq[i * 2] - 2048) / 2048;
    const fq = (iq[i * 2 + 1] - 2048) / 2048;
    out[i] = Math.sqrt(fi * fi + fq * fq);
  }
  return out;
}
