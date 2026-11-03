/**
 * Line clear cascade — the sound of a row letting go block by block.
 *
 * Three layers run together for the length of the sweep and ring out after it:
 * a clatter of pitched knocks that pans left to right with the sweep, a
 * soft noise wash that swells as the ribbon thickens, and a major chord
 * that rises under it. A low thump opens the clear. Each theme only
 * supplies a voice (pitch, timbre, brightness), so every theme gets the
 * same drama.
 */

const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2];
const KEY_STEPS = [0, 5, 7, 3, 8, 10];     // chord root per combo step, in semitones
const KNOCKS_PER_SECOND = 130;
const MAX_KNOCKS = 150;

/** root: knock pitch in Hz. decay: knock ring in s. washHz: noise wash centre. clickHz: noise tick centre. */
const VOICES = Object.freeze({
  glass:    { root: 880,  wave: 'sine',     decay: 0.13, washHz: 2600, clickHz: 4200, pad: 'sine',     padRoot: 261.6 },
  concrete: { root: 110,  wave: 'triangle', decay: 0.09, washHz: 450,  clickHz: 700,  pad: 'triangle', padRoot: 130.8 },
  crystal:  { root: 1046, wave: 'sine',     decay: 0.28, washHz: 3200, clickHz: 5200, pad: 'sine',     padRoot: 329.6 },
  metal:    { root: 330,  wave: 'triangle', decay: 0.2,  washHz: 1800, clickHz: 2600, pad: 'sawtooth', padRoot: 164.8 },
  ice:      { root: 784,  wave: 'sine',     decay: 0.11, washHz: 2400, clickHz: 3600, pad: 'sine',     padRoot: 246.9 },
  wood:     { root: 262,  wave: 'triangle', decay: 0.075, washHz: 850, clickHz: 1000, pad: 'triangle', padRoot: 207.7 },
  plastic:  { root: 392,  wave: 'triangle', decay: 0.055, washHz: 1400, clickHz: 1900, pad: 'triangle', padRoot: 196 },
  gold:     { root: 523,  wave: 'sine',     decay: 0.32, washHz: 2000, clickHz: 3000, pad: 'triangle', padRoot: 261.6 },
  silver:   { root: 659,  wave: 'sine',     decay: 0.26, washHz: 2200, clickHz: 3400, pad: 'triangle', padRoot: 329.6 },
});

const semitones = (n) => 2 ** (n / 12);

/** A noise burst with a clipped decay, used as the tick at the front of each knock. */
function noiseBuffer(sc, seconds) {
  return sc.createNoiseBuffer(seconds);
}

function knock(sc, bus, voice, t, freq, vol) {
  const o = sc.ctx.createOscillator();
  o.type = voice.wave;
  o.frequency.setValueAtTime(freq * 1.04, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.012);
  const g = sc.ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + voice.decay);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + voice.decay + 0.01);
}

function wash(sc, bus, voice, t, sweep, rows, ring) {
  const src = sc.ctx.createBufferSource();
  src.buffer = noiseBuffer(sc, 1);
  src.loop = true;
  const f = sc.ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.6;
  f.frequency.setValueAtTime(voice.washHz * 0.7, t);
  f.frequency.linearRampToValueAtTime(voice.washHz * 1.3, t + sweep);
  const g = sc.ctx.createGain();
  const peak = 0.3 + rows * 0.05;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + sweep * 0.45);
  g.gain.linearRampToValueAtTime(peak * 0.8, t + sweep);
  g.gain.exponentialRampToValueAtTime(0.001, t + sweep + ring * 0.7);
  src.connect(f); f.connect(g); g.connect(bus);
  src.start(t); src.stop(t + sweep + ring * 0.7 + 0.05);
}

function chord(sc, out, voice, t, sweep, rows, combo, ring) {
  const root = voice.padRoot * semitones(KEY_STEPS[combo % KEY_STEPS.length]);
  const lp = sc.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.linearRampToValueAtTime(2600, t + sweep);
  const g = sc.ctx.createGain();
  const peak = 0.07 + rows * 0.012;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + sweep * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + sweep + ring);
  lp.connect(g); g.connect(out);
  for (const ratio of [1, 5 / 4, 3 / 2, 2]) {
    const o = sc.ctx.createOscillator();
    o.type = voice.pad;
    o.frequency.value = root * ratio;
    o.detune.value = (Math.random() - 0.5) * 12;
    o.connect(lp);
    o.start(t); o.stop(t + sweep + ring + 0.05);
  }
}

/**
 * Play the cascade for a clear of `rows` rows whose sweep lasts `sweep` seconds,
 * starting `delay` seconds from now.
 */
export function playPeel(sc, themeName, { rows, sweep, delay = 0, combo = 0 }) {
  const voice = VOICES[themeName] || VOICES.glass;
  const t = sc.now() + delay;
  const ring = 0.55 + rows * 0.3;
  const pan = sc.ctx.createStereoPanner();
  const bus = sc.ctx.createGain();
  bus.gain.value = 1;
  bus.connect(pan); pan.connect(sc.gain);
  pan.pan.setValueAtTime(-0.75, t);
  pan.pan.linearRampToValueAtTime(0.75, t + sweep);

  // Opening thump.
  sc.ping(t, 95, 0.12 + rows * 0.02, 0.1 + rows * 0.02);
  sc.crackBurst(t, voice.clickHz * 0.5, 1.2, 0.03, 0.18);

  wash(sc, bus, voice, t, sweep, rows, ring);
  chord(sc, sc.gain, voice, t, sweep, rows, combo, ring);

  const count = Math.min(MAX_KNOCKS, Math.round(sweep * KNOCKS_PER_SECOND * (0.6 + rows * 0.4)));
  const rootFreq = voice.root * semitones(KEY_STEPS[combo % KEY_STEPS.length]);
  for (let i = 0; i < count; i++) {
    const u = (i + Math.random()) / count;
    const when = t + 0.01 + u * sweep;
    const bell = Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.85));
    const freq = rootFreq * SCALE[Math.floor(Math.random() * SCALE.length)] * (1 + (u - 0.5) * 0.2);
    knock(sc, bus, voice, when, freq, (0.05 + 0.09 * bell) * (0.7 + Math.random() * 0.6));
    if (i % 3 === 0) sc.crackBurst(when, voice.clickHz * (0.7 + Math.random() * 0.6), 2, 0.006, 0.05 + 0.05 * bell);
  }
}

/** The stack settling: a soft low thud and a short rattle of loose blocks. */
export function playLand(sc, themeName, rows) {
  const voice = VOICES[themeName] || VOICES.glass;
  const t = sc.now();
  sc.ping(t, 70, 0.18, 0.1 + rows * 0.025);
  sc.crackBurst(t, voice.clickHz * 0.4, 1.2, 0.05, 0.12 + rows * 0.02);
  for (let i = 0; i < 3 + rows; i++) {
    knock(sc, sc.gain, voice, t + 0.03 + i * 0.035 + Math.random() * 0.02,
      voice.root * SCALE[Math.floor(Math.random() * 4)], 0.05);
  }
}
