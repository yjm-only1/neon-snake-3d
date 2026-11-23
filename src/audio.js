// WebAudio 合成音效与背景音乐：零音频素材，全部由振荡器/噪声实时生成
export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.musicPlaying = false;
    this.musicTimer = null;
    this.musicGain = null;
    this.step = 0;
    this.nextNoteTime = 0;
    this.bpm = 96;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setSettings(settings) {
    this.settings = settings;
    if (!settings.music) this.stopMusic();
  }

  tone({ freq, type = 'sine', dur = 0.12, gain = 0.18, slideTo = null, when = 0 }) {
    const ctx = this.ensure();
    if (!ctx || !this.settings.sfx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(25, slideTo), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  noise({ dur = 0.18, gain = 0.15, when = 0, freq = 1200, q = 0.8 }) {
    const ctx = this.ensure();
    if (!ctx || !this.settings.sfx) return;
    if (!this.noiseBuffer) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  eat(combo) {
    const freq = 480 + Math.min(combo, 6) * 70;
    this.tone({ freq, type: 'square', dur: 0.08, gain: 0.12 });
    if (combo >= 3) this.tone({ freq: freq * 1.5, type: 'square', dur: 0.07, gain: 0.07, when: 0.05 });
  }

  gold() {
    this.tone({ freq: 880, type: 'triangle', dur: 0.1, gain: 0.16 });
    this.tone({ freq: 1174.7, type: 'triangle', dur: 0.12, gain: 0.14, when: 0.08 });
    this.tone({ freq: 1568, type: 'triangle', dur: 0.16, gain: 0.12, when: 0.16 });
  }

  buff(kind) {
    if (kind === 'slow') {
      this.tone({ freq: 620, type: 'sine', dur: 0.3, gain: 0.14, slideTo: 260 });
    } else if (kind === 'double') {
      this.tone({ freq: 520, type: 'sine', dur: 0.12, gain: 0.13 });
      this.tone({ freq: 780, type: 'sine', dur: 0.16, gain: 0.13, when: 0.09 });
    } else if (kind === 'shield') {
      this.tone({ freq: 392, type: 'triangle', dur: 0.18, gain: 0.12 });
      this.tone({ freq: 587.3, type: 'triangle', dur: 0.22, gain: 0.12, when: 0.06 });
    }
  }

  shieldBreak() {
    this.noise({ dur: 0.25, gain: 0.2, freq: 900, q: 0.6 });
    this.tone({ freq: 660, type: 'sawtooth', dur: 0.35, gain: 0.12, slideTo: 180 });
  }

  death() {
    this.tone({ freq: 240, type: 'sawtooth', dur: 0.7, gain: 0.18, slideTo: 36 });
    this.noise({ dur: 0.5, gain: 0.18, freq: 320, q: 0.5 });
  }

  ui() {
    this.tone({ freq: 740, type: 'square', dur: 0.045, gain: 0.06 });
  }

  newRecord() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => this.tone({ freq, type: 'triangle', dur: 0.16, gain: 0.13, when: i * 0.1 }));
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || !this.settings.music || this.musicPlaying) return;
    this.musicPlaying = true;
    this.step = 0;
    this.nextNoteTime = ctx.currentTime + 0.08;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.13;
    this.musicGain.connect(this.master);
    this.musicTimer = setInterval(() => this.scheduleMusic(), 60);
  }

  setIntensity(bpm) {
    this.bpm = Math.max(88, Math.min(168, bpm));
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.musicGain) {
      try { this.musicGain.disconnect(); } catch (err) { /* 已断开 */ }
      this.musicGain = null;
    }
    this.musicPlaying = false;
  }

  scheduleMusic() {
    if (!this.ctx || !this.musicPlaying) return;
    const ahead = 0.16;
    while (this.nextNoteTime < this.ctx.currentTime + ahead) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += 60 / this.bpm / 2;
      this.step = (this.step + 1) % 16;
    }
  }

  playStep(step, when) {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const notes = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    const pattern = [0, -1, 4, -1, 2, -1, 5, -1, 3, -1, 4, -1, 6, -1, 5, -1];
    const idx = pattern[step];
    if (idx >= 0) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = notes[idx] * (step >= 8 ? 1.0 : 1.0);
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.5, when + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      osc.connect(env);
      env.connect(this.musicGain);
      osc.start(when);
      osc.stop(when + 0.2);
    }
    if (step % 4 === 0) {
      const bass = ctx.createOscillator();
      const benv = ctx.createGain();
      bass.type = 'sine';
      bass.frequency.value = step === 8 ? 110 : 82.41;
      benv.gain.setValueAtTime(0.0001, when);
      benv.gain.exponentialRampToValueAtTime(0.7, when + 0.02);
      benv.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
      bass.connect(benv);
      benv.connect(this.musicGain);
      bass.start(when);
      bass.stop(when + 0.35);
    }
  }
}