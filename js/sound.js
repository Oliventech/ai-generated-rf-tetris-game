/**
 * Web Audio API procedural sound effects — "Breaking Off" theme.
 *
 * Design principles:
 * - Layered transients (click + body + texture + tail)
 * - Musical intervals for reward sounds
 * - Micro-variation (±5% pitch) prevents listener fatigue
 * - DynamicsCompressor prevents clipping during rapid gameplay
 * - Combo tracking escalates reward pitch
 * - Theme-based dispatch via Strategy pattern
 */

import { SoundContext } from './sounds/sound-context.js';
import { glassTheme } from './sounds/glass-theme.js';
import { concreteTheme } from './sounds/concrete-theme.js';
import { crystalTheme } from './sounds/crystal-theme.js';
import { metalTheme } from './sounds/metal-theme.js';
import { iceTheme } from './sounds/ice-theme.js';
import { woodTheme } from './sounds/wood-theme.js';
import { plasticTheme } from './sounds/plastic-theme.js';
import { goldTheme } from './sounds/gold-theme.js';
import { silverTheme } from './sounds/silver-theme.js';

const SOUND_THEMES = Object.freeze([
  'glass', 'concrete', 'crystal', 'metal', 'ice',
  'wood', 'plastic', 'gold', 'silver',
]);

/** Map theme names to their sound implementations. */
const THEME_MAP = Object.freeze({
  glass: glassTheme,
  concrete: concreteTheme,
  crystal: crystalTheme,
  metal: metalTheme,
  ice: iceTheme,
  wood: woodTheme,
  plastic: plasticTheme,
  gold: goldTheme,
  silver: silverTheme,
});

class SoundEngine {
  #ctx = null;
  #masterGain = null;
  #compressor = null;
  #volume = 0.6;
  #muted = false;
  #combo = 0;
  #lastClearTime = 0;
  #soundTheme = 'glass';
  #animSpeed = 4;
  #sc = null;

  static get themes() { return SOUND_THEMES; }
  get soundTheme() { return this.#soundTheme; }
  get animSpeed() { return this.#animSpeed; }
  setAnimSpeed(m) { this.#animSpeed = Math.max(0.25, Math.min(8, m)); }

  setSoundTheme(theme) {
    if (SOUND_THEMES.includes(theme)) {
      this.#soundTheme = theme;
    }
  }

  init() {
    if (!this.#ctx) {
      this.#ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      this.#compressor = this.#ctx.createDynamicsCompressor();
      this.#compressor.threshold.value = -12;
      this.#compressor.knee.value = 10;
      this.#compressor.ratio.value = 4;
      this.#compressor.attack.value = 0.003;
      this.#compressor.release.value = 0.1;
      this.#masterGain = this.#ctx.createGain();
      this.#masterGain.gain.value = this.#volume;
      this.#masterGain.connect(this.#compressor);
      this.#compressor.connect(this.#ctx.destination);
      this.#sc = new SoundContext(this.#ctx, this.#masterGain);
    }
    if (this.#ctx.state === 'suspended') {
      this.#ctx.resume();
    }
  }

  get muted() { return this.#muted; }

  warmUp() {
    if (!this.#ctx) return;
    const buf = this.#ctx.createBuffer(1, 1, this.#ctx.sampleRate);
    const src = this.#ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.#ctx.destination);
    src.start();
  }

  setVolume(v) {
    this.#volume = Math.max(0, Math.min(1, v));
    if (this.#masterGain) {
      this.#masterGain.gain.value = this.#muted ? 0 : this.#volume;
    }
  }

  toggleMute() {
    this.#muted = !this.#muted;
    if (this.#masterGain) {
      this.#masterGain.gain.value = this.#muted ? 0 : this.#volume;
    }
    return this.#muted;
  }

  resetCombo() { this.#combo = 0; }

  // ─── Theme-dispatched sound methods ────────────────────────────────

  #theme() { return THEME_MAP[this.#soundTheme] || THEME_MAP.glass; }

  playSpawn() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().spawn(this.#sc);
  }

  playRotate() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().rotate(this.#sc);
  }

  playLock() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().lock(this.#sc);
  }

  playHardDrop() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().hardDrop(this.#sc);
  }

  playLineClear(count = 1) {
    if (!this.#ctx) return;
    const t = this.#sc.now();
    const intensity = Math.min(count, 4);
    const totalDur = 0.8 + intensity * 0.4;
    const vol = 0.5 + intensity * 0.12;
    const now = performance.now();
    if (now - this.#lastClearTime < 3000) {
      this.#combo++;
    } else {
      this.#combo = 1;
    }
    this.#lastClearTime = now;
    const comboShift = this.#combo * 0.03;
    this.#theme().lineClear(this.#sc, t, intensity, totalDur, vol, comboShift);
  }

  playLevelUp() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().levelUp(this.#sc);
  }

  playGameOver() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().gameOver(this.#sc);
  }

  playMove() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().move(this.#sc);
  }

  playHold() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().hold(this.#sc);
  }

  playPause() {
    if (!this.#ctx) return;
    const t = this.#sc.now();
    const osc = this.#ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.2);
    const filter = this.#ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.2);
    const env = this.#ctx.createGain();
    env.gain.setValueAtTime(0.12, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(filter); filter.connect(env); env.connect(this.#masterGain);
    osc.start(t); osc.stop(t + 0.21);
  }

  playUnpause() {
    if (!this.#ctx) return;
    const t = this.#sc.now();
    const osc = this.#ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(500, t + 0.15);
    const filter = this.#ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, t);
    filter.frequency.exponentialRampToValueAtTime(4000, t + 0.15);
    const env = this.#ctx.createGain();
    env.gain.setValueAtTime(0.001, t);
    env.gain.linearRampToValueAtTime(0.12, t + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(filter); filter.connect(env); env.connect(this.#masterGain);
    osc.start(t); osc.stop(t + 0.19);
  }

  playComboHit(combo) {
    if (!this.#ctx || combo < 2) return;
    this.#theme().comboHit(this.#sc, combo);
  }

  playTSpin(type) {
    if (!this.#ctx || this.#muted) return;
    this.#theme().tSpin(this.#sc, type);
  }

  playPerfectClear() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().perfectClear(this.#sc);
  }

  playBackToBack() {
    if (!this.#ctx || this.#muted) return;
    this.#theme().backToBack(this.#sc);
  }

  playDangerPulse(intensity) {
    if (!this.#ctx || this.#muted) return;
    this.#theme().dangerPulse(this.#sc, intensity);
  }

  playRowHighlight(rowIndex = 0) {
    if (!this.#ctx) return;
    const t = this.#sc.now();
    const pitch = 0.95 + Math.random() * 0.1;
    const ds = 2 / this.#animSpeed;
    this.#theme().rowHighlight(this.#sc, t, rowIndex, pitch, ds);
  }

  playCellPop(col, totalCols = 10) {
    if (!this.#ctx) return;
    const t = this.#sc.now();
    const progress = col / totalCols;
    const pitch = 0.95 + Math.random() * 0.1;
    const ds = 2 / this.#animSpeed;
    this.#theme().cellPop(this.#sc, t, progress, pitch, ds);
  }

  playRowCleared(rowIndex = 0) {
    if (!this.#ctx) return;
    const t = this.#sc.now();
    const pitch = 0.95 + Math.random() * 0.1;
    const ds = 2 / this.#animSpeed;
    this.#theme().rowCleared(this.#sc, t, rowIndex, pitch, ds);
  }
}

export { SoundEngine, SOUND_THEMES };
