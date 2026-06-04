export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float32Array;
}

export function parseWav(buffer: ArrayBuffer | ArrayBufferView): WavInfo {
  const view = buffer instanceof ArrayBuffer
    ? new DataView(buffer)
    : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a RIFF file');

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') throw new Error('Not a WAVE file');

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataLength = 0;

  let offset = 12;
  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      const audioFormat = view.getUint16(offset + 8, true);
      if (audioFormat !== 1) throw new Error('Unsupported WAV audio format: ' + audioFormat);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
    }

    offset += 8 + chunkSize;
  }

  if (sampleRate === 0 || channels === 0 || bitsPerSample === 0) throw new Error('Invalid WAV: missing fmt chunk');
  if (dataLength === 0) throw new Error('Invalid WAV: missing data chunk');

  const totalSamples = dataLength / (bitsPerSample / 8) / channels;
  const result = new Float32Array(totalSamples);

  if (bitsPerSample === 16) {
    for (let i = 0; i < totalSamples; i++) {
      const int16 = view.getInt16(dataOffset + i * channels * 2, true);
      result[i] = int16 / 32768.0;
    }
  } else if (bitsPerSample === 8) {
    for (let i = 0; i < totalSamples; i++) {
      result[i] = (view.getUint8(dataOffset + i * channels) - 128) / 128.0;
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < totalSamples; i++) {
      result[i] = view.getFloat32(dataOffset + i * channels * 4, true);
    }
  } else {
    throw new Error(`Unsupported bits per sample: ${bitsPerSample}`);
  }

  return { sampleRate, channels, bitsPerSample, samples: result };
}
