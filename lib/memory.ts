"use client";

const STORAGE_KEY = "nova_conversation";
const MAX_STORED = 40; // son 40 mesaj = ~20 konuşma turu

export type Message = { role: "user" | "assistant"; content: string };

export function loadMemory(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}

export function saveMemory(messages: Message[]): void {
  try {
    const trimmed = messages.slice(-MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* storage dolu olabilir */ }
}

export function clearMemory(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
