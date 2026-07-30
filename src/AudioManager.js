const STORAGE_VOLUME = 'nebula-strike.audio.volume';
const STORAGE_MUTED = 'nebula-strike.audio.muted';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Lightweight procedural audio for the game.
 *
 * The AudioContext is intentionally created lazily. This keeps importing and
 * constructing the game safe in non-browser environments and lets the first
 * keyboard/pointer interaction unlock audio on browsers with autoplay rules.
 */
export class AudioManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.effectsBus = null;
    this.engineBus = null;
    this.musicBus = null;

    this.volume = this._readNumber(STORAGE_VOLUME, 0.72);
    this.muted = this._readBoolean(STORAGE_MUTED, false);
    this.disposed = false;

    this.musicWanted = false;
    this.musicPlaying = false;
    this._musicClock = 0;
    this._motifClock = 0;
    this._nextChordIn = 8;
    this._nextMotifIn = 2.5;
    this._chordIndex = -1;

    this._state = {
      speedRatio: 0,
      boosting: false,
      lowHealth: false,
      playing: false,
    };

    this._noiseBuffer = null;
    this._nodes = new Set();
    this._persistentSources = new Set();
    this._transientSources = new Set();
    this._lastPlayed = new Map();
  }

  /**
   * Unlock audio after a user gesture. Returns false rather than rejecting when
   * Web Audio is unavailable or the browser still denies autoplay.
   */
  async resume() {
    if (this.disposed) return false;

    const context = this._ensureContext();
    if (!context) return false;

    try {
      if (context.state === 'suspended' || context.state === 'interrupted') {
        await context.resume();
      }
      this._applyMasterVolume();
      this._setMusicActive(this.musicWanted);
      return context.state === 'running';
    } catch {
      return false;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._writeStorage(STORAGE_MUTED, String(this.muted));
    this._applyMasterVolume();

    // Unmuting is normally initiated by a click, which is also a useful chance
    // to satisfy browser autoplay policies.
    if (!this.muted) {
      void this.resume();
    }

    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setVolume(value) {
    const numeric = Number(value);
    this.volume = clamp(Number.isFinite(numeric) ? numeric : this.volume, 0, 1);
    this._writeStorage(STORAGE_VOLUME, String(this.volume));
    this._applyMasterVolume();
    return this.volume;
  }

  getVolume() {
    return this.volume;
  }

  update(dt = 0, state = {}) {
    if (this.disposed) return;

    const delta = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    const speedValue = Number(state.speedRatio);

    this._state.speedRatio = clamp(
      Number.isFinite(speedValue) ? speedValue : this._state.speedRatio,
      0,
      1.5,
    );
    if (typeof state.boosting === 'boolean') this._state.boosting = state.boosting;
    if (typeof state.lowHealth === 'boolean') this._state.lowHealth = state.lowHealth;
    if (typeof state.playing === 'boolean') this._state.playing = state.playing;

    const context = this.context;
    if (!context || context.state === 'closed') return;

    const now = context.currentTime;
    const speed = this._state.speedRatio;
    const active = this._state.playing;
    const boosting = active && this._state.boosting;

    this._setTarget(this.engineBus?.gain, active ? 0.34 + speed * 0.18 : 0, 0.07, now);
    this._setTarget(this._engineTone?.frequency, 54 + speed * 76 + (boosting ? 18 : 0), 0.06, now);
    this._setTarget(this._engineFilter?.frequency, 240 + speed * 720, 0.08, now);
    this._setTarget(this._engineNoiseGain?.gain, 0.06 + speed * 0.09, 0.08, now);
    this._setTarget(this._afterburnerGain?.gain, boosting ? 0.34 : 0, 0.045, now);
    this._setTarget(
      this._warningGate?.gain,
      active && this._state.lowHealth ? 0.04 : 0,
      0.06,
      now,
    );

    if (this.musicWanted) {
      this._musicClock += delta;
      this._motifClock += delta;

      if (this._musicClock >= this._nextChordIn) {
        this._musicClock = 0;
        this._nextChordIn = 7 + Math.random() * 5;
        this._advanceMusic();
      }

      if (this._motifClock >= this._nextMotifIn) {
        this._motifClock = 0;
        this._nextMotifIn = 1.8 + Math.random() * 2.6;
        this._scheduleMotif();
      }
    }
  }

  playLaser(enemy = false) {
    const context = this._beginEffect('laser', 0.025);
    if (!context) return;

    try {
      const now = context.currentTime + 0.004;
      const duration = enemy ? 0.16 : 0.12;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = enemy ? 'sawtooth' : 'square';

      oscillator.frequency.setValueAtTime(enemy ? 430 : 1080, now);
      oscillator.frequency.exponentialRampToValueAtTime(enemy ? 105 : 235, now + duration);
      oscillator.detune.setValueAtTime((Math.random() - 0.5) * 70, now);
      this._setEnvelope(gain.gain, now, 0.006, enemy ? 0.075 : 0.09, duration);

      oscillator.connect(gain);
      const routeNodes = this._routeEffect(gain, enemy ? 0.3 : -0.12);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.015);
      this._trackTransient(oscillator, [oscillator, gain, ...routeNodes]);
    } catch {
      // A partially implemented Web Audio API should never stop gameplay.
    }
  }

  playMissile() {
    const context = this._beginEffect('missile', 0.12);
    if (!context || !this._noiseBuffer) return;

    try {
      const now = context.currentTime + 0.004;
      const duration = 0.52;
      const pan = (Math.random() - 0.5) * 0.35;

      const noise = context.createBufferSource();
      const noiseFilter = context.createBiquadFilter();
      const noiseGain = context.createGain();
      noise.buffer = this._noiseBuffer;
      noise.playbackRate.setValueAtTime(0.55, now);
      noise.playbackRate.exponentialRampToValueAtTime(1.45, now + duration);
      noiseFilter.type = 'bandpass';
      noiseFilter.Q.value = 0.7;
      noiseFilter.frequency.setValueAtTime(280, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(1450, now + duration);
      this._setEnvelope(noiseGain.gain, now, 0.025, 0.18, duration);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      const noiseRoute = this._routeEffect(noiseGain, pan);

      const tone = context.createOscillator();
      const toneGain = context.createGain();
      tone.type = 'sawtooth';
      tone.frequency.setValueAtTime(115, now);
      tone.frequency.exponentialRampToValueAtTime(48, now + 0.34);
      this._setEnvelope(toneGain.gain, now, 0.012, 0.1, 0.36);
      tone.connect(toneGain);
      const toneRoute = this._routeEffect(toneGain, pan);

      const maxOffset = Math.max(0, this._noiseBuffer.duration - duration);
      noise.start(now, Math.random() * maxOffset, duration);
      tone.start(now);
      tone.stop(now + 0.4);
      this._trackTransient(noise, [noise, noiseFilter, noiseGain, ...noiseRoute]);
      this._trackTransient(tone, [tone, toneGain, ...toneRoute]);
    } catch {
      // Silently degrade if a node is unsupported.
    }
  }

  playHit() {
    const context = this._beginEffect('hit', 0.018);
    if (!context || !this._noiseBuffer) return;

    try {
      const now = context.currentTime + 0.002;
      const pan = (Math.random() - 0.5) * 0.7;

      const noise = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      noise.buffer = this._noiseBuffer;
      filter.type = 'highpass';
      filter.frequency.value = 900 + Math.random() * 700;
      this._setEnvelope(gain.gain, now, 0.002, 0.09, 0.09);
      noise.connect(filter);
      filter.connect(gain);
      const noiseRoute = this._routeEffect(gain, pan);

      const tone = context.createOscillator();
      const toneGain = context.createGain();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(170, now);
      tone.frequency.exponentialRampToValueAtTime(72, now + 0.11);
      this._setEnvelope(toneGain.gain, now, 0.002, 0.08, 0.12);
      tone.connect(toneGain);
      const toneRoute = this._routeEffect(toneGain, pan);

      const duration = 0.1;
      const maxOffset = Math.max(0, this._noiseBuffer.duration - duration);
      noise.start(now, Math.random() * maxOffset, duration);
      tone.start(now);
      tone.stop(now + 0.13);
      this._trackTransient(noise, [noise, filter, gain, ...noiseRoute]);
      this._trackTransient(tone, [tone, toneGain, ...toneRoute]);
    } catch {
      // Sound is optional.
    }
  }

  playExplosion(intensity = 1) {
    const context = this._beginEffect('explosion', 0.045);
    if (!context || !this._noiseBuffer) return;

    try {
      const power = clamp(Number.isFinite(Number(intensity)) ? Number(intensity) : 1, 0.15, 2);
      const now = context.currentTime + 0.003;
      const duration = 0.42 + power * 0.28;
      const pan = (Math.random() - 0.5) * 0.8;

      const noise = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      noise.buffer = this._noiseBuffer;
      noise.playbackRate.value = 0.65 + Math.random() * 0.35;
      filter.type = 'lowpass';
      filter.Q.value = 0.65;
      filter.frequency.setValueAtTime(1250 + power * 500, now);
      filter.frequency.exponentialRampToValueAtTime(150, now + duration);
      this._setEnvelope(gain.gain, now, 0.006, Math.min(0.36, 0.19 * power), duration);
      noise.connect(filter);
      filter.connect(gain);
      const noiseRoute = this._routeEffect(gain, pan);

      const bass = context.createOscillator();
      const bassGain = context.createGain();
      bass.type = 'sine';
      bass.frequency.setValueAtTime(75 + power * 15, now);
      bass.frequency.exponentialRampToValueAtTime(24, now + duration * 0.75);
      this._setEnvelope(bassGain.gain, now, 0.012, Math.min(0.25, 0.11 * power), duration * 0.8);
      bass.connect(bassGain);
      const bassRoute = this._routeEffect(bassGain, pan);

      const playableDuration = Math.min(duration, this._noiseBuffer.duration - 0.01);
      const maxOffset = Math.max(0, this._noiseBuffer.duration - playableDuration);
      noise.start(now, Math.random() * maxOffset, playableDuration);
      bass.start(now);
      bass.stop(now + duration);
      this._trackTransient(noise, [noise, filter, gain, ...noiseRoute]);
      this._trackTransient(bass, [bass, bassGain, ...bassRoute]);
    } catch {
      // Sound is optional.
    }
  }

  playWarning() {
    const context = this._beginEffect('warning', 0.38);
    if (!context) return;

    try {
      const now = context.currentTime + 0.004;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = 690;

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.085, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.115);
      gain.gain.setValueAtTime(0.0001, now + 0.17);
      gain.gain.linearRampToValueAtTime(0.075, now + 0.182);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

      oscillator.connect(gain);
      const routeNodes = this._routeEffect(gain, 0);
      oscillator.start(now);
      oscillator.stop(now + 0.32);
      this._trackTransient(oscillator, [oscillator, gain, ...routeNodes]);
    } catch {
      // Sound is optional.
    }
  }

  startMusic() {
    if (this.disposed) return;

    this.musicWanted = true;
    this._musicClock = 0;
    this._motifClock = 0;
    const context = this._ensureContext();
    if (context) {
      this._advanceMusic(true);
      this._scheduleMotif(true);
      this._setMusicActive(true);
      void this.resume();
    }
  }

  stopMusic() {
    this.musicWanted = false;
    this.musicPlaying = false;
    this._setMusicActive(false);

    if (this.context && this._musicLeadGain) {
      this._setTarget(this._musicLeadGain.gain, 0.0001, 0.05, this.context.currentTime);
    }
  }

  reset() {
    if (this.disposed) return;

    this.stopMusic();
    this._state.speedRatio = 0;
    this._state.boosting = false;
    this._state.lowHealth = false;
    this._state.playing = false;
    this._musicClock = 0;
    this._motifClock = 0;
    this._lastPlayed.clear();

    for (const source of this._transientSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this._transientSources.clear();

    if (this.context && this.context.state !== 'closed') {
      const now = this.context.currentTime;
      this._setImmediate(this.engineBus?.gain, 0, now);
      this._setImmediate(this._afterburnerGain?.gain, 0, now);
      this._setImmediate(this._warningGate?.gain, 0, now);
      this._setImmediate(this.musicBus?.gain, 0, now);
    }
  }

  dispose() {
    if (this.disposed) return;

    this.reset();
    this.disposed = true;

    for (const source of this._persistentSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }

    for (const node of this._nodes) {
      try {
        node.disconnect();
      } catch {
        // Some browser implementations throw when a node is disconnected twice.
      }
    }

    this._persistentSources.clear();
    this._transientSources.clear();
    this._nodes.clear();

    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      try {
        const closing = context.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      } catch {
        // Closing is best-effort.
      }
    }
  }

  _ensureContext() {
    if (this.disposed) return null;
    if (this.context && this.context.state !== 'closed') return this.context;

    this.context = null;
    this._nodes.clear();
    this._persistentSources.clear();
    this._transientSources.clear();

    let AudioContextClass;
    try {
      AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    } catch {
      return null;
    }
    if (!AudioContextClass) return null;

    let context;
    try {
      context = new AudioContextClass({ latencyHint: 'interactive' });
    } catch {
      try {
        context = new AudioContextClass();
      } catch {
        return null;
      }
    }

    try {
      this.context = context;
      this._buildGraph();
      return context;
    } catch {
      try {
        const closing = context.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      } catch {
        // Ignore cleanup errors from incomplete implementations.
      }
      this.context = null;
      this._nodes.clear();
      this._persistentSources.clear();
      return null;
    }
  }

  _buildGraph() {
    const context = this.context;

    this.masterGain = this._remember(context.createGain());
    const compressor = this._remember(context.createDynamicsCompressor());
    this.effectsBus = this._remember(context.createGain());
    this.engineBus = this._remember(context.createGain());
    this.musicBus = this._remember(context.createGain());

    compressor.threshold.value = -18;
    compressor.knee.value = 22;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.24;
    this.effectsBus.gain.value = 0.78;
    this.engineBus.gain.value = 0;
    this.musicBus.gain.value = 0;

    this.effectsBus.connect(this.masterGain);
    this.engineBus.connect(this.masterGain);
    this.musicBus.connect(this.masterGain);
    this.masterGain.connect(compressor);
    compressor.connect(context.destination);
    this.masterGain.gain.value = this.muted ? 0 : this.volume;

    this._noiseBuffer = this._createNoiseBuffer();
    this._buildEngine();
    this._buildWarningLoop();
    this._buildMusic();
  }

  _buildEngine() {
    const context = this.context;

    this._engineTone = this._remember(context.createOscillator());
    const toneGain = this._remember(context.createGain());
    this._engineFilter = this._remember(context.createBiquadFilter());
    this._engineTone.type = 'sawtooth';
    this._engineTone.frequency.value = 54;
    toneGain.gain.value = 0.08;
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = 240;
    this._engineFilter.Q.value = 1.25;
    this._engineTone.connect(toneGain);
    toneGain.connect(this._engineFilter);
    this._engineFilter.connect(this.engineBus);

    const engineNoise = this._remember(context.createBufferSource());
    const engineNoiseFilter = this._remember(context.createBiquadFilter());
    this._engineNoiseGain = this._remember(context.createGain());
    engineNoise.buffer = this._noiseBuffer;
    engineNoise.loop = true;
    engineNoiseFilter.type = 'bandpass';
    engineNoiseFilter.frequency.value = 390;
    engineNoiseFilter.Q.value = 0.45;
    this._engineNoiseGain.gain.value = 0.06;
    engineNoise.connect(engineNoiseFilter);
    engineNoiseFilter.connect(this._engineNoiseGain);
    this._engineNoiseGain.connect(this.engineBus);

    const boostNoise = this._remember(context.createBufferSource());
    const boostFilter = this._remember(context.createBiquadFilter());
    this._afterburnerGain = this._remember(context.createGain());
    boostNoise.buffer = this._noiseBuffer;
    boostNoise.loop = true;
    boostFilter.type = 'bandpass';
    boostFilter.frequency.value = 1150;
    boostFilter.Q.value = 0.55;
    this._afterburnerGain.gain.value = 0;
    boostNoise.connect(boostFilter);
    boostFilter.connect(this._afterburnerGain);
    this._afterburnerGain.connect(this.engineBus);

    this._startPersistent(this._engineTone);
    this._startPersistent(engineNoise, Math.random() * this._noiseBuffer.duration);
    this._startPersistent(boostNoise, Math.random() * this._noiseBuffer.duration);
  }

  _buildWarningLoop() {
    const context = this.context;
    const warningTone = this._remember(context.createOscillator());
    const warningPulse = this._remember(context.createGain());
    this._warningGate = this._remember(context.createGain());
    const pulseLfo = this._remember(context.createOscillator());
    const pulseDepth = this._remember(context.createGain());

    warningTone.type = 'square';
    warningTone.frequency.value = 420;
    warningPulse.gain.value = 0.5;
    this._warningGate.gain.value = 0;
    pulseLfo.type = 'sine';
    pulseLfo.frequency.value = 2.2;
    pulseDepth.gain.value = 0.49;

    warningTone.connect(warningPulse);
    warningPulse.connect(this._warningGate);
    this._warningGate.connect(this.effectsBus);
    pulseLfo.connect(pulseDepth);
    pulseDepth.connect(warningPulse.gain);

    this._startPersistent(warningTone);
    this._startPersistent(pulseLfo);
  }

  _buildMusic() {
    const context = this.context;
    this._musicFilter = this._remember(context.createBiquadFilter());
    this._musicFilter.type = 'lowpass';
    this._musicFilter.frequency.value = 1050;
    this._musicFilter.Q.value = 0.65;

    const dryGain = this._remember(context.createGain());
    const delay = this._remember(context.createDelay(1));
    const delayWet = this._remember(context.createGain());
    const delayFeedback = this._remember(context.createGain());
    dryGain.gain.value = 0.82;
    delay.delayTime.value = 0.38;
    delayWet.gain.value = 0.17;
    delayFeedback.gain.value = 0.16;

    this._musicFilter.connect(dryGain);
    dryGain.connect(this.musicBus);
    this._musicFilter.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(this.musicBus);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);

    this._musicOscillators = [];
    const types = ['sine', 'triangle', 'sine'];
    const levels = [0.028, 0.018, 0.012];
    for (let index = 0; index < 3; index += 1) {
      const oscillator = this._remember(context.createOscillator());
      const gain = this._remember(context.createGain());
      oscillator.type = types[index];
      oscillator.frequency.value = [110, 164.81, 220][index];
      oscillator.detune.value = (index - 1) * 4;
      gain.gain.value = levels[index];
      oscillator.connect(gain);
      gain.connect(this._musicFilter);
      this._musicOscillators.push(oscillator);
      this._startPersistent(oscillator);
    }

    this._musicLead = this._remember(context.createOscillator());
    this._musicLeadGain = this._remember(context.createGain());
    this._musicLead.type = 'sine';
    this._musicLead.frequency.value = 440;
    this._musicLeadGain.gain.value = 0.0001;
    this._musicLead.connect(this._musicLeadGain);
    this._musicLeadGain.connect(this._musicFilter);
    this._startPersistent(this._musicLead);

    const filterLfo = this._remember(context.createOscillator());
    const filterDepth = this._remember(context.createGain());
    filterLfo.type = 'sine';
    filterLfo.frequency.value = 0.065;
    filterDepth.gain.value = 260;
    filterLfo.connect(filterDepth);
    filterDepth.connect(this._musicFilter.frequency);
    this._startPersistent(filterLfo);
  }

  _advanceMusic(immediate = false) {
    const context = this.context;
    if (!context || !this._musicOscillators?.length) return;

    // Airy minor/add9 voicings. Only parameters change here: every music voice
    // is a persistent oscillator created once with the main graph.
    const chords = [
      [110.0, 164.81, 246.94],
      [87.31, 130.81, 220.0],
      [65.41, 123.47, 196.0],
      [98.0, 146.83, 220.0],
      [73.42, 110.0, 164.81],
    ];
    this._chordIndex = (this._chordIndex + 1) % chords.length;
    const chord = chords[this._chordIndex];
    const now = context.currentTime;
    const glide = immediate ? 0.05 : 1.35;

    for (let index = 0; index < this._musicOscillators.length; index += 1) {
      this._setTarget(this._musicOscillators[index].frequency, chord[index], glide, now);
    }
    this._setTarget(this._musicFilter.frequency, 900 + Math.random() * 420, 1.2, now);
  }

  _scheduleMotif(immediate = false) {
    const context = this.context;
    if (!context || !this._musicLead || !this._musicLeadGain || !this.musicWanted) return;

    const scale = [220, 246.94, 293.66, 329.63, 369.99, 440, 493.88];
    const now = context.currentTime + (immediate ? 0.05 : 0);
    const note = scale[Math.floor(Math.random() * scale.length)];
    const peak = 0.007 + Math.random() * 0.006;

    this._setTarget(this._musicLead.frequency, note, 0.08, now);
    const gain = this._musicLeadGain.gain;
    try {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(0.0001, gain.value), now);
      gain.linearRampToValueAtTime(peak, now + 0.35);
      gain.exponentialRampToValueAtTime(0.0001, now + 2.1);
    } catch {
      gain.value = 0.0001;
    }
  }

  _setMusicActive(active) {
    this.musicPlaying = Boolean(active && this.context);
    if (!this.context || !this.musicBus) return;
    this._setTarget(this.musicBus.gain, active ? 0.58 : 0, active ? 0.8 : 0.2, this.context.currentTime);
  }

  _beginEffect(name, minimumGap) {
    if (this.disposed || this.muted || this.volume <= 0) return null;

    const context = this._ensureContext();
    if (!context) return null;

    if (context.state === 'suspended' || context.state === 'interrupted') {
      try {
        const resuming = context.resume();
        if (resuming && typeof resuming.catch === 'function') resuming.catch(() => {});
      } catch {
        // The scheduled sound will remain harmless in a suspended context.
      }
    }

    const now = context.currentTime;
    const previous = this._lastPlayed.get(name) ?? -Infinity;
    if (now - previous < minimumGap) return null;
    this._lastPlayed.set(name, now);
    return context;
  }

  _routeEffect(node, pan = 0) {
    const context = this.context;
    if (typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      node.connect(panner);
      panner.connect(this.effectsBus);
      return [panner];
    }
    node.connect(this.effectsBus);
    return [];
  }

  _setEnvelope(parameter, start, attack, peak, duration) {
    parameter.cancelScheduledValues(start);
    parameter.setValueAtTime(0.0001, start);
    parameter.linearRampToValueAtTime(peak, start + attack);
    parameter.exponentialRampToValueAtTime(0.0001, start + duration);
  }

  _trackTransient(source, nodes) {
    this._transientSources.add(source);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this._transientSources.delete(source);
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    };

    if (typeof source.addEventListener === 'function') {
      source.addEventListener('ended', cleanup, { once: true });
    } else {
      source.onended = cleanup;
    }
  }

  _startPersistent(source, offset) {
    this._persistentSources.add(source);
    if (typeof offset === 'number') source.start(0, offset);
    else source.start(0);
  }

  _createNoiseBuffer() {
    const context = this.context;
    const length = Math.max(1, Math.floor(context.sampleRate * 2));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;

    // A small amount of correlation softens pure white noise, while filters in
    // each sound shape the same reusable buffer into engines and impacts.
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.18 + white * 0.82;
      channel[index] = previous;
    }
    return buffer;
  }

  _applyMasterVolume() {
    if (!this.context || !this.masterGain || this.context.state === 'closed') return;
    this._setTarget(
      this.masterGain.gain,
      this.muted ? 0 : this.volume,
      0.025,
      this.context.currentTime,
    );
  }

  _setTarget(parameter, value, timeConstant = 0.03, time) {
    if (!parameter) return;
    const at = Number.isFinite(time) ? time : (this.context?.currentTime ?? 0);
    try {
      parameter.cancelScheduledValues(at);
      parameter.setValueAtTime(parameter.value, at);
      parameter.setTargetAtTime(value, at, Math.max(0.001, timeConstant));
    } catch {
      try {
        parameter.value = value;
      } catch {
        // Ignore read-only or incomplete AudioParam shims.
      }
    }
  }

  _setImmediate(parameter, value, time) {
    if (!parameter) return;
    try {
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(value, time);
    } catch {
      try {
        parameter.value = value;
      } catch {
        // Ignore read-only or incomplete AudioParam shims.
      }
    }
  }

  _remember(node) {
    this._nodes.add(node);
    return node;
  }

  _readNumber(key, fallback) {
    try {
      const value = Number(globalThis.localStorage?.getItem(key));
      return Number.isFinite(value) && globalThis.localStorage?.getItem(key) !== null
        ? clamp(value, 0, 1)
        : fallback;
    } catch {
      return fallback;
    }
  }

  _readBoolean(key, fallback) {
    try {
      const value = globalThis.localStorage?.getItem(key);
      if (value === null || value === undefined) return fallback;
      return value === 'true' || value === '1';
    } catch {
      return fallback;
    }
  }

  _writeStorage(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage can be denied in privacy modes; audio should still work.
    }
  }
}

export default AudioManager;
