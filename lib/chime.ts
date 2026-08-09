"use client";

// Short synthesized "bing" cue played right as NOVA starts actively
// listening for a command — no audio asset needed, just two quick sine
// tones through the Web Audio API.
let chimeCtx: AudioContext | null = null;

export function playListenChime() {
  try {
    const ctx = chimeCtx ?? (chimeCtx = new AudioContext());
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1318.51, now + 0.09);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + 0.18);

    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    // ignore — non-essential UX cue
  }
}
