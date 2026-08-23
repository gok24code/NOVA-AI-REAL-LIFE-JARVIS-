"use client";

import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

export interface EditSceneApi {
  dispose(): void;
  addModel(url: string, name?: string, format?: "glb" | "stl"): Promise<string>;
  removeModel(modelId: string): void;
  clearAllModels(): void;
  raycastFromScreen(x: number, y: number): RaycastHit | null;
  setSelected(modelIds: string[]): void;
  getSelected(): string[];
  transformSelected(type: "translate" | "rotate", delta: THREE.Vector3): void;
  rotateSelectedModels(axis: THREE.Vector3, deltaAngle: number): void;
  /** Accumulates rotation velocity for the selected models (orb-style inertia). Decays each frame via friction. */
  addRotationVelocity(deltaTheta: number, deltaPhi: number): void;
  /** Direct-follow translate of the selected models (gesture drag). */
  dragSelectedModels(deltaX: number, deltaY: number): void;
  /** Moves the camera to frame the given models (or all). Does not move the models themselves. */
  focusOnModels(modelIds?: string[]): void;
  /** One-time radial layout around the central assembly sphere — call right after loading a batch of models. */
  arrangeRadial(modelIds?: string[]): void;
  /** Parts currently resting inside the assembly sphere, with their relative transforms. */
  getAssemblyParts(): AssemblyPart[];
  getModelTransforms(): Map<string, ModelTransform>;
  updateSize(width: number, height: number): void;
  /** Accumulates zoom velocity (orb-style: impulse + exponential coast, no teleport). */
  zoomCamera(factor: number): void;
}

export interface RaycastHit {
  modelId: string;
  distance: number;
  point: THREE.Vector3;
}

export interface ModelTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

interface LoadedModel {
  id: string;
  name: string;
  mesh: THREE.Group;
  solid: THREE.Mesh;
  edges: THREE.LineSegments;
  bbox: THREE.Box3;
  isSelected: boolean;
  isAssembled: boolean;
}

export interface AssemblyPart {
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const HOLO_COLOR = 0x06b6d4;
const HOLO_SELECTED_COLOR = 0xfbbf24;
const HOLO_ASSEMBLED_COLOR = 0x22c55e;

/** Reserved id: grabbing the central assembly sphere selects it as a global-rotation handle. */
export const CENTER_HANDLE_ID = "__assembly_center__";

function makeHoloMaterials(color: number) {
  const solidMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
  });
  return { solidMat, edgeMat };
}

