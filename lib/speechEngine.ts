"use client";

// Unified speech-to-text entry point used by both useVoice.ts (command
// listening) and useAlwaysOn.ts (background wake-word listening).
//
// Primary engine: the browser's Web Speech API (webkitSpeechRecognition) —
// free, fast, streaming, and what NOVA has always used in Chrome.
//
// Problem: inside Electron, `webkitSpeechRecognition` exists (Chromium ships
// the constructor) but every recognition attempt fails with `error: "network"`,
// because the actual recognition happens on Google's servers and reaching
// them requires a private API key that's baked into official Chrome builds —
// Electron's Chromium doesn't have it. There is no config fix for this.
//
// Fallback engine: local whisper.cpp server (whisper-server.exe), proxied
// through app/api/stt/route.ts the same way /api/llm proxies to Ollama —
// fully offline, no API key. Slower (record → upload → transcribe, not
// real-time streaming) so it's only used when Web Speech has proven itself
// unusable this session.
//
// Detection: after a couple of consecutive "network" errors from Web Speech,
// we stop trusting it for the rest of the session and switch every future
// startListen() call to the Whisper path — this also transparently covers a
// real Chrome tab that temporarily lost internet access.

export type EngineResultHandler = (text: string, confidence: number) => void;
export type EngineErrorHandler = (error: string) => void;

export interface ListenHandle {
  stop: () => void;
}

export interface ListenOptions {
  lang: string;
  onStart?: () => void;
  onResult: EngineResultHandler;
  onEnd: () => void;
  onError: EngineErrorHandler;
}

type SRCtor = new () => SpeechRecognition;

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const NETWORK_ERROR_THRESHOLD = 2;
let consecutiveNetworkErrors = 0;
let forcedWhisper = false;

function noteWebSpeechError(error: string) {
  if (error === "network") {
    consecutiveNetworkErrors += 1;
    if (consecutiveNetworkErrors >= NETWORK_ERROR_THRESHOLD) {
      forcedWhisper = true;
      console.warn("[speechEngine] Web Speech API unusable (repeated 'network' errors) — switching to local Whisper fallback for this session.");
    }
  } else {
    consecutiveNetworkErrors = 0;
  }
}

export function canListen(): boolean {
  if (getSR()) return true;
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function startListen(opts: ListenOptions): ListenHandle {
  const SRClass = getSR();
  if (SRClass && !forcedWhisper) {
    return startWebSpeech(SRClass, opts);
  }
  return startWhisperListen(opts);
}

// ─── Engine 1: Web Speech API ────────────────────────────────────────────────

function startWebSpeech(SRClass: SRCtor, opts: ListenOptions): ListenHandle {
  const rec = new SRClass();
  rec.lang = opts.lang;
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => opts.onStart?.();

  rec.onresult = (e: SpeechRecognitionEvent) => {
    consecutiveNetworkErrors = 0;
    const result = e.results[0][0];
    opts.onResult(result.transcript.trim(), result.confidence);
  };

  rec.onerror = (e: SpeechRecognitionErrorEvent) => {
    noteWebSpeechError(e.error);
    opts.onError(e.error);
  };

  rec.onend = () => opts.onEnd();

  try {
    rec.start();
  } catch (err) {
    opts.onError(err instanceof Error ? err.message : "start_failed");
  }

  return { stop: () => { try { rec.abort(); } catch { /* ignore */ } } };
}

// ─── Engine 2: local Whisper (record → /api/stt) ─────────────────────────────

const SAMPLE_RATE = 16000;
const MAX_RECORD_MS = 7000;
const SILENCE_STOP_MS = 600;
const SPEECH_RMS_THRESHOLD = 0.012;

let sharedMicStream: MediaStream | null = null;

async function getMicStream(): Promise<MediaStream> {
  if (sharedMicStream && sharedMicStream.active) return sharedMicStream;
  sharedMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return sharedMicStream;
}

// Downmix to mono + resample to 16kHz using an OfflineAudioContext — the
// format the local whisper.cpp server (see app/api/stt/route.ts) expects.
async function decodeToPCM16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Wrap 16kHz mono Float32 PCM into a standard 16-bit PCM WAV file —
// whisper.cpp's server expects a real WAV file, not a raw sample buffer.
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function startWhisperListen(opts: ListenOptions): ListenHandle {
  let stopped = false;
  let externallyStopped = false;
  let recorder: MediaRecorder | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;
  let hasSpoken = false;
  const chunks: Blob[] = [];

  function cleanupTimers() {
    if (maxTimer) clearTimeout(maxTimer);
    if (silenceTimer) clearTimeout(silenceTimer);
    if (rafId) cancelAnimationFrame(rafId);
    maxTimer = null;
    silenceTimer = null;
    rafId = null;
  }

  function watchVolume() {
    if (stopped || !analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    let sumSquares = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / buf.length);

    if (rms > SPEECH_RMS_THRESHOLD) {
      hasSpoken = true;
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    } else if (hasSpoken && !silenceTimer) {
      silenceTimer = setTimeout(finish, SILENCE_STOP_MS);
    }
    rafId = requestAnimationFrame(watchVolume);
  }

  function finish() {
    if (stopped) return;
    stopped = true;
    cleanupTimers();
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      void transcribeAndReport();
    }
  }

  async function transcribeAndReport() {
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;

    if (externallyStopped || !hasSpoken || chunks.length === 0) {
      opts.onError(externallyStopped ? "aborted" : "no-speech");
      opts.onEnd();
      return;
    }

    try {
      const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
      const pcm = await decodeToPCM16k(blob);
      const wav = encodeWAV(pcm, SAMPLE_RATE);
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
      });
      if (!res.ok) throw new Error(`stt_failed_${res.status}`);
      const data = (await res.json()) as { text?: string };
      let text = (data.text ?? "").trim();
      // Whisper hallucinates non-speech sound tags (e.g. "[MÜZİK ÇALIYOR]",
      // "(Müzik)", "*KAPI SESİ*", or the same tag repeated on several lines)
      // when fed ambient noise instead of real speech — strip a transcript
      // that's entirely made of these rather than treat it as a real command.
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0 && lines.every((l) => /^(?:[[(].*[\])]|\*.*\*)[.!]?$/.test(l))) {
        text = "";
      }
      // No actual letters at all (e.g. "...", repeated punctuation) → not speech.
      if (!/\p{L}/u.test(text)) text = "";
      if (text) {
        opts.onResult(text, 1);
      } else {
        opts.onError("no-speech");
      }
    } catch (err) {
      console.error("[speechEngine] whisper transcription failed:", err);
      opts.onError("network");
    } finally {
      opts.onEnd();
    }
  }

  (async () => {
    try {
      const stream = await getMicStream();
      if (stopped) return;

      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => { void transcribeAndReport(); };
      recorder.start();

      opts.onStart?.();
      maxTimer = setTimeout(finish, MAX_RECORD_MS);
      rafId = requestAnimationFrame(watchVolume);
    } catch (err) {
      console.error("[speechEngine] mic capture failed:", err);
      stopped = true;
      opts.onError("audio-capture");
      opts.onEnd();
    }
  })();

  return {
    stop: () => {
      if (stopped) return;
      externallyStopped = true;
      stopped = true;
      cleanupTimers();
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        audioCtx?.close().catch(() => {});
      }
    },
  };
}
