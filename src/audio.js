// Procedural sound effects via the Web Audio API — no audio files needed.
// All sounds are synthesized (noise bursts + oscillators) on the fly.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  // Must be called from a user gesture (deploy click) to satisfy autoplay rules.
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // One reusable second of white noise.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  _noise(dur, { type = "lowpass", freq = 1500, q = 1, gain = 0.8, vol = 1 } = {}) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, { type = "sine", gain = 0.3, vol = 1, slideTo = null, delay = 0 } = {}) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  shoot(kind = "rifle", vol = 1) {
    if (!this.ctx) return;
    const rifle = kind === "rifle";
    // Crack (filtered noise) + low thump body.
    this._noise(rifle ? 0.13 : 0.1, {
      type: "lowpass",
      freq: rifle ? 2200 : 1500,
      gain: 0.9,
      vol,
    });
    this._tone(rifle ? 140 : 180, 0.1, { type: "square", gain: 0.25, vol, slideTo: 60 });
  }

  hit(vol = 1) {
    if (!this.ctx) return;
    this._tone(1400, 0.05, { type: "sine", gain: 0.25, vol });
  }

  kill(vol = 1) {
    if (!this.ctx) return;
    this._tone(880, 0.08, { type: "sine", gain: 0.3, vol });
    this._tone(1320, 0.12, { type: "sine", gain: 0.3, vol, delay: 0.07 });
  }

  reload(vol = 1) {
    if (!this.ctx) return;
    // Two mechanical clicks.
    this._noise(0.05, { type: "bandpass", freq: 1800, q: 4, gain: 0.5, vol });
    this._noise(0.06, { type: "bandpass", freq: 1200, q: 4, gain: 0.5, vol });
    setTimeout(() => this._noise(0.05, { type: "bandpass", freq: 2000, q: 4, gain: 0.5, vol }), 220);
  }

  hurt(vol = 1) {
    if (!this.ctx) return;
    this._noise(0.18, { type: "lowpass", freq: 700, gain: 0.5, vol });
    this._tone(180, 0.16, { type: "sawtooth", gain: 0.2, vol, slideTo: 90 });
  }

  death(vol = 1) {
    if (!this.ctx) return;
    this._tone(400, 0.6, { type: "sawtooth", gain: 0.3, vol, slideTo: 70 });
  }
}
