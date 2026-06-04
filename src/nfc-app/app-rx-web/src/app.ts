import type { NfcFrame } from './decoder';
import type { SdrDevice, GainMode } from './sdr-device';
import { deviceCatalog, findDeviceByUsb } from './device-catalog';
import { startRx, stopRx, startRecording, startRecordingRaw, isRecordingActive, isRecordingRawActive, feedWav, stopRecordingRaw, getWaveformData } from './backend';

export class App {
  private frameLog: HTMLElement;
  private statusEl: HTMLElement;
  private startBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private recordBtn: HTMLButtonElement;
  private recordRawBtn: HTMLButtonElement;
  private freqInput: HTMLInputElement;
  private rateSelect: HTMLSelectElement;
  private deviceSelect: HTMLSelectElement;
  private biasTeeInput: HTMLInputElement;
  private recordDurationInput: HTMLInputElement;
  private gainModeSelect: HTMLSelectElement;
  private gainValueInput: HTMLInputElement;
  private gainValueLabel: HTMLSpanElement;
  private tunerAgcInput: HTMLInputElement;
  private mixerAgcInput: HTMLInputElement;
  private iqConverterInput: HTMLInputElement;
  private wavFileInput: HTMLInputElement;
  private waveformCanvas: HTMLCanvasElement;
  private deviceDriver: SdrDevice | null = null;
  private currentSampleRate = 0;

  constructor() {
    this.frameLog = document.getElementById('frame-log')!;
    this.statusEl = document.getElementById('status')!;
    this.startBtn = document.getElementById('btn-start') as HTMLButtonElement;
    this.stopBtn = document.getElementById('btn-stop') as HTMLButtonElement;
    this.recordBtn = document.getElementById('btn-record') as HTMLButtonElement;
    this.recordRawBtn = document.getElementById('btn-record-raw') as HTMLButtonElement;
    this.freqInput = document.getElementById('freq') as HTMLInputElement;
    this.rateSelect = document.getElementById('sample-rate') as HTMLSelectElement;
    this.deviceSelect = document.getElementById('device-select') as HTMLSelectElement;
    this.biasTeeInput = document.getElementById('bias-tee') as HTMLInputElement;
    this.recordDurationInput = document.getElementById('record-duration') as HTMLInputElement;
    this.gainModeSelect = document.getElementById('gain-mode') as HTMLSelectElement;
    this.gainValueInput = document.getElementById('gain-value') as HTMLInputElement;
    this.gainValueLabel = document.getElementById('gain-value-label') as HTMLSpanElement;
    this.tunerAgcInput = document.getElementById('tuner-agc') as HTMLInputElement;
    this.mixerAgcInput = document.getElementById('mixer-agc') as HTMLInputElement;
    this.iqConverterInput = document.getElementById('iq-converter') as HTMLInputElement;
    this.wavFileInput = document.getElementById('wav-file') as HTMLInputElement;
    this.waveformCanvas = document.getElementById('waveform') as HTMLCanvasElement;

    this.populateDeviceList();
    this.populateGainMode([
      { value: 0, name: 'Auto' },
      { value: 1, name: 'Linearity' },
      { value: 2, name: 'Sensitivity' },
    ], 1);
    this.bindEvents();
    //this.startWaveformLoop();
  }

  private populateDeviceList(): void {
    for (const entry of deviceCatalog) {
      const opt = document.createElement('option');
      opt.value = entry.deviceType;
      opt.textContent = entry.name;
      this.deviceSelect.appendChild(opt);
    }
  }

  private bindEvents(): void {
    this.startBtn.addEventListener('click', () => this.start());
    this.stopBtn.addEventListener('click', () => this.stop());
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.recordRawBtn.addEventListener('click', () => this.toggleRecordingRaw());

    this.gainValueInput.addEventListener('input', () => {
      this.gainValueLabel.textContent = this.gainValueInput.value;
    });

    this.wavFileInput.addEventListener('change', () => this.loadWav());
  }

  private async loadWav(): Promise<void> {
    const file = this.wavFileInput.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    this.setStatus(`Loading WAV: ${file.name}...`);
    try {
      await feedWav(buf, (frame) => this.appendFrame(frame), (state, error) => {
        if (state === 'connected') this.setStatus(`WAV loaded: ${file.name}`);
        else if (state === 'error') this.setStatus(`WAV error: ${error}`);
      });
    } catch (err) {
      this.setStatus(`WAV error: ${err}`);
    }
  }

