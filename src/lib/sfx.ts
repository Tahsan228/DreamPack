/**
 * UI sounds.
 *
 * The button click is a real sample (src/assets/sounds/click.mp3, supplied with
 * the project). Everything else is synthesised from oscillators and noise at
 * call time, so there is nothing else to load. Every sound is triggered by a
 * click, which is what unlocks the audio context in the first place.
 */
import clickUrl from '../assets/sounds/click.mp3';

const MUTE_KEY = 'dreampack.muted';

let ctx: AudioContext | null = null;
let muted = false;

if (typeof localStorage !== 'undefined') {
  muted = localStorage.getItem(MUTE_KEY) === '1';
}

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Private browsing can refuse localStorage; muting just won't persist.
  }
}

/** Short burst of white noise, used for the woody transient in a click. */
function noiseBurst(ac: AudioContext, when: number, duration: number, gain: number, freq: number) {
  const frames = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Fade the noise out across the burst so it reads as a tap, not a hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.2;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, when);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  source.connect(filter).connect(amp).connect(ac.destination);
  source.start(when);
  source.stop(when + duration);
}

interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  duration: number;
  gain?: number;
  delay?: number;
}

function tone(ac: AudioContext, o: ToneOptions) {
  const when = ac.currentTime + (o.delay ?? 0);
  const osc = ac.createOscillator();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(o.from, when);
  if (o.to !== undefined && o.to !== o.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), when + o.duration);
  }

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(o.gain ?? 0.18, when + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + o.duration);

  osc.connect(amp).connect(ac.destination);
  osc.start(when);
  osc.stop(when + o.duration + 0.02);
}

/**
 * The click sample, decoded once and replayed from a buffer so overlapping
 * clicks never cut each other off the way a shared <audio> element would.
 */
let clickBuffer: AudioBuffer | null = null;
let clickOffset = 0;
let clickPending: Promise<void> | null = null;

/**
 * Find where the audio actually starts.
 *
 * Recorded samples usually carry a few milliseconds of digital silence at the
 * front, which reads as lag between pressing a button and hearing it. Rather
 * than re-encoding the file, we measure the lead-in once and start playback
 * past it.
 */
function findAudioStart(buffer: AudioBuffer): number {
  const THRESHOLD = 0.005;
  let earliest = buffer.length;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > THRESHOLD) {
        if (i < earliest) earliest = i;
        break;
      }
    }
  }

  if (earliest >= buffer.length) return 0; // silent file; play it as-is
  // Back off a hair so the very first cycle of the transient is not clipped.
  const padded = Math.max(0, earliest - Math.round(buffer.sampleRate * 0.001));
  return padded / buffer.sampleRate;
}

function loadClick(ac: AudioContext): void {
  if (clickBuffer || clickPending) return;
  clickPending = fetch(clickUrl)
    .then((r) => r.arrayBuffer())
    .then((data) => ac.decodeAudioData(data))
    .then((buffer) => {
      clickBuffer = buffer;
      clickOffset = findAudioStart(buffer);
    })
    .catch(() => {
      // Decode failed or the file is missing; playClick falls back to the synth.
    });
}

/** Warm the sample up so the very first click is not silent. */
export function preloadSounds(): void {
  const ac = context();
  if (ac) loadClick(ac);
}

/** The Minecraft button click. */
export function playClick(): void {
  if (muted) return;
  const ac = context();
  if (!ac) return;

  if (clickBuffer) {
    const source = ac.createBufferSource();
    source.buffer = clickBuffer;
    const amp = ac.createGain();
    amp.gain.value = 0.6;
    source.connect(amp).connect(ac.destination);
    // Skip the file's silent lead-in so the click lands with the press.
    source.start(0, clickOffset);
    return;
  }

  loadClick(ac);
  // Synthesised stand-in for the moment before the sample has decoded.
  tone(ac, { type: 'square', from: 1050, to: 620, duration: 0.045, gain: 0.09 });
  noiseBurst(ac, ac.currentTime, 0.025, 0.05, 1800);
}

/** Rising blip for choosing a texture — the "item picked up" feel. */
export function playPop(): void {
  if (muted) return;
  const ac = context();
  if (!ac) return;
  tone(ac, { type: 'triangle', from: 620, to: 1180, duration: 0.09, gain: 0.13 });
}

/** Soft low thud for removing or cancelling. */
export function playThud(): void {
  if (muted) return;
  const ac = context();
  if (!ac) return;
  tone(ac, { type: 'sine', from: 320, to: 140, duration: 0.11, gain: 0.14 });
  noiseBurst(ac, ac.currentTime, 0.04, 0.04, 700);
}

/** Two-note chime on a finished export. */
export function playSuccess(): void {
  if (muted) return;
  const ac = context();
  if (!ac) return;
  tone(ac, { type: 'triangle', from: 660, duration: 0.16, gain: 0.14 });
  tone(ac, { type: 'triangle', from: 990, duration: 0.28, gain: 0.13, delay: 0.11 });
}

/** Dry tick while painting, quiet enough to fire on every pixel. */
export function playPaint(): void {
  if (muted) return;
  const ac = context();
  if (!ac) return;
  noiseBurst(ac, ac.currentTime, 0.012, 0.028, 2600);
}
