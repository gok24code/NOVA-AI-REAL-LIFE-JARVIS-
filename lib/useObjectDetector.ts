"use client";

import { useState, useCallback } from "react";

export interface DetectionResult {
  found: boolean;
  object: string;
  description: string;
}

function splitDataUrl(dataUrl: string): { imageBase64: string; mimeType: string } {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const imageBase64 = dataUrl.slice(comma + 1);
  const mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  return { imageBase64, mimeType };
}

export function useObjectDetector() {
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const loadProgress = 0;

  const detect = useCallback(async (dataUrl: string): Promise<DetectionResult> => {
    setModelStatus("loading");
    try {
      const body = splitDataUrl(dataUrl);
      const res = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as DetectionResult & { error?: string };
      setModelStatus("ready");
      if (data.error) return { found: false, object: "", description: "" };
      return data;
    } catch {
      setModelStatus("error");
      return { found: false, object: "", description: "Tespit başarısız." };
    }
  }, []);

  const describeScene = useCallback(async (dataUrl: string): Promise<string> => {
    setModelStatus("loading");
    try {
      const body = { ...splitDataUrl(dataUrl), mode: "describe" };
      const res = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { description?: string; error?: string };
      setModelStatus("ready");
      return data.description ?? "Sahne analizi başarısız.";
    } catch {
      setModelStatus("error");
      return "Sahne analizi başarısız.";
    }
  }, []);

  return { modelStatus, loadProgress, detect, describeScene };
}
