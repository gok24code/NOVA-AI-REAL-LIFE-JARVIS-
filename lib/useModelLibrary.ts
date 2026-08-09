"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbSceneApi } from "./orbScene";

export interface ModelEntry {
  file: File;
  name: string;
}

export function useModelLibrary(scene: OrbSceneApi | null) {
  const [files, setFiles]               = useState<ModelEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [dirName, setDirName]           = useState("");
  const prevUrlRef = useRef<string | null>(null);

  // Refs keep the latest state visible inside stable useCallback closures
  const filesRef        = useRef<ModelEntry[]>([]);
  const currentIndexRef = useRef(-1);
  const sceneRef        = useRef<OrbSceneApi | null>(null);

  useEffect(() => { filesRef.current = files; },          [files]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { sceneRef.current = scene; },          [scene]);

  const loadAtIndex = useCallback(async (idx: number, allFiles?: ModelEntry[]): Promise<void> => {
    const sc   = sceneRef.current;
    const list = allFiles ?? filesRef.current;
    if (!sc || idx < 0 || idx >= list.length) return;
    const entry = list[idx];
    try {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      const url = URL.createObjectURL(entry.file);
      prevUrlRef.current = url;
      const format = /\.stl$/i.test(entry.name) ? "stl" : "glb";
      await sc.loadModel(url, entry.name.replace(/\.(glb|gltf|stl)$/i, ""), format);
      setCurrentIndex(idx);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Called from JarvisOrb's hidden <input type="file" webkitdirectory> onChange
  const loadFiles = useCallback(async (fileList: FileList | File[]): Promise<string | null> => {
    const arr = Array.from(fileList);
    const collected: ModelEntry[] = arr
      .filter((f) => /\.(glb|gltf|stl)$/i.test(f.name))
      .map((f) => ({ file: f, name: f.name }));
    collected.sort((a, b) => a.name.localeCompare(b.name));

    const firstPath = arr[0]?.webkitRelativePath ?? "";
    const folder = firstPath.split("/")[0] ?? "Seçilen dosyalar";

    setFiles(collected);
    setCurrentIndex(-1);
    setDirName(folder);

    if (collected.length === 0) return `${folder} klasöründe model bulunamadı.`;
    await loadAtIndex(0, collected);
    return `${collected.length} model bulundu. ${collected[0].name} yükleniyor.`;
  }, [loadAtIndex]);

  const loadNext = useCallback(async (): Promise<string> => {
    const list = filesRef.current;
    if (list.length === 0) return "Önce model klasörü seçin.";
    const next = (currentIndexRef.current + 1) % list.length;
    await loadAtIndex(next);
    return `${list[next].name} yükleniyor.`;
  }, [loadAtIndex]);

  const loadPrev = useCallback(async (): Promise<string> => {
    const list = filesRef.current;
    if (list.length === 0) return "Önce model klasörü seçin.";
    const prev = (currentIndexRef.current - 1 + list.length) % list.length;
    await loadAtIndex(prev);
    return `${list[prev].name} yükleniyor.`;
  }, [loadAtIndex]);

  // Klasör bu oturumda zaten seçilmişse, tekrar seçtirmeden mevcut modeli
  // (veya ilkini) doğrudan ekrana getirir
  const showLoaded = useCallback(async (): Promise<string> => {
    const list = filesRef.current;
    if (list.length === 0) return "";
    const idx = currentIndexRef.current >= 0 ? currentIndexRef.current : 0;
    await loadAtIndex(idx, list);
    return `${list[idx].name} gösteriliyor.`;
  }, [loadAtIndex]);

  const loadByName = useCallback(async (name: string): Promise<string> => {
    const list  = filesRef.current;
    const lower = name.toLowerCase();
    const idx   = list.findIndex((f) => f.name.toLowerCase().includes(lower));
    if (idx < 0) return `${name} adında model bulunamadı.`;
    await loadAtIndex(idx);
    return `${list[idx].name} yükleniyor.`;
  }, [loadAtIndex]);

  const clearModel = useCallback((): void => {
    sceneRef.current?.clearModel();
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setFiles([]);
    setCurrentIndex(-1);
    setDirName("");
  }, []);

  // Electron path: electron/preload.js's dialog returns raw {name, data}
  // pairs instead of browser File objects — wrap them into real Files so
  // loadFiles()/loadAtIndex() don't need to know which path it came from.
  const loadPickedFolder = useCallback(async (picked: PickedModelFolder): Promise<string> => {
    const asFiles = picked.files.map((f) => new File([f.data], f.name));
    return (await loadFiles(asFiles)) ?? `${picked.dirName}: model bulunamadı.`;
  }, [loadFiles]);

  return { files, currentIndex, dirName, loadFiles, loadPickedFolder, loadNext, loadPrev, loadByName, showLoaded, clearModel };
}