  private async start(): Promise<void> {
    try {
      const vendorId = 0x1d50;
      const productId = 0x60a1;

      const usbDevice = await navigator.usb.requestDevice({
        filters: [{ vendorId, productId }],
      });

      const entry = findDeviceByUsb(usbDevice);
      if (!entry) {
        this.setStatus('Unsupported device');
        return;
      }

      // Dynamic import of the device driver
      let deviceDriver: SdrDevice;
      if (entry.deviceType === 'airspy') {
        const { AirspyDevice } = await import('./devices/airspy');
        deviceDriver = new AirspyDevice();
      } else {
        this.setStatus(`Unknown device type: ${entry.deviceType}`);
        return;
      }

      await deviceDriver.open(usbDevice);

      // Populate gain controls, preserve selected mode (default: Linearity)
      const prevGainMode = this.gainModeSelect.value;
      this.populateGainMode(deviceDriver.gainModes);
      if (prevGainMode) this.gainModeSelect.value = prevGainMode;

      // Apply gain mode
      const gainMode = parseInt(this.gainModeSelect.value, 10);
      if (deviceDriver.setGainMode) {
        await deviceDriver.setGainMode(gainMode);
      }

      // Linearity/Sensitivity: set combined gain value (0-21)
      // Auto: gain slider is ignored by hardware
      if (gainMode !== 0 && deviceDriver.setGainValue) {
        await deviceDriver.setGainValue(parseInt(this.gainValueInput.value, 10));
      }

      // Apply AGC state (independent of gain mode)
      if (deviceDriver.setTunerAgc) {
        await deviceDriver.setTunerAgc(this.tunerAgcInput.checked);
      }
      if (deviceDriver.setMixerAgc) {
        await deviceDriver.setMixerAgc(this.mixerAgcInput.checked);
      }

      if (this.biasTeeInput.checked && deviceDriver.setBiasTee) {
        await deviceDriver.setBiasTee(true);
      }

      this.deviceDriver = deviceDriver;
      this.startBtn.disabled = true;
      this.stopBtn.disabled = false;
      this.recordBtn.disabled = false;
      this.recordRawBtn.disabled = false;
      this.setStatus('Starting...');

      const freqHz = parseInt(this.freqInput.value, 10) || 13560000;
      const sampleRate = parseInt(this.rateSelect.value, 10) || 10000000;
      this.currentSampleRate = sampleRate;

      await deviceDriver.setSampleRate(sampleRate);
      await deviceDriver.setFrequency(freqHz);

      await startRx(
        deviceDriver,
        sampleRate,
        this.iqConverterInput.checked,
        (frame) => this.appendFrame(frame),
        (state, msg) => {
          if (state === 'connected') this.setStatus('Connected');
          else if (state === 'error') this.setStatus(`Error: ${msg}`);
          else if (state === 'disconnected') this.setStatus('Disconnected');
          else if (state === 'timing') this.setStatus(msg + '');
        },
      );

    } catch (err) {
      this.setStatus(`Error: ${err}`);
    }
  }

  private stop(): void {
    stopRx();
    if (this.deviceDriver) {
      this.deviceDriver.stopRx();
      this.deviceDriver.close().catch(() => {});
      this.deviceDriver = null;
    }
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;
    this.recordBtn.disabled = true;
    this.recordRawBtn.disabled = true;
    this.recordBtn.classList.remove('recording');
    this.recordBtn.textContent = 'Record';
    this.recordRawBtn.classList.remove('recording');
    this.recordRawBtn.textContent = 'Record IQ';
    this.setStatus('Stopped');
  }

