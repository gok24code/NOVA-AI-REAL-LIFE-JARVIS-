"use client";

import { useCallback, useRef, useState } from "react";
import type { EditSceneApi } from "./editScene";
import { createEditScene } from "./editScene";

export function useEditMode() {
  const [enabled, setEnabled] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [hoveredModelName, setHoveredModelName] = useState<string | null>(null);

  const sceneRef = useRef<EditSceneApi | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelNamesRef = useRef<Map<string, string>>(new Map());

  const initialize = useCallback((container: HTMLDivElement) => {
    if (sceneRef.current) return;
    containerRef.current = container;
    sceneRef.current = createEditScene(container);
  }, []);

  const cleanup = useCallback(() => {
    if (sceneRef.current) {
      sceneRef.current.dispose();
      sceneRef.current = null;
    }
  }, []);

  const addModel = useCallback(
    async (url: string, name: string, format: "glb" | "stl") => {
      if (!sceneRef.current) return;
      const modelId = await sceneRef.current.addModel(url, name, format);
      modelNamesRef.current.set(modelId, name);
      setModelCount((prev) => prev + 1);
      sceneRef.current.arrangeRadial();
      sceneRef.current.focusOnModels();
      return modelId;
    },
    []
  );

  const loadAllModels = useCallback(
    async (models: Array<{ url: string; name: string; format: "glb" | "stl" }>) => {
      if (!sceneRef.current) return;
      sceneRef.current.clearAllModels();
      modelNamesRef.current.clear();

      for (const model of models) {
        const modelId = await sceneRef.current.addModel(
          model.url,
          model.name,
          model.format
        );
        modelNamesRef.current.set(modelId, model.name);
      }

      setModelCount(models.length);
      sceneRef.current.arrangeRadial();
      sceneRef.current.focusOnModels();
    },
    []
  );

  const selectModels = useCallback((modelIds: string[]) => {
    if (!sceneRef.current) return;
    sceneRef.current.setSelected(modelIds);
    setSelectedCount(modelIds.length);
  }, []);

  const raycastFromScreen = useCallback((x: number, y: number) => {
    if (!sceneRef.current) return null;
    const hit = sceneRef.current.raycastFromScreen(x, y);
    if (hit) {
      setHoveredModelName(modelNamesRef.current.get(hit.modelId) || "Model");
    }
    return hit;
  }, []);

  const rotateSelectedModels = useCallback(
    (axis: THREE.Vector3, deltaAngle: number) => {
      if (!sceneRef.current) return;
      sceneRef.current.rotateSelectedModels(axis, deltaAngle);
    },
    []
  );

  const selectModelsInBox = useCallback((start: THREE.Vector2, end: THREE.Vector2) => {
    if (!sceneRef.current) return;
    // Raycasting would go here for selection box
    // For now, just select first model hit in box area
  }, []);

  const dragModels = useCallback((modelIds: string[], delta: THREE.Vector3) => {
    if (!sceneRef.current) return;
    sceneRef.current.transformSelected("translate", delta);
  }, []);

  const getTransforms = useCallback(() => {
    if (!sceneRef.current) return new Map();
    return sceneRef.current.getModelTransforms();
  }, []);

  const getScene = useCallback(() => sceneRef.current, []);

  return {
    enabled,
    setEnabled,
    selectedCount,
    modelCount,
    hoveredModelName,
    initialize,
    cleanup,
    addModel,
    loadAllModels,
    selectModels,
    raycastFromScreen,
    rotateSelectedModels,
    dragModels,
    getTransforms,
    getScene,
    containerRef,
  };
}
