import type { SdrDevice, SdrDeviceInfo, GainControl, GainMode } from '../sdr-device';
import { iqToMagnitude } from '../iq-to-magnitude';

// Native Airspy vendor request numbers (airspy_commands.h)
const AIRSPY_RECEIVER_MODE   = 1;
const AIRSPY_SET_SAMPLERATE  = 12;
const AIRSPY_SET_FREQ        = 13;
const AIRSPY_SET_LNA_GAIN    = 14;
const AIRSPY_SET_MIXER_GAIN  = 15;
const AIRSPY_SET_VGA_GAIN    = 16;
const AIRSPY_SET_LNA_AGC     = 17;
const AIRSPY_SET_MIXER_AGC   = 18;
const AIRSPY_GPIO_WRITE      = 21;
const AIRSPY_SET_PACKING     = 26;

const GPIO_PORT1 = 1;
const GPIO_PIN13 = 13;

// Matches libairspy's GAIN_COUNT, linearity/sensitivity lookup tables (airspy.c)
const GAIN_COUNT = 22;

const linearityLnaGains: number[] =    [14,14,14,13,12,10, 9, 9, 8, 9, 8, 6,5,3,1,0,0,0,0,0,0,0];
const linearityMixerGains: number[] =  [12,12,11, 9, 8, 7, 6, 6, 5, 0, 0, 1,0,0,2,2,1,1,1,1,0,0];
const linearityVgaGains: number[] =    [13,12,11,11,11,11,11,10,10,10,10,10,10,10,10,10,9,8,7,6,5,4];
const sensitivityLnaGains: number[] =  [14,14,14,14,14,14,14,14,14,13,12,12,9,9,8,7,6,5,3,2,1,0];
const sensitivityMixerGains: number[] =[12,12,12,12,11,10,10, 9, 9, 8, 7, 4,4,4,3,2,2,1,0,0,0,0];
const sensitivityVgaGains: number[] =  [13,12,11,10, 9, 8, 7, 6, 5, 5, 5, 5,5,4,4,4,4,4,4,4,4,4];

const gainControls: GainControl[] = [
  { name: 'LNA', min: 0, max: 14, step: 1, defaultValue: 6 },
  { name: 'Mixer', min: 0, max: 15, step: 1, defaultValue: 6 },
  { name: 'VGA', min: 0, max: 15, step: 1, defaultValue: 6 },
];

const gainModes: GainMode[] = [
  { value: 0, name: 'Auto' },
  { value: 1, name: 'Linearity' },
  { value: 2, name: 'Sensitivity' },
];

export class AirspyDevice implements SdrDevice {
  readonly deviceType = 'airspy';
  // All common Airspy rates. Native libairspy matches against firmware's
  // supported_samplerates table; if not found, it falls through to a kHz
  // calculation (rate × 2 / 1000 for IQ), letting the PLL tune to arbitrary
  // values. We include the two standard tables plus extras — the FW picks.
  readonly sampleRates = [10000000, 6000000, 3000000, 2500000];
  readonly sampleFormat = 'int16' as const;
  readonly gainControls = gainControls;
  readonly gainModes = gainModes;

  private device: USBDevice | null = null;
  private rxRunning = false;
  private abortController: AbortController | null = null;
  private currentGainMode: number = 1;
  private _loggedSizes = 0;

  async open(device: USBDevice): Promise<void> {
    this.device = device;
    await this.device.open();

    // NOTE: Do NOT call device.reset() — native libairspy doesn't reset the
    // device, and resetting can leave the firmware in an unexpected state.
    // A simple open + selectConfiguration + claimInterface is sufficient.
    await this.device.selectConfiguration(1);
    await this.device.claimInterface(0);

    // Disable packing (matches native libairspy behavior)
    await this.controlIn(AIRSPY_SET_PACKING, 0, 0);
  }

  async close(): Promise<void> {
    await this.stopRx();
    if (this.device) {
      try { await this.device.releaseInterface(0); } catch { /* ignore */ }
      try { await this.device.close(); } catch { /* ignore */ }
      this.device = null;
    }
  }

  async getInfo(): Promise<SdrDeviceInfo> {
    return { name: 'Airspy', serial: this.device?.serialNumber || 'unknown' };
  }