export function createEditScene(container: HTMLElement): EditSceneApi {
  const scene = new THREE.Scene();
  // Transparent — the static CSS grid backdrop (.edit-mode-bg) shows through
  scene.background = null;

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;

  // Camera: perspective for better model viewing
  const camera = new THREE.PerspectiveCamera(
    75,
    width / height,
    0.1,
    10000
  );
  camera.position.set(0, 0, 150);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(100, 100, 100);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Model container
  const modelsGroup = new THREE.Group();
  scene.add(modelsGroup);

  // Central assembly sphere — parts resting inside it count as "assembled"
  let assemblyRadius = 50;
  const assemblySphereGeo = new THREE.SphereGeometry(1, 32, 20);
  const assemblySphereFillMat = new THREE.MeshBasicMaterial({
    color: HOLO_COLOR,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
  });
  const assemblySphereWireMat = new THREE.MeshBasicMaterial({
    color: HOLO_COLOR,
    transparent: true,
    opacity: 0.22,
    wireframe: true,
    depthWrite: false,
  });
  const assemblySphere = new THREE.Mesh(assemblySphereGeo, assemblySphereFillMat);
  const assemblySphereWire = new THREE.Mesh(assemblySphereGeo, assemblySphereWireMat);
  assemblySphere.add(assemblySphereWire);
  assemblySphere.visible = false;
  assemblySphere.renderOrder = -1;
  assemblySphere.userData.modelId = CENTER_HANDLE_ID;
  scene.add(assemblySphere);

  // Raycaster
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  // Helper for raycast — tests loaded models plus the central handle sphere (when visible)
  function raycastFromScreenInternal(x: number, y: number): RaycastHit | null {
    mouse.x = (x / width) * 2 - 1;
    mouse.y = -(y / height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const targets: THREE.Object3D[] = [...modelsGroup.children];
    if (assemblySphere.visible) targets.push(assemblySphere);
    const intersects = raycaster.intersectObjects(targets, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      let modelId: string | null = null;
      let obj = hit.object as any;
      while (obj && !modelId) {
        if (obj.userData?.modelId) {
          modelId = obj.userData.modelId;
        }
        obj = obj.parent;
      }
      if (modelId) {
        return { modelId, distance: hit.distance, point: hit.point };
      }
    }
    return null;
  }

  // State
  const loadedModels = new Map<string, LoadedModel>();
  let selectedModelIds = new Set<string>();
  let modelCounter = 0;
  // Central handle: when grabbed, rotation spins the whole assembly instead of one model
  let centerSelected = false;

  // Drag state (mouse)
  let isDragging = false;
  let draggedModelId: string | null = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Camera dolly target — updated by focusOnModels, orbited/zoomed around
  const cameraTarget = new THREE.Vector3(0, 0, 0);

  // Scratch vectors for camera-relative (view-plane) dragging
  const dragRightScratch = new THREE.Vector3();
  const dragUpScratch = new THREE.Vector3();
  const dragForwardScratch = new THREE.Vector3();
  const dragCenterScratch = new THREE.Vector3();
  const dragWorldDeltaScratch = new THREE.Vector3();

  // Velocity-based zoom (mirrors orb: impulse + exponential coast, never teleports)
  let zoomVelocity = 0;
  const ZOOM_MAX = 0.075;
  const ZOOM_FRICTION_GESTURE = 0.97;
  const MIN_DISTANCE = 2;
  const MAX_DISTANCE = 9000;

  // Velocity-based model rotation (mirrors orb's hand-tracker inertia)
  let modelRotVelTheta = 0;
  let modelRotVelPhi = 0;
  const ROT_FRICTION = 0.80;
  const YAW_AXIS = new THREE.Vector3(0, 1, 0);
  const PITCH_AXIS = new THREE.Vector3(1, 0, 0);

  // Shared rotation helper — spins the current selection as one rigid group
  // around their combined bbox center.
  const rotationQuatScratch = new THREE.Quaternion();
  function applyRotationToSelection(axis: THREE.Vector3, deltaAngle: number) {
    if (selectedModelIds.size === 0) return;

    const bbox = new THREE.Box3();
    selectedModelIds.forEach((id) => {
      const model = loadedModels.get(id);
      if (model) bbox.expandByObject(model.mesh);
    });

    const center = new THREE.Vector3();
    bbox.getCenter(center);

    rotationQuatScratch.setFromAxisAngle(axis, deltaAngle);

    selectedModelIds.forEach((id) => {
      const model = loadedModels.get(id);
      if (model) {
        model.mesh.position.sub(center);
        model.mesh.position.applyQuaternion(rotationQuatScratch);
        model.mesh.position.add(center);
        model.mesh.quaternion.multiplyQuaternions(rotationQuatScratch, model.mesh.quaternion);
      }
    });
  }

  // Spins every loaded model around the world origin — used when the central
  // handle sphere is grabbed, for a "rotate the whole assembly" gesture.
  function rotateAllModelsAroundOrigin(axis: THREE.Vector3, deltaAngle: number) {
    rotationQuatScratch.setFromAxisAngle(axis, deltaAngle);
    loadedModels.forEach((model) => {
      model.mesh.position.applyQuaternion(rotationQuatScratch);
      model.mesh.quaternion.multiplyQuaternions(rotationQuatScratch, model.mesh.quaternion);
    });
  }

  // Recolors a model based on selected > assembled > default priority.
  function updateModelColor(model: LoadedModel) {
    const color = model.isSelected
      ? HOLO_SELECTED_COLOR
      : model.isAssembled
      ? HOLO_ASSEMBLED_COLOR
      : HOLO_COLOR;
    (model.solid.material as THREE.MeshBasicMaterial).color.setHex(color);
    (model.edges.material as THREE.LineBasicMaterial).color.setHex(color);
  }

  // Moves the selection within the camera's own view plane — whichever axis
  // you're looking down, drag naturally follows that plane (top-down → XZ,
  // side-on → XY, etc), and speed scales with distance so it always feels right.
  function applyDragDelta(deltaX: number, deltaY: number) {
    if (selectedModelIds.size === 0) return;

    camera.matrixWorld.extractBasis(dragRightScratch, dragUpScratch, dragForwardScratch);

    const bbox = new THREE.Box3();
    selectedModelIds.forEach((id) => {
      const model = loadedModels.get(id);
      if (model) bbox.expandByObject(model.mesh);
    });
    const center = bbox.isEmpty() ? cameraTarget : bbox.getCenter(dragCenterScratch);
    const dist = camera.position.distanceTo(center);
    const scale = Math.max(dist * 0.18, 18);

    dragWorldDeltaScratch
      .copy(dragRightScratch)
      .multiplyScalar(deltaX * scale)
      .addScaledVector(dragUpScratch, -deltaY * scale);

    selectedModelIds.forEach((id) => {
      const model = loadedModels.get(id);
      if (model) model.mesh.position.add(dragWorldDeltaScratch);
    });
  }

  // Loaders
  const gltfLoader = new GLTFLoader();
  const stlLoader = new STLLoader();

  // Mouse drag handlers
  renderer.domElement.addEventListener("mousedown", (e: MouseEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = raycastFromScreenInternal(x, y);
    if (hit && selectedModelIds.has(hit.modelId)) {
      isDragging = true;
      draggedModelId = hit.modelId;
      lastMouseX = x;
      lastMouseY = y;
    }
  });

  renderer.domElement.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDragging || !draggedModelId) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - lastMouseX;
    const dy = y - lastMouseY;

    applyDragDelta(dx / width, dy / height);
    lastMouseX = x;
    lastMouseY = y;
  });

  renderer.domElement.addEventListener("mouseup", () => {
    isDragging = false;
    draggedModelId = null;
  });

  // Animation loop
  const offsetScratch = new THREE.Vector3();
  let animationFrameId: number;
  const animate = () => {
    animationFrameId = requestAnimationFrame(animate);

    // ── Velocity zoom (orb-style: exponential dolly, no teleport) ──────────
    if (Math.abs(zoomVelocity) > 0.00008) {
      offsetScratch.copy(camera.position).sub(cameraTarget);
      const newDist = THREE.MathUtils.clamp(
        offsetScratch.length() * Math.exp(-zoomVelocity),
        MIN_DISTANCE,
        MAX_DISTANCE,
      );
      offsetScratch.setLength(newDist);
      camera.position.copy(cameraTarget).add(offsetScratch);
      zoomVelocity *= ZOOM_FRICTION_GESTURE;
      if (Math.abs(zoomVelocity) < 0.00008) zoomVelocity = 0;
    }

    // ── Velocity rotation (orb-style hand-tracker inertia, applied to selection) ──
    if (Math.abs(modelRotVelTheta) > 0.00005 || Math.abs(modelRotVelPhi) > 0.00005) {
      if (centerSelected) {
        rotateAllModelsAroundOrigin(YAW_AXIS, modelRotVelTheta);
        rotateAllModelsAroundOrigin(PITCH_AXIS, modelRotVelPhi);
      } else if (selectedModelIds.size > 0) {
        applyRotationToSelection(YAW_AXIS, modelRotVelTheta);
        applyRotationToSelection(PITCH_AXIS, modelRotVelPhi);
      }
      modelRotVelTheta *= ROT_FRICTION;
      modelRotVelPhi *= ROT_FRICTION;
      if (Math.abs(modelRotVelTheta) < 0.00005) modelRotVelTheta = 0;
      if (Math.abs(modelRotVelPhi) < 0.00005) modelRotVelPhi = 0;
    }

    // ── Assembly zone check — pieces resting inside the sphere are "assembled" ──
    if (assemblySphere.visible) {
      loadedModels.forEach((model) => {
        const assembled = model.mesh.position.length() < assemblyRadius;
        if (model.isAssembled !== assembled) {
          model.isAssembled = assembled;
          updateModelColor(model);
        }
      });
    }

    renderer.render(scene, camera);
  };
  animate();

  // API Implementation
  const api: EditSceneApi = {
    dispose() {
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      scene.clear();
    },

    async addModel(url: string, name = "Model", format = "glb"): Promise<string> {
      const modelId = `model_${modelCounter++}`;

      try {
        let geometry: THREE.BufferGeometry;

        if (format === "stl") {
          geometry = stlLoader.parse(
            await fetch(url).then((r) => r.arrayBuffer())
          );
        } else {
          const gltf = await gltfLoader.loadAsync(url);
          const root = gltf.scene;
          geometry = new THREE.BufferGeometry();

          root.traverse((child) => {
            if ((child as any).isMesh) {
              const mesh = child as THREE.Mesh;
              if (!geometry.attributes.position) {
                geometry.copy(mesh.geometry as THREE.BufferGeometry);
              }
            }
          });
        }

        geometry.center();
        geometry.computeBoundingBox();

        const { solidMat, edgeMat } = makeHoloMaterials(HOLO_COLOR);
        const solid = new THREE.Mesh(geometry, solidMat);
        const edgesGeo = new THREE.EdgesGeometry(geometry, 25);
        const edges = new THREE.LineSegments(edgesGeo, edgeMat);

        const group = new THREE.Group();
        group.add(solid, edges);
        group.userData.modelId = modelId;

        if (geometry.boundingBox) {
          const boxHelper = new THREE.Box3Helper(geometry.boundingBox, HOLO_COLOR);
          (boxHelper.material as THREE.LineBasicMaterial).transparent = true;
          (boxHelper.material as THREE.LineBasicMaterial).opacity = 0.35;
          group.add(boxHelper);
        }

        const bbox = new THREE.Box3().setFromObject(group);

        const model: LoadedModel = {
          id: modelId,
          name,
          mesh: group,
          solid,
          edges,
          bbox,
          isSelected: false,
          isAssembled: false,
        };

        loadedModels.set(modelId, model);
        modelsGroup.add(group);

        return modelId;
      } catch (err) {
        console.error("Model load error:", err);
        throw err;
      }
    },

    removeModel(modelId: string) {
      const model = loadedModels.get(modelId);
      if (model) {
        modelsGroup.remove(model.mesh);
        loadedModels.delete(modelId);
        selectedModelIds.delete(modelId);
      }
    },

    clearAllModels() {
      for (const [modelId] of loadedModels) {
        this.removeModel(modelId);
      }
      selectedModelIds.clear();
    },

    raycastFromScreen(x: number, y: number): RaycastHit | null {
      return raycastFromScreenInternal(x, y);
    },

    setSelected(modelIds: string[]) {
      selectedModelIds.forEach((id) => {
        const model = loadedModels.get(id);
        if (model) {
          model.isSelected = false;
          updateModelColor(model);
        }
      });

      const isCenter = modelIds.includes(CENTER_HANDLE_ID);
      centerSelected = isCenter;
      (assemblySphereWireMat as THREE.MeshBasicMaterial).color.setHex(
        isCenter ? HOLO_SELECTED_COLOR : HOLO_COLOR,
      );
      assemblySphereWireMat.opacity = isCenter ? 0.5 : 0.22;

      selectedModelIds = isCenter ? new Set() : new Set(modelIds);

      selectedModelIds.forEach((id) => {
        const model = loadedModels.get(id);
        if (model) {
          model.isSelected = true;
          updateModelColor(model);
        }
      });
    },

    getSelected(): string[] {
      if (centerSelected) return [CENTER_HANDLE_ID];
      return Array.from(selectedModelIds);
    },

    transformSelected(type: "translate" | "rotate", delta: THREE.Vector3) {
      if (type === "translate") {
        selectedModelIds.forEach((id) => {
          const model = loadedModels.get(id);
          if (model) {
            model.mesh.position.add(delta);
          }
        });
      }
    },

    rotateSelectedModels(axis: THREE.Vector3, deltaAngle: number) {
      applyRotationToSelection(axis, deltaAngle);
    },

    addRotationVelocity(deltaTheta: number, deltaPhi: number) {
      if (selectedModelIds.size === 0 && !centerSelected) return;
      modelRotVelTheta += deltaTheta;
      modelRotVelPhi += deltaPhi;
    },

    dragSelectedModels(deltaX: number, deltaY: number) {
      applyDragDelta(deltaX, deltaY);
    },

    focusOnModels(modelIds?: string[]) {
      const ids = modelIds || Array.from(loadedModels.keys());
      if (ids.length === 0) return;

      const bbox = new THREE.Box3();
      ids.forEach((id) => {
        const model = loadedModels.get(id);
        if (model) {
          bbox.expandByObject(model.mesh);
        }
      });
      if (bbox.isEmpty()) return;

      const size = bbox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      // Perspective camera distance calculation — extra headroom (2.8x, not 1.5x) so
      // parts orbiting near vs. far from camera don't swing wildly in apparent size.
      const vFOV = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
      const distance = maxDim / (2 * Math.tan(vFOV / 2)) * 2.8;

      cameraTarget.copy(center);
      camera.position.copy(center);
      camera.position.z += distance;
      camera.lookAt(center);
      zoomVelocity = 0;
    },

    arrangeRadial(modelIds?: string[]) {
      const ids = modelIds || Array.from(loadedModels.keys());
      if (ids.length === 0) return;

      // Assembly sphere sized off the largest piece, so parts comfortably fit inside once assembled
      let maxDim = 0;
      ids.forEach((id) => {
        const model = loadedModels.get(id);
        if (model) {
          const s = model.bbox.getSize(new THREE.Vector3());
          maxDim = Math.max(maxDim, s.x, s.y, s.z);
        }
      });
      assemblyRadius = Math.max(30, maxDim * 1.3);
      assemblySphere.scale.setScalar(assemblyRadius);
      assemblySphere.visible = ids.length > 1;

      if (ids.length === 1) {
        const model = loadedModels.get(ids[0]);
        if (model) model.mesh.position.set(0, 0, 0);
        return;
      }

      const ringRadius = assemblyRadius * 1.8;
      ids.forEach((id, idx) => {
        const model = loadedModels.get(id);
        if (model) {
          const angle = (idx / ids.length) * Math.PI * 2;
          model.mesh.position.set(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
          model.mesh.quaternion.identity();
          model.isAssembled = false;
          updateModelColor(model);
        }
      });
    },

    getAssemblyParts(): AssemblyPart[] {
      const parts: AssemblyPart[] = [];
      loadedModels.forEach((model) => {
        if (model.isAssembled) {
          parts.push({
            geometry: model.solid.geometry,
            position: model.mesh.position.clone(),
            quaternion: model.mesh.quaternion.clone(),
          });
        }
      });
      return parts;
    },

    getModelTransforms(): Map<string, ModelTransform> {
      const transforms = new Map<string, ModelTransform>();
      loadedModels.forEach((model, id) => {
        transforms.set(id, {
          position: model.mesh.position.toArray() as [number, number, number],
          rotation: model.mesh.rotation.toArray().slice(0, 3) as [number, number, number],
          scale: model.mesh.scale.toArray() as [number, number, number],
        });
      });
      return transforms;
    },

    updateSize(w: number, h: number) {
      renderer.setSize(w, h);
      (camera as THREE.PerspectiveCamera).aspect = w / h;
      camera.updateProjectionMatrix();
    },

    zoomCamera(factor: number) {
      // Impulse, not an instant jump — animate() coasts it to a stop each frame.
      const impulse = -Math.log(factor) * 0.18;
      zoomVelocity = THREE.MathUtils.clamp(zoomVelocity + impulse, -ZOOM_MAX, ZOOM_MAX);
    },
  };

  return api;
}
