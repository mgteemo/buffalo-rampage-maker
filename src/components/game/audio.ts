// Procedural spatial audio system for Buffalo Simulator.
// - Web Audio API with HRTF panners ("Dolby-like" 3D positioning)
// - Procedurally-generated background music (no external assets)
// - Per-entity engine / chatter sources that grow louder as buffalo nears

type SourceKind = "tractor" | "harvester" | "car" | "human";

type EntitySource = {
  id: string;
  kind: SourceKind;
  panner: PannerNode;
  gain: GainNode;
  // generator-specific nodes for modulation
  osc?: OscillatorNode;
  osc2?: OscillatorNode;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
  filter?: BiquadFilterNode;
  noise?: AudioBufferSourceNode;
  chatterTimer?: number;
  // last update time, for chatter scheduling
  nextChatterAt?: number;
};

class AudioManager {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  sfxGain: GainNode | null = null;
  musicNodes: AudioNode[] = [];
  raceMusicNodes: AudioNode[] = [];
  raceMusicStarted = false;
  sources = new Map<string, EntitySource>();
  enabled = false;
  musicStarted = false;

  init() {
    if (this.ctx) return;
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    this.ctx = new Ctx();
    // HRTF listener for surround/Dolby-like spatial cues
    const listener = this.ctx.listener;
    if (listener.forwardX) {
      listener.forwardX.value = 0;
      listener.forwardY.value = 0;
      listener.forwardZ.value = -1;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      // Older API
      (listener as unknown as { setOrientation: (...a: number[]) => void }).setOrientation?.(0, 0, -1, 0, 1, 0);
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.85;
    this.sfxGain.connect(this.master);

    this.enabled = true;
  }

  async resume() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  setMasterMuted(muted: boolean) {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  setListener(x: number, y: number, z: number, yaw: number) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      const k = 0.05;
      l.positionX.setTargetAtTime(x, t, k);
      l.positionY.setTargetAtTime(y, t, k);
      l.positionZ.setTargetAtTime(z, t, k);
      l.forwardX.setTargetAtTime(fx, t, k);
      l.forwardZ.setTargetAtTime(fz, t, k);
    } else {
      (l as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition?.(x, y, z);
      (l as unknown as { setOrientation: (...a: number[]) => void }).setOrientation?.(fx, 0, fz, 0, 1, 0);
    }
  }

  // ---------- Background music ----------
  startMusic() {
    if (!this.ctx || !this.musicGain || this.musicStarted) return;
    this.musicStarted = true;
    const ctx = this.ctx;
    // Pad chord (D minor pentatonic-ish): D2, A2, D3, F3, A3
    const freqs = [73.42, 110.0, 146.83, 174.61, 220.0];
    const types: OscillatorType[] = ["sawtooth", "triangle", "sine", "triangle", "sine"];
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 780;
    filter.Q.value = 0.6;

    // Slow LFO sweeps the filter for breathing pad feel
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = types[i];
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      const g = ctx.createGain();
      g.gain.value = 0.15 / freqs.length + (i === 0 ? 0.04 : 0);
      o.connect(g).connect(filter);
      o.start();
      this.musicNodes.push(o, g);
    });