  async setSampleRate(rate: number): Promise<void> {
    // Always use the kHz fallback path (rate × 2 / 1000 for IQ) instead of
    // passing a firmware index.  The index method would require knowing the
    // exact device model (Mini vs R2) since their supported_samplerates
    // arrays differ.  The kHz method works universally and matches native
    // libairspy's behavior for unsupported rates (airspy.c:1050).
    const khz = Math.floor(rate * 2 / 1000);
    await this.controlIn(AIRSPY_SET_SAMPLERATE, 0, khz);
  }

  async setFrequency(freqHz: number): Promise<void> {
    // Native: OUT transfer with 4-byte LE freq data payload
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, freqHz, true);
    await this.controlOut(AIRSPY_SET_FREQ, 0, 0, buf);
  }

  async setGain(name: string, value: number): Promise<void> {
    let request: number;
    switch (name) {
      case 'LNA':   request = AIRSPY_SET_LNA_GAIN; break;
      case 'Mixer': request = AIRSPY_SET_MIXER_GAIN; break;
      case 'VGA':   request = AIRSPY_SET_VGA_GAIN; break;
      default: throw new Error(`Unknown gain: ${name}`);
    }
    // Native: IN transfer with wIndex = value
    await this.controlIn(request, 0, value);
  }

  async setGainMode(mode: number): Promise<void> {
    this.currentGainMode = mode;
  }

  async setTunerAgc(enabled: boolean): Promise<void> {
    await this.controlIn(AIRSPY_SET_LNA_AGC, 0, enabled ? 1 : 0);
  }

  async setMixerAgc(enabled: boolean): Promise<void> {
    await this.controlIn(AIRSPY_SET_MIXER_AGC, 0, enabled ? 1 : 0);
  }

  // Matches libairspy airspy_set_linearity_gain / airspy_set_sensitivity_gain:
  // inverts value (GAIN_COUNT - 1 - value), then looks up LNA/Mixer/VGA from tables
  async setGainValue(value: number): Promise<void> {
    const idx = GAIN_COUNT - 1 - Math.min(value, GAIN_COUNT - 1);
    let lna: number, mix: number, vga: number;
    if (this.currentGainMode === 2) {
      lna = sensitivityLnaGains[idx];
      mix = sensitivityMixerGains[idx];
      vga = sensitivityVgaGains[idx];
    } else {
      lna = linearityLnaGains[idx];
      mix = linearityMixerGains[idx];
      vga = linearityVgaGains[idx];
    }
    await this.setGain('LNA', lna);
    await this.setGain('Mixer', mix);
    await this.setGain('VGA', vga);
  }

  async setBiasTee(enabled: boolean): Promise<void> {
    // Native: GPIO_WRITE via airspy_gpio_write(port=GPIO_PORT1, pin=GPIO_PIN13, value)
    const portPin = (GPIO_PORT1 << 5) | GPIO_PIN13;
    await this.controlOut(AIRSPY_GPIO_WRITE, enabled ? 1 : 0, portPin);
  }

  async startRx(callback: (data: ArrayBufferView) => void): Promise<void> {
    if (!this.device) throw new Error('Device not opened');

    // Match native airspy_start_rx sequence:
    //   1. RECEIVER_MODE=OFF to reset state
    //   2. clear halt on bulk IN endpoint (clears stalled endpoint from prior session)
    //   3. RECEIVER_MODE=RX to start streaming
    await this.controlOut(AIRSPY_RECEIVER_MODE, 0, 0);
    try {
      await this.device.clearHalt('in', this.getBulkInEndpoint());
    } catch { /* some devices may not need clearHalt */ }
    await this.controlOut(AIRSPY_RECEIVER_MODE, 1, 0);

    // Give firmware time to complete RX mode transition before any control/bulk xfers
    await new Promise(resolve => setTimeout(resolve, 150));

    this.rxRunning = true;
    this.abortController = new AbortController();

    const ep = this.getBulkInEndpoint();

    // Start pump in background (don't await — startRx returns so caller can
    // set bias tee / gains after RECEIVER_MODE=RX without blocking forever).
    this.runPump(ep, callback).catch(err => {
      console.error('[airspy] pump terminated:', err);
      this.rxRunning = false;
    });
  }

  private async runPump(ep: number, callback: (data: ArrayBufferView) => void): Promise<void> {
    const DEPTH = 8;
    let lastError: string | null = null;

    const pumpOne = () => {
      if (!this.rxRunning) return;
      this.device!.transferIn(ep, 262144).then(result => {
        if (!this.rxRunning) return;

        if (result.data && result.data.byteLength > 0) {
          if (!this._loggedSizes) {
            console.log(`[airspy] first 3 transfer sizes:`, result.data.byteLength);
            this._loggedSizes = 1;
          } else if (this._loggedSizes < 3) {
            console.log(`[airspy] transfer size #${this._loggedSizes + 1}:`, result.data.byteLength);
            this._loggedSizes++;
          }
          callback(result.data);
        }
        lastError = null;
        // Re-seed immediately — keeps the pipeline saturated
        pumpOne();
      }).catch(err => {
        if (!this.rxRunning) return;
        const msg = String(err);
        if (msg !== lastError) {
          console.error('[airspy] pump error:', msg);
          lastError = msg;
        }
        // Retry after a short delay on error
        setTimeout(pumpOne, 10);
      });
    };

    // Seed the pipeline with DEPTH concurrent transfers
    for (let i = 0; i < DEPTH; i++) pumpOne();

    // Wait until stopped
    while (this.rxRunning) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  async stopRx(): Promise<void> {
    this.rxRunning = false;
    this.abortController?.abort();
    this.abortController = null;
    if (this.device) {
      try {
        await this.controlOut(AIRSPY_RECEIVER_MODE, 0, 0);
      } catch { /* ignore */ }
    }
  }

  private getBulkInEndpoint(): number {
    if (!this.device) throw new Error('Device not opened');
    const iface = this.device.configuration?.interfaces?.[0];
    if (!iface) throw new Error('No interface');
    const alt = iface.alternates?.[0];
    if (!alt) throw new Error('No alternate');
    const ep = alt.endpoints?.find((e) => e.direction === 'in' && e.type === 'bulk');
    if (!ep) throw new Error('No bulk IN endpoint');
    return ep.endpointNumber;
  }

  // OUT transfer: host-to-device (bmRequestType = 0x40)
  private async controlOut(request: number, value: number, index: number, data?: BufferSource): Promise<void> {
    if (!this.device) throw new Error('Device not opened');
    const desc = this.describeRequest(request);
    let dataHex = '';
    if (data) {
      const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
      dataHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }
    console.log(`[USB-OUT] ${desc}: bmRq=0x40 bReq=${request} wVal=0x${value.toString(16)} wIdx=0x${index.toString(16)} data=${dataHex || '(none)'}`);
    await this.device.controlTransferOut(
      { requestType: 'vendor', recipient: 'device', request, value, index },
      data,
    );
  }

  // IN transfer: device-to-host (bmRequestType = 0xC0), discards returned data
  private async controlIn(request: number, value: number, index: number): Promise<void> {
    if (!this.device) throw new Error('Device not opened');
    const desc = this.describeRequest(request);
    console.log(`[USB-IN]  ${desc}: bmRq=0xC0 bReq=${request} wVal=0x${value.toString(16)} wIdx=0x${index.toString(16)}`);
    await this.device.controlTransferIn(
      { requestType: 'vendor', recipient: 'device', request, value, index },
      1, // read 1 byte (matching native `&retval` with length=1)
    );
  }

  private describeRequest(request: number): string {
    const names: Record<number, string> = {
      1: 'RECEIVER_MODE', 12: 'SET_SAMPLERATE', 13: 'SET_FREQ',
      14: 'SET_LNA_GAIN', 15: 'SET_MIXER_GAIN', 16: 'SET_VGA_GAIN',
      17: 'SET_LNA_AGC', 18: 'SET_MIXER_AGC', 20: 'SET_RF_BIAS',
      21: 'GPIO_WRITE', 26: 'SET_PACKING',
    };
    return names[request] ?? `UNKNOWN(${request})`;
  }

  static iqToMagnitude(data: ArrayBufferView): Float32Array {
    const int16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
    return iqToMagnitude(int16);
  }
}
