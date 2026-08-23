"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceResult } from "./useVoice";
import { canListen, startListen, type ListenHandle } from "./speechEngine";

export type WakeStatus = "off" | "background" | "activated";

const WAKE_WORDS       = ["nova"];
const RESTART_DELAY_MS = 150;
const WATCHDOG_MS      = 2500; // activated modda hiçbir şey olmuyorsa zorla restart

function containsWake(text: string): boolean {
  const t = text.toLowerCase().trim();
  return WAKE_WORDS.some((w) => t.includes(w));
}

export function useAlwaysOn(voice: VoiceResult) {
  const [status, setStatus]  = useState<WakeStatus>("off");
  const statusRef            = useRef<WakeStatus>("off");
  const enabledRef           = useRef(false);
  const recRef               = useRef<ListenHandle | null>(null);
  const watchdogRef          = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setStatusBoth(s: WakeStatus) {
    statusRef.current = s;
    setStatus(s);
  }

  const stopSession = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
  }, []);

  // ── Background: wake word dinleme döngüsü ──────────────────────────────────
  const startSession = useCallback(() => {
    if (!canListen() || !enabledRef.current || recRef.current) return;
    if (voice.modelStatus === "speaking" || voice.isListening) return;

    recRef.current = startListen({
      lang: "tr-TR",
      onResult: (text, confidence) => {
        console.log(`[wake] result: "${text}" (confidence ${confidence})`);
        if (confidence < 0.5 || text.length < 2) return;
        if (statusRef.current === "background" && containsWake(text)) {
          setStatusBoth("activated");
          // Komut dinleyicisini başlatmadan önce arka plan tanımayı kesin olarak
          // durdur — aksi halde aynı anda iki dinleme oturumuna izin verilmez,
          // start() sessizce/senkron olarak hata fırlatabilir ve sistem kalıcı
          // olarak "dinlemez" duruma kilitlenebilir.
          try { recRef.current?.stop(); } catch { /* ignore */ }
          recRef.current = null;
          if (!voice.isListening) voice.startListening();
        }
      },
      onEnd: () => {
        recRef.current = null;
        if (!enabledRef.current) return;
        if (statusRef.current === "background") {
          setTimeout(startSession, RESTART_DELAY_MS);
        }
      },
      onError: (error) => {
        if (error !== "no-speech" && error !== "aborted") {
          console.error("[wake] recognition error:", error);
        }
        recRef.current = null;
        if (!enabledRef.current) return;
        if (statusRef.current === "background") {
          setTimeout(startSession, 400);
        }
      },
    });
  }, [voice]);

  // ── Ana döngü: activated modda dinleme bitmişse hemen yeniden başlat ───────
  useEffect(() => {
    if (!enabledRef.current) return;
    if (statusRef.current !== "activated") return;
    if (voice.isListening || voice.modelStatus === "speaking" || voice.modelStatus === "thinking") return;

    // ready / error / herhangi bir non-listening state → yeniden dinle
    const timer = setTimeout(() => {
      if (
        enabledRef.current &&
        statusRef.current === "activated" &&
        !voice.isListening &&
        voice.modelStatus !== "speaking" &&
        voice.modelStatus !== "thinking"
      ) {
        voice.startListening();
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [voice.isListening, voice.modelStatus, voice.startListening]);

  // ── Watchdog: activated modda takılı kalırsa zorla restart ─────────────────
  useEffect(() => {
    if (status !== "activated") {
      clearTimeout(watchdogRef.current!);
      return;
    }

    function arm() {
      clearTimeout(watchdogRef.current!);
      watchdogRef.current = setTimeout(() => {
        if (
          enabledRef.current &&
          statusRef.current === "activated" &&
          !voice.isListening &&
          voice.modelStatus !== "speaking" &&
          voice.modelStatus !== "thinking"
        ) {
          voice.startListening();
        }
        arm(); // kendini yeniden kur
      }, WATCHDOG_MS);
    }

    arm();
    return () => clearTimeout(watchdogRef.current!);
  }, [status, voice.isListening, voice.modelStatus, voice.startListening]);

  // ── sleep intent: "sus" / "uyu" komutu ────────────────────────────────────
  const goToSleep = useCallback(() => {
    clearTimeout(watchdogRef.current!);
    setStatusBoth("background");
    if (!recRef.current) setTimeout(startSession, 300);
  }, [startSession]);

  // ── Toggle ─────────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      clearTimeout(watchdogRef.current!);
      stopSession();
      voice.stopListening();
      setStatusBoth("off");
    } else {
      enabledRef.current = true;
      setStatusBoth("background");
      setTimeout(startSession, 100);
    }
  }, [startSession, stopSession, voice]);

  // ── Background session restart (speaking bitti) ────────────────────────────
  useEffect(() => {
    if (!enabledRef.current) return;
    if (statusRef.current !== "background") return;
    if (voice.modelStatus === "ready" && !recRef.current && !voice.isListening) {
      setTimeout(startSession, 300);
    }
  }, [voice.modelStatus, voice.isListening, startSession]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      enabledRef.current = false;
      clearTimeout(watchdogRef.current!);
      stopSession();
    };
  }, [stopSession]);

  return { status, toggle, goToSleep };
}
