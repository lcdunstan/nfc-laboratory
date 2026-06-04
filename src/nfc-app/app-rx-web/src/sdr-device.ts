export interface SdrDeviceInfo {
  name: string;
  serial: string;
}

export interface GainControl {
  name: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface GainMode {
  value: number;
  name: string;
}

export interface SdrDevice {
  readonly deviceType: string;
  readonly sampleRates: number[];
  readonly sampleFormat: 'int8' | 'int16' | 'float32';
  readonly gainControls: GainControl[];
  readonly gainModes: GainMode[];

  open(device: USBDevice): Promise<void>;
  close(): Promise<void>;
  getInfo(): Promise<SdrDeviceInfo>;

  setSampleRate(rate: number): Promise<void>;
  setFrequency(freqHz: number): Promise<void>;
  setGain(name: string, value: number): Promise<void>;

  setGainMode?(mode: number): Promise<void>;
  setGainValue?(value: number): Promise<void>;
  setTunerAgc?(enabled: boolean): Promise<void>;
  setMixerAgc?(enabled: boolean): Promise<void>;
  setBiasTee?(enabled: boolean): Promise<void>;

  startRx(callback: (data: ArrayBufferView) => void): Promise<void>;
  stopRx(): Promise<void>;
}