    // Soft, peaceful chime sparkle — a gentle high note every few seconds.
    const chime = () => {
      if (!this.ctx || !this.musicGain) return;
      const t = this.ctx.currentTime;
      const notes = [880, 1046.5, 1318.5, 1567.98];
      const f = notes[Math.floor(Math.random() * notes.length)];
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 2.5);
    };
    const beat = window.setInterval(chime, 3200);
    this.musicNodes.push({ disconnect() { window.clearInterval(beat); } } as unknown as AudioNode);

    filter.connect(this.musicGain);
    this.musicNodes.push(filter, lfo, lfoGain);
  }

  stopMusic() {
    this.musicNodes.forEach((n) => { try { n.disconnect(); } catch { /* */ } });
    this.musicNodes = [];
    this.musicStarted = false;
  }

  // ---------- Race countdown beeps ----------
  playCountdownBeep(isGo: boolean) {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.value = isGo ? 1320 : 660;
    const dur = isGo ? 0.7 : 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- Upbeat race music ----------
  startRaceMusic() {
    if (!this.ctx || !this.musicGain || this.raceMusicStarted) return;
    this.raceMusicStarted = true;
    const ctx = this.ctx;
    // Driving bass arpeggio
    const notes = [98.0, 146.83, 196.0, 146.83, 110.0, 164.81, 220.0, 164.81];
    let idx = 0;
    const tick = () => {
      if (!this.ctx || !this.musicGain || !this.raceMusicStarted) return;
      const t = this.ctx.currentTime;
      const f = notes[idx % notes.length];
      idx++;
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(filter).connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.22);
      // Snare hit on every other step
      if (idx % 2 === 0) {
        const len = Math.floor(ctx.sampleRate * 0.12);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04));
        const n = ctx.createBufferSource();
        n.buffer = buf;
        const ng = ctx.createGain();
        ng.gain.value = 0.18;
        n.connect(ng).connect(this.musicGain);
        n.start(t);
      }
      // Kick on downbeat
      if (idx % 4 === 1) {
        const ko = ctx.createOscillator();
        const kg = ctx.createGain();
        ko.frequency.setValueAtTime(140, t);
        ko.frequency.exponentialRampToValueAtTime(45, t + 0.15);
        kg.gain.setValueAtTime(0.0001, t);
        kg.gain.exponentialRampToValueAtTime(0.4, t + 0.005);
        kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        ko.connect(kg).connect(this.musicGain);
        ko.start(t);
        ko.stop(t + 0.22);
      }
    };
    const interval = window.setInterval(tick, 165);
    this.raceMusicNodes.push({ disconnect() { window.clearInterval(interval); } } as unknown as AudioNode);
  }

  stopRaceMusic() {
    this.raceMusicNodes.forEach((n) => { try { n.disconnect(); } catch { /* */ } });
    this.raceMusicNodes = [];
    this.raceMusicStarted = false;
  }

  // ---------- Per-entity sources ----------
  private buildNoiseBuffer(seconds = 2): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  registerSource(id: string, kind: SourceKind): EntitySource | null {
    if (!this.ctx || !this.sfxGain) return null;
    if (this.sources.has(id)) return this.sources.get(id)!;
    const ctx = this.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 4;
    panner.maxDistance = 60;
    panner.rolloffFactor = 1.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(panner).connect(this.sfxGain);

    const src: EntitySource = { id, kind, panner, gain };

    if (kind === "tractor" || kind === "harvester") {
      // Engine: sawtooth + sub + AM via LFO + bandpass filter colour
      const baseFreq = kind === "harvester" ? 55 : 75;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = baseFreq;
      const osc2 = ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.value = baseFreq * 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700;
      filter.Q.value = 4;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = kind === "harvester" ? 4 : 7;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.45;
      // AM modulation: LFO modulates a second gain stage
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      lfo.connect(lfoGain).connect(amp.gain);
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(amp).connect(gain);
      osc.start();
      osc2.start();
      lfo.start();
      src.osc = osc;
      src.osc2 = osc2;
      src.lfo = lfo;
      src.lfoGain = lfoGain;
      src.filter = filter;
    } else if (kind === "car") {
      // Cars no longer hum — they HONK. Horn beeps are scheduled in updateSource().
      src.nextChatterAt = 0;
    } else if (kind === "human") {
      // Human chatter is scheduled on demand inside update()
      src.nextChatterAt = 0;
    }
      // Human chatter is scheduled on demand inside update()
      src.nextChatterAt = 0;
    }

    this.sources.set(id, src);
    return src;
  }

  /**
   * Update a source position and intensity. `proximity` is 0..1 where 1 = buffalo right next to it.
   */
  updateSource(id: string, x: number, y: number, z: number, proximity: number, vx = 0, vz = 0) {
    const s = this.sources.get(id);
    if (!s || !this.ctx) return;
    const t = this.ctx.currentTime;
    const p = s.panner;
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, t, 0.05);
      p.positionY.setTargetAtTime(y, t, 0.05);
      p.positionZ.setTargetAtTime(z, t, 0.05);
    } else {
      (p as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition?.(x, y, z);
    }

    if (s.kind === "tractor" || s.kind === "harvester" || s.kind === "car") {
      // Idle hum baseline + rev when buffalo near (alarmed engine)
      const idle = s.kind === "car" ? 0.35 : 0.45;
      const target = idle + proximity * 0.55;
      s.gain.gain.setTargetAtTime(target, t, 0.08);
      // Rev pitch up as proximity rises
      if (s.osc) {
        const base = s.kind === "harvester" ? 55 : s.kind === "tractor" ? 75 : 130;
        s.osc.frequency.setTargetAtTime(base * (1 + proximity * 0.9), t, 0.08);
      }
      if (s.osc2) {
        const base = (s.kind === "harvester" ? 55 : s.kind === "tractor" ? 75 : 130) * 0.5;
        s.osc2.frequency.setTargetAtTime(base * (1 + proximity * 0.9), t, 0.08);
      }
      if (s.lfo) {
        const baseLfo = s.kind === "harvester" ? 4 : s.kind === "tractor" ? 7 : 12;
        s.lfo.frequency.setTargetAtTime(baseLfo * (1 + proximity * 1.5), t, 0.08);
      }
      // Movement velocity for Doppler
      if (p.orientationX) {
        // not strictly required but keeps panners pointing forward
      }
      void vx; void vz;
    } else if (s.kind === "human") {
      // Schedule chatter / scream blips. Closer => screams (higher pitch, faster).
      const now = performance.now() / 1000;
      if (s.nextChatterAt === undefined) s.nextChatterAt = 0;
      if (now >= s.nextChatterAt && proximity > 0.05) {
        const scream = proximity > 0.45;
        const dur = scream ? 0.35 : 0.25;
        const f0 = scream ? 380 + Math.random() * 220 : 160 + Math.random() * 80;
        const o = this.ctx.createOscillator();
        o.type = scream ? "sawtooth" : "triangle";
        const g = this.ctx.createGain();
        const f = this.ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = scream ? 1200 : 700;
        f.Q.value = scream ? 8 : 4;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * (scream ? 1.6 : 0.8), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(scream ? 0.9 : 0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(s.panner);
        o.start(t);
        o.stop(t + dur + 0.05);
        s.nextChatterAt = now + (scream ? 0.35 + Math.random() * 0.3 : 1.8 + Math.random() * 2.5);
      }
      // Always keep chatter gain audible (each blip routes through panner directly)
      s.gain.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  removeSource(id: string) {
    const s = this.sources.get(id);
    if (!s) return;
    try {
      s.osc?.stop();
      s.osc2?.stop();
      s.lfo?.stop();
      s.osc?.disconnect();
      s.osc2?.disconnect();
      s.lfo?.disconnect();
      s.lfoGain?.disconnect();
      s.filter?.disconnect();
      s.gain.disconnect();
      s.panner.disconnect();
    } catch { /* */ }
    this.sources.delete(id);
  }
}

export const audio = new AudioManager();