  private toggleRecording(): void {
    if (isRecordingActive()) {
      stopRx();
      this.stop();
    } else {
      const dur = parseInt(this.recordDurationInput.value, 10) || 5;
      const sampleRate = this.currentSampleRate;
      this.recordBtn.textContent = 'Recording\u2026';
      this.recordBtn.classList.add('recording');
      this.recordDurationInput.disabled = true;
      this.setStatus(`Recording ${dur}s\u2026`);

      startRecording(dur, sampleRate, (blob) => {
        this.recordBtn.classList.remove('recording');
        this.recordBtn.textContent = 'Record';
        this.recordDurationInput.disabled = false;
        this.setStatus(`Recorded ${(blob.size / 1024 / 1024).toFixed(1)} MB \u2014 downloading\u2026`);

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nfc-capture-${Date.now()}.wav`;
        a.click();
        URL.revokeObjectURL(url);

        setTimeout(() => this.setStatus('Connected'), 2000);
      });
    }
  }

  private toggleRecordingRaw(): void {
    if (isRecordingRawActive()) {
      stopRecordingRaw();
      this.recordRawBtn.classList.remove('recording');
      this.recordRawBtn.textContent = 'Record IQ';
      this.recordDurationInput.disabled = false;
    } else {
      const dur = parseInt(this.recordDurationInput.value, 10) || 5;
      const sampleRate = this.currentSampleRate;
      this.recordRawBtn.textContent = 'Recording IQ\u2026';
      this.recordRawBtn.classList.add('recording');
      this.recordDurationInput.disabled = true;
      this.setStatus(`Recording raw IQ ${dur}s\u2026`);

      startRecordingRaw(dur, sampleRate, (blob) => {
        this.recordRawBtn.classList.remove('recording');
        this.recordRawBtn.textContent = 'Record IQ';
        this.recordDurationInput.disabled = false;
        this.setStatus(`Recorded ${(blob.size / 1024 / 1024).toFixed(1)} MB IQ \u2014 downloading\u2026`);

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nfc-capture-raw-${Date.now()}.wav`;
        a.click();
        URL.revokeObjectURL(url);

        setTimeout(() => this.setStatus('Connected'), 2000);
      });
    }
  }

  private startWaveformLoop(): void {
    const canvas = this.waveformCanvas;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const midY = H / 2;

    const draw = () => {
      requestAnimationFrame(draw);
      const data = getWaveformData();

      ctx.clearRect(0, 0, W, H);

      // Find min/max for auto-scale
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }

      const range = Math.max(max - min, 0.001);
      const scale = (H * 0.9) / range;
      const yBase = H * 0.95 - (min * scale);

      // Grid lines
      ctx.strokeStyle = '#1a1a3e';
      ctx.lineWidth = 1;
      for (let y = 0; y < H; y += H / 4) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Signal line
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x < W && x < data.length; x++) {
        const y = yBase - data[x] * scale;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Label
      ctx.fillStyle = '#666';
      ctx.font = '10px monospace';
      ctx.fillText(`mag [${min.toFixed(4)}, ${max.toFixed(4)}]`, 4, 12);
    };
    draw();
  }

  private lastCarrierOffTime = 0;

  private appendFrame(frame: NfcFrame): void {
    // Rate-limit CarrierOff to once per 500ms
    if (frame.frameType === 0x0100) {
      const now = performance.now();
      if (now - this.lastCarrierOffTime < 500) return;
      this.lastCarrierOffTime = now;
    }

    const line = document.createElement('div');
    line.className = 'frame-line';
    line.textContent = this.formatFrame(frame);
    this.frameLog.appendChild(line);
    this.frameLog.scrollTop = this.frameLog.scrollHeight;
  }

  private formatFrame(frame: NfcFrame): string {
    const techMap: Record<number, string> = {
      0x0101: 'NfcA',
      0x0102: 'NfcB',
      0x0103: 'NfcF',
      0x0104: 'NfcV',
    };
    const typeMap: Record<number, string> = {
      0x0100: 'CarrierOff',
      0x0101: 'CarrierOn',
      0x0102: 'Poll',
      0x0103: 'Listen',
    };

    const tech = techMap[frame.techType] || 'UNKNOWN';
    const type = typeMap[frame.frameType] || 'UNKNOWN';
    const time = frame.timeStart.toFixed(4);
    const rate = frame.frameRate ? `${(frame.frameRate / 1000).toFixed(0)}k` : '?';
    return `${time} (${type}) [${tech}@${rate}]: ${frame.frameData}`;
  }

  private populateGainMode(modes: GainMode[], selectedValue: number = 0): void {
    this.gainModeSelect.innerHTML = '';
    for (const m of modes) {
      const opt = document.createElement('option');
      opt.value = String(m.value);
      opt.textContent = m.name;
      if (m.value === selectedValue) opt.selected = true;
      this.gainModeSelect.appendChild(opt);
    }
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
  }
}
