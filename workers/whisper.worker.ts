import { pipeline, env } from "@xenova/transformers";

// Always fetch models from HuggingFace CDN, never from localhost
env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

interface IncomingMessage {
  type: "init" | "transcribe";
  audio?: Float32Array;
}

self.addEventListener("message", async (e: MessageEvent<IncomingMessage>) => {
  const { type, audio } = e.data;

  if (type === "init") {
    try {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny",
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          progress_callback: (info: any) => {
            if (info.status === "progress" || info.status === "download") {
              self.postMessage({
                type: "loading",
                progress: Math.round(info.progress ?? 0),
                file: info.file ?? "",
              });
            }
          },
        },
      );
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }

  if (type === "transcribe" && audio) {
    if (!transcriber) {
      self.postMessage({ type: "error", message: "Model henüz hazır değil" });
      return;
    }
    try {
      self.postMessage({ type: "transcribing" });
      const result = await transcriber(audio, {
        language: "turkish",
        task: "transcribe",
      });
      const text: string = Array.isArray(result)
        ? ((result[0] as { text: string }).text ?? "")
        : ((result as { text: string }).text ?? "");
      self.postMessage({ type: "result", text: text.trim() });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
});
