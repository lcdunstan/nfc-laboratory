export function wavToMockIq(wavFloats: Float32Array, sampleRate: number): Int16Array {
  const fc = 13560000; // NFC carrier frequency
  const iq = new Int16Array(wavFloats.length * 2);

  for (let t = 0; t < wavFloats.length; t++) {
    const phase = 2 * Math.PI * fc * t / sampleRate;
    const mag = wavFloats[t];

    // Scale to 12-bit range (Airspy format), store in int16
    iq[t * 2]     = Math.round(mag * Math.cos(phase) * 2047) << 4;
    iq[t * 2 + 1] = Math.round(mag * Math.sin(phase) * 2047) << 4;
  }

  return iq;
}
