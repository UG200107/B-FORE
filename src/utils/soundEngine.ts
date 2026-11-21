/**
 * Zero-dependency synthesized SFX on the Web Audio API.
 *
 * The AudioContext is created lazily by `unlock()`, which must run inside a user gesture
 * (pointerdown / keydown) so browsers allow playback. Every sound is a no-op until then,
 * and while muted.
 */
import { IDLE_SPEED, spinEnvelope, spinProfile, spinTimeAt } from "./spin";

const STORAGE_KEY = "bfore:muted";
const MASTER_VOLUME = 0.5;

type Ctx = AudioContext;

class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        // Storage blocked: default to unmuted.
      }
    }
  }

  /* ---------- Lifecycle & mute ---------- */

  /** Create/resume the context. Call from a user-gesture handler. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.02);
    }
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ---------- Sound effects ---------- */

  /**
   * Mechanical ticks + whoosh following the Earth's spin envelope, a rising blip each time the
   * score counter climbs into a new colour tier, then a landing chime.
   * @param power   move points ÷ max points (0–1), the same value that sized the spin
   * @param tierMarks fractions (0–1) of the counted points at which a new tier is reached
   */
  rewind(power: number, optimal: boolean, tierMarks: number[] = []): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const { duration, peak } = spinProfile(power);
    const t0 = ctx.currentTime + 0.01;

    // Ticks: one per TICK_SPACING of band travel, so tick rate tracks spin speed.
    const TICK_SPACING = 18;
    const step = 0.004;
    let travelled = 0;
    let ticks = 0;
    for (let t = 0; t < duration && ticks < 220; t += step) {
      const env = spinEnvelope(t / duration);
      const v = IDLE_SPEED + (peak - IDLE_SPEED) * env;
      travelled += v * step;
      if (travelled >= TICK_SPACING) {
        travelled -= TICK_SPACING;
        ticks++;
        this.tick(ctx, out, t0 + t, 0.05 + 0.13 * env);
      }
    }

    // Whoosh: band-passed noise sweeping down, shaped like the spin.
    const intensity = Math.min(1, 0.3 + 0.7 * power);
    const src = this.noiseSource(ctx, duration + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t0);
    bp.frequency.exponentialRampToValueAtTime(1800 + 1400 * intensity, t0 + duration * 0.58);
    bp.frequency.exponentialRampToValueAtTime(350, t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16 * intensity, t0 + duration * 0.58);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + duration + 0.1);

    tierMarks.forEach((q, i) => this.tierUp(t0 + spinTimeAt(q) * duration, i));
    this.chime(t0 + duration * 0.95, optimal);
  }

  /** Short bright arpeggio blip; higher for each tier reached during one count-up. */
  private tierUp(at: number, step: number): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const base = [659.25, 783.99, 987.77, 1174.66, 1318.51][Math.min(step, 4)]; // E5 G5 B5 D6 E6
    [1, 2].forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.setValueAtTime(base * mult * 0.94, at);
      o.frequency.exponentialRampToValueAtTime(base * mult, at + 0.04);
      const g = this.envelope(ctx, at, 0.004, 0.22, i === 0 ? 0.11 : 0.04);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 0.3);
    });
  }

  /** Same-year guess: a soft, muted click. */
  nudge(): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.06);
    const g = this.envelope(ctx, t, 0.002, 0.08, 0.16);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.1);
    this.tick(ctx, out, t, 0.06, 1800);
  }

  /** Clock tick for the last seconds of a move; `urgent` is higher and louder. */
  countdown(urgent: boolean): void {
    const a = this.ready();
    if (!a) return;
    this.tick(a.ctx, a.out, a.ctx.currentTime + 0.01, urgent ? 0.12 : 0.07, urgent ? 2600 : 1900);
  }

  /** Paradox: low punchy thud + glitchy stutter, lasting about as long as the shudder (0.5s). */
  paradox(): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + 0.01;

    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(140, t);
    thud.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const tg = this.envelope(ctx, t, 0.004, 0.35, 0.55);
    thud.connect(tg).connect(out);
    thud.start(t);
    thud.stop(t + 0.4);

    // Glitch: square bursts at stepped pitches, timed with the shake's swings.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    lp.connect(out);
    [0, 0.07, 0.14, 0.24, 0.33].forEach((dt, i) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = [92, 69, 104, 58, 77][i];
      const g = this.envelope(ctx, t + dt, 0.002, 0.045, 0.09 * (1 - i * 0.15));
      o.connect(g).connect(lp);
      o.start(t + dt);
      o.stop(t + dt + 0.06);
    });

    const src = this.noiseSource(ctx, 0.12);
    const ng = this.envelope(ctx, t, 0.002, 0.1, 0.12);
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 900;
    src.connect(nf).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.12);
  }

  /**
   * The Earth blows up (all lives lost): a deep sub-bass boom, a long filtered rumble that
   * closes down like debris flying off, and a few bit-crunch crackles. `delaySec` lines it up
   * with the on-screen blast.
   */
  blast(delaySec = 0): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + 0.02 + delaySec;

    // Boom: a sine that drops from 120 Hz to a rumble.
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(120, t);
    boom.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const bg = this.envelope(ctx, t, 0.006, 1.4, 0.9);
    boom.connect(bg).connect(out);
    boom.start(t);
    boom.stop(t + 1.5);

    // Rumble: noise through a lowpass that closes from bright to dark over ~1.8 s.
    const src = this.noiseSource(ctx, 2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 1.8);
    const ng = this.envelope(ctx, t, 0.004, 1.9, 0.55);
    src.connect(lp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 2);

    // Crackles: short square bursts as chunks break away.
    [0.08, 0.19, 0.31, 0.47, 0.66].forEach((dt, i) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = [210, 150, 260, 120, 180][i];
      const g = this.envelope(ctx, t + dt, 0.002, 0.07, 0.07 * (1 - i * 0.12));
      o.connect(g).connect(out);
      o.start(t + dt);
      o.stop(t + dt + 0.1);
    });
  }

  /** Time Pulse: sonar ping with a fading echo. */
  pulse(): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + 0.01;

    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(out);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1320, t);
    o.frequency.exponentialRampToValueAtTime(1180, t + 0.9);
    const g = this.envelope(ctx, t, 0.005, 0.9, 0.2);
    o.connect(g);
    g.connect(out);
    g.connect(delay);
    o.start(t);
    o.stop(t + 1);
  }

  /** Round-end jingle: victory chord, soft resolve, or power-down. */
  roundEnd(kind: "victory" | "resolve" | "powerdown", delaySec = 0): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + 0.02 + delaySec;

    if (kind === "powerdown") {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 1.1);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(2200, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 1.1);
      const g = this.envelope(ctx, t, 0.01, 1.2, 0.14);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.25);
      return;
    }

    const notes = kind === "victory" ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37];
    notes.forEach((f, i) => {
      const at = t + i * 0.07;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = this.envelope(ctx, at, 0.008, kind === "victory" ? 1.4 : 0.8, 0.13);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 1.5);
    });
  }

  /* ---------- Building blocks ---------- */

  private ready(): { ctx: Ctx; out: GainNode } | null {
    // A context still resuming is fine: scheduled nodes play as soon as it runs.
    if (this.muted || !this.ctx || !this.master || this.ctx.state === "closed") return null;
    return { ctx: this.ctx, out: this.master };
  }

  private chime(at: number, optimal: boolean): void {
    const a = this.ready();
    if (!a) return;
    const { ctx, out } = a;
    const base = optimal ? 1567.98 : 1318.51; // G6 vs E6
    [1, 1.5, 2.01].forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = base * mult;
      const g = this.envelope(ctx, at, 0.003, 0.7 - i * 0.15, [0.14, 0.05, 0.03][i]);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 0.8);
    });
  }

  private tick(ctx: Ctx, out: AudioNode, at: number, gain: number, freq = 3200): void {
    const src = this.noiseSource(ctx, 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 4;
    const g = this.envelope(ctx, at, 0.0008, 0.018, gain);
    src.connect(bp).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.03);
  }

  /** Gain node with a fast linear attack and exponential decay. */
  private envelope(ctx: Ctx, at: number, attack: number, decay: number, peak: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  private noiseSource(ctx: Ctx, duration: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = duration > 1;
    return src;
  }

  private makeNoise(ctx: Ctx): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}

/** App-wide singleton. */
export const sound = new SoundEngine();
