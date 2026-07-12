/**
 * Table sounds, synthesized with WebAudio — no audio files, nothing to
 * download, works offline. Every trigger sits behind a user gesture (click or
 * keypress), so autoplay policies never block the AudioContext.
 */

export type SoundName =
  | 'chip'
  | 'deal'
  | 'correct'
  | 'incorrect'
  | 'win'
  | 'push'
  | 'lose'
  | 'bust';

const MUTE_KEY = 'perfect21.muted';
const MASTER = 0.16;

let ctx: AudioContext | null = null;
let muted: boolean | null = null;

export function soundMuted(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      muted = false;
    }
  }
  return muted;
}

export function setSoundMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // no persistence in private mode; the session still respects the toggle
  }
}

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One enveloped oscillator note. */
function tone(
  ac: AudioContext,
  at: number,
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  glideTo?: number
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain * MASTER, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A short filtered noise burst (clicks, swooshes, clatter). */
function noise(
  ac: AudioContext,
  at: number,
  dur: number,
  gain: number,
  filterFreq: number,
  q = 1,
  type: BiquadFilterType = 'bandpass'
): void {
  const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(filterFreq, at);
  filter.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain * MASTER, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at);
}

/** Play a named sound, optionally delayed (seconds) to sequence after another. */
export function play(name: SoundName, delay = 0): void {
  if (soundMuted()) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  switch (name) {
    case 'chip':
      // Clay chips clacking onto a stack: two bright ticks.
      noise(ac, t, 0.03, 1.0, 2600, 4);
      noise(ac, t + 0.045, 0.035, 0.7, 2100, 4);
      tone(ac, t, 1900, 0.05, 'sine', 0.25);
      break;
    case 'deal':
      // Card sliding off the shoe: a soft swoosh.
      noise(ac, t, 0.16, 0.5, 900, 0.8, 'lowpass');
      noise(ac, t + 0.02, 0.1, 0.35, 3200, 2);
      break;
    case 'correct':
      // Gentle two-note "ding" up.
      tone(ac, t, 659, 0.11, 'sine', 0.8);
      tone(ac, t + 0.09, 880, 0.22, 'sine', 0.8);
      break;
    case 'incorrect':
      // Polite buzz, pitch sagging.
      tone(ac, t, 196, 0.26, 'sawtooth', 0.5, 155);
      tone(ac, t, 98, 0.26, 'sine', 0.5, 82);
      break;
    case 'win':
      // Little chime arpeggio + a chip clatter on the payout.
      tone(ac, t, 523, 0.1, 'triangle', 0.8);
      tone(ac, t + 0.08, 659, 0.1, 'triangle', 0.8);
      tone(ac, t + 0.16, 784, 0.28, 'triangle', 0.9);
      noise(ac, t + 0.2, 0.05, 0.5, 2400, 3);
      noise(ac, t + 0.27, 0.05, 0.4, 2000, 3);
      break;
    case 'push':
      tone(ac, t, 440, 0.14, 'sine', 0.5);
      break;
    case 'lose':
      tone(ac, t, 233, 0.3, 'sine', 0.55, 175);
      break;
    case 'bust':
      // The "womp": long saw glide down with a thud.
      tone(ac, t, 320, 0.55, 'sawtooth', 0.6, 90);
      tone(ac, t, 160, 0.55, 'sine', 0.6, 45);
      noise(ac, t + 0.02, 0.2, 0.4, 300, 0.7, 'lowpass');
      break;
  }
}
