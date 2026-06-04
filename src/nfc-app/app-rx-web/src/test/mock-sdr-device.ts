import type { SdrDevice, SdrDeviceInfo, GainControl, GainMode } from '../sdr-device';

export class MockSdrDevice implements SdrDevice {
  readonly deviceType = 'mock';
  readonly sampleRates = [10000000];
  readonly sampleFormat = 'int16' as const;
  readonly gainControls: GainControl[] = [];
  readonly gainModes: GainMode[] = [];

  private sampleData: Int16Array;

  constructor(iqData: Int16Array) {
    this.sampleData = iqData;
  }

  async open(_device: USBDevice): Promise<void> {}

  async close(): Promise<void> {}

  async getInfo(): Promise<SdrDeviceInfo> {
    return { name: 'Mock SDR', serial: 'mock-001' };
  }

  async setSampleRate(_rate: number): Promise<void> {}

  async setFrequency(_freqHz: number): Promise<void> {}

  async setGain(_name: string, _value: number): Promise<void> {}

  async startRx(callback: (data: ArrayBufferView) => void): Promise<void> {
    const chunkSize = 32768;
    for (let i = 0; i < this.sampleData.length; i += chunkSize) {
      const chunk = this.sampleData.slice(i, i + chunkSize);
      callback(new Uint8Array(chunk.buffer));
    }
  }

  async stopRx(): Promise<void> {}
}
