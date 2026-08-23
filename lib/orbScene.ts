import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type { AssemblyPart } from "./editScene";

export interface OrbSceneApi {
  /** Rotate the camera around the orb by the given angles (radians). */
  rotateBy(deltaTheta: number, deltaPhi: number): void;
  /** Gesture zoom — instant, no momentum (used by hand tracker / scroll). */
  zoomBy(factor: number): void;
  /** Hold-to-zoom with velocity+momentum. Call startZoom* on press, stopZoom on release. */
  startZoomIn(): void;
  startZoomOut(): void;
  stopZoom(): void;
  resetView(): void;
  /** Update the Neural Core center label text. */
  setCoreLabel(text: string): void;
  dispose(): void;
  loadModel(url: string, name?: string, format?: "glb" | "stl"): Promise<void>;
  /** Displays several pre-positioned parts (from an edit-mode assembly) as one holographic group. */
  loadAssembly(parts: AssemblyPart[], name?: string): void;
  clearModel(): void;
  setFocus(active: boolean): void;
  loadVideo(url: string): void;
  stopVideo(): void;
}

const HOME_POSITION = new THREE.Vector3(0, 0.5, 5.5);
const MIN_DISTANCE = 0.6;
const MAX_DISTANCE = 40;

export function createOrbScene(container: HTMLElement): OrbSceneApi {
  const width = container.clientWidth;
  const height = container.clientHeight;

  // ——— SCENE ———
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
  camera.position.copy(HOME_POSITION);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  container.appendChild(renderer.domElement);

  // ——— POST PROCESSING ———
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Bloom at half resolution — visually identical, ~4x cheaper to compute
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(Math.round(width / 2), Math.round(height / 2)),
    1.8, // strength
    0.4, // radius
    0.2, // threshold
  );
  composer.addPass(bloom);

  // Chromatic aberration + cyan color grade shader
  const chromaticShader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uIntensity: { value: 0.003 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - vec2(0.5);
        float d = length(dir);
        float offset = uIntensity * d;
        float flicker = 1.0 + 0.02 * sin(uTime * 30.0) * sin(uTime * 7.3);
        vec4 cr = texture2D(tDiffuse, vUv + dir * offset);
        vec4 cg = texture2D(tDiffuse, vUv);
        vec4 cb = texture2D(tDiffuse, vUv - dir * offset * 0.5);
        gl_FragColor = vec4(cr.r, cg.g * 1.05, cb.b * 0.6, 1.0) * flicker;
        // Push towards cyan/blue tone
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.55, 1.05, 1.15), 0.3);
      }
    `,
  };
  const chromaticPass = new ShaderPass(chromaticShader);
  composer.addPass(chromaticPass);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.04;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.enableZoom = false; // custom velocity-based zoom takes over
  controls.enablePan = false;

  // ——— COLORS (cyan/blue palette) ———
  const C_BRIGHT = 0x06b6d4; // cyan-500
  const C_MID    = 0x0891b2; // cyan-600
  const C_DIM    = 0x164e63; // cyan-900
  const C_FAINT  = 0x083344; // very dark cyan
  const C_HOT    = 0x3b82f6; // blue-500

  // ——— ORB ROOT ———
  const orbGroup = new THREE.Group();
  scene.add(orbGroup);

  // ——— MATERIAL HELPERS ———
  function lineMat(color: number, opacity = 1) {
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  // ——— UTILITY: Create ring at latitude ———
  function latRing(radius: number, lat: number, segs = 120) {
    const r = radius * Math.cos(lat);
    const y = radius * Math.sin(lat);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  // ——— UTILITY: Create meridian ———
  function meridian(radius: number, lon: number, segs = 120) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const lat = (i / segs) * Math.PI - Math.PI / 2;
      pts.push(
        new THREE.Vector3(
          radius * Math.cos(lat) * Math.cos(lon),
          radius * Math.sin(lat),
          radius * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  // ═══════════════════════════════════════════════
  // LAYER 1: OUTER SHELL — dense wireframe grid
  // ═══════════════════════════════════════════════
  const outerShell = new THREE.Group();
  const R1 = 2.0;

  for (let i = -15; i <= 15; i++) {
    const lat = (i / 15) * (Math.PI / 2) * 0.95;
    const opacity = i % 3 === 0 ? 0.5 : 0.12;
    const color = i % 3 === 0 ? C_MID : C_FAINT;
    outerShell.add(new THREE.Line(latRing(R1, lat), lineMat(color, opacity)));
  }

  for (let i = 0; i < 24; i++) {
    const lon = (i / 24) * Math.PI * 2;
    const isMajor = i % 6 === 0;
    outerShell.add(
      new THREE.Line(
        meridian(R1, lon),
        lineMat(isMajor ? C_MID : C_FAINT, isMajor ? 0.6 : 0.1),
      ),
    );
  }

  const CROSS_LINES = 18;
  const CROSS_SPREAD = 0.25;
  for (let i = 0; i < 4; i++) {
    const lon = (i / 4) * Math.PI * 2;
    for (let j = 0; j < CROSS_LINES; j++) {
      const t = (j / (CROSS_LINES - 1)) * 2 - 1;
      const offset = (t * CROSS_SPREAD) / 2;
      const falloff = 1 - Math.abs(t) * 0.7;
      const opacity = 0.85 * falloff;
      const color = Math.abs(t) < 0.3 ? C_BRIGHT : C_MID;
      outerShell.add(
        new THREE.Line(meridian(R1, lon + offset, 200), lineMat(color, opacity)),
      );
    }
  }

  const EQ_LINES = 20;
  const EQ_SPREAD = 0.35;
  for (let j = 0; j < EQ_LINES; j++) {
    const t = (j / (EQ_LINES - 1)) * 2 - 1;
    const offset = (t * EQ_SPREAD) / 2;
    const falloff = 1 - Math.abs(t) * 0.65;
    const opacity = 0.8 * falloff;
    const color = Math.abs(t) < 0.3 ? C_BRIGHT : C_MID;
    outerShell.add(
      new THREE.Line(latRing(R1, offset, 200), lineMat(color, opacity)),
    );
  }

  orbGroup.add(outerShell);

  // ═══════════════════════════════════════════════
  // LAYER 2: GRID PANELS on the sphere surface
  // ═══════════════════════════════════════════════
  const panelGroup = new THREE.Group();

  function createSpherePanel(
    latCenter: number,
    lonCenter: number,
    latSpan: number,
    lonSpan: number,
    radius: number,
    divisions = 4,
  ) {
    const group = new THREE.Group();
    const mat = lineMat(C_DIM, 0.25);

    for (let i = 0; i <= divisions; i++) {
      const lat = latCenter - latSpan / 2 + (i / divisions) * latSpan;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= divisions * 4; j++) {
        const lon = lonCenter - lonSpan / 2 + (j / (divisions * 4)) * lonSpan;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    for (let j = 0; j <= divisions; j++) {
      const lon = lonCenter - lonSpan / 2 + (j / divisions) * lonSpan;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= divisions * 4; i++) {
        const lat = latCenter - latSpan / 2 + (i / (divisions * 4)) * latSpan;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    return group;
  }

  for (let i = 0; i < 30; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.8;
    const lon = Math.random() * Math.PI * 2;
    const size = 0.15 + Math.random() * 0.25;
    const panel = createSpherePanel(
      lat,
      lon,
      size,
      size,
      R1 + 0.01,
      3 + Math.floor(Math.random() * 3),
    );
    panelGroup.add(panel);
  }
  orbGroup.add(panelGroup);

  // ═══════════════════════════════════════════════
  // LAYER 3: SECONDARY SHELL — offset, partial arcs
  // ═══════════════════════════════════════════════
  const shell2 = new THREE.Group();
  const R2 = 2.12;

  for (let i = 0; i < 16; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.85;
    const startLon = Math.random() * Math.PI * 2;
    const arcLen = 0.3 + Math.random() * 1.2;
    const pts: THREE.Vector3[] = [];
    const segs = 60;
    const r = R2 * Math.cos(lat);
    const y = R2 * Math.sin(lat);
    for (let j = 0; j <= segs; j++) {
      const a = startLon + (j / segs) * arcLen;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_MID, 0.2 + Math.random() * 0.3),
      ),
    );
  }

  for (let i = 0; i < 12; i++) {
    const lon = Math.random() * Math.PI * 2;
    const startLat = (Math.random() - 0.5) * Math.PI * 0.8;
    const arcLen = 0.3 + Math.random() * 0.8;
    const pts: THREE.Vector3[] = [];
    const segs = 40;
    for (let j = 0; j <= segs; j++) {
      const lat = startLat + (j / segs) * arcLen;
      pts.push(
        new THREE.Vector3(
          R2 * Math.cos(lat) * Math.cos(lon),
          R2 * Math.sin(lat),
          R2 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_DIM, 0.15 + Math.random() * 0.2),
      ),
    );
  }
  orbGroup.add(shell2);

  // ═══════════════════════════════════════════════
  // LAYER 4: INNER CORE — spiral geodesic
  // ═══════════════════════════════════════════════
  const innerCore = new THREE.Group();
  const R3 = 0.9;

  for (let s = 0; s < 8; s++) {
    const pts: THREE.Vector3[] = [];
    const turns = 3 + Math.random() * 2;
    const segs = 300;
    const phase = (s / 8) * Math.PI * 2;
    for (let i = 0; i <= segs; i++) {
      const tVal = i / segs;
      const lat = tVal * Math.PI - Math.PI / 2;
      const lon = tVal * turns * Math.PI * 2 + phase;
      pts.push(
        new THREE.Vector3(
          R3 * Math.cos(lat) * Math.cos(lon),
          R3 * Math.sin(lat),
          R3 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    innerCore.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_BRIGHT, 0.3 + Math.random() * 0.2),
      ),
    );
  }

  for (let i = -6; i <= 6; i++) {
    const lat = (i / 6) * (Math.PI / 2) * 0.9;
    innerCore.add(new THREE.Line(latRing(R3, lat, 80), lineMat(C_DIM, 0.2)));
  }

  for (let i = 0; i < 12; i++) {
    const lon = (i / 12) * Math.PI * 2;
    innerCore.add(new THREE.Line(meridian(R3, lon, 80), lineMat(C_DIM, 0.15)));
  }

  orbGroup.add(innerCore);

  // ═══════════════════════════════════════════════
  // LAYER 5: INNERMOST CORE — bright hot center
  // ═══════════════════════════════════════════════
  const coreR = 0.25;

  const icoGeo = new THREE.IcosahedronGeometry(coreR, 1);
  const icoEdges = new THREE.EdgesGeometry(icoGeo);
  const icoWireMat = lineMat(C_HOT, 0.9);
  const icoWire = new THREE.LineSegments(icoEdges, icoWireMat);
  orbGroup.add(icoWire);

  const coreSphereMat = new THREE.MeshBasicMaterial({
    color: C_HOT,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
  });
  const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), coreSphereMat);
  orbGroup.add(coreSphere);

  const glowSphereMat = new THREE.MeshBasicMaterial({
    color: C_MID,
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
  });
  const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), glowSphereMat);
  orbGroup.add(glowSphere);

  // ═══════════════════════════════════════════════
  // NEURAL CORE LABEL — dynamic center text sprite
  // ═══════════════════════════════════════════════
  const coreLabelCanvas = document.createElement("canvas");
  coreLabelCanvas.width = 512;
  coreLabelCanvas.height = 64;
  const coreLabelCtx = coreLabelCanvas.getContext("2d")!;
  const coreLabelTex = new THREE.CanvasTexture(coreLabelCanvas);
  const coreLabelSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: coreLabelTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  coreLabelSprite.scale.set(1.6, 0.22, 1);
  coreLabelSprite.position.set(0, 0.42, 0);
  orbGroup.add(coreLabelSprite);

  function renderCoreLabelCanvas(text: string) {
    coreLabelCtx.clearRect(0, 0, 512, 64);
    coreLabelCtx.font = "bold 18px Courier New";
    coreLabelCtx.fillStyle = "rgba(6, 182, 212, 0.92)";
    coreLabelCtx.textAlign = "center";
    coreLabelCtx.textBaseline = "middle";
    coreLabelCtx.fillText(text, 256, 32);
    coreLabelTex.needsUpdate = true;
  }

  renderCoreLabelCanvas("NEURAL CORE");

  function setCoreLabel(text: string) {
    renderCoreLabelCanvas(text);
  }

  // ═══════════════════════════════════════════════
  // DATA TEXT SPRITES — NOVA live data labels
  // ═══════════════════════════════════════════════
  const novaDataItems = [
    "EMAIL: 12",   "NEWS: 45",   "BTC: $64K",   "PROJECT: 78%",
    "CPU: 34%",    "MEM: 6.2GB", "NET: 142ms",  "GPU: 67%",
    "TASK: 12/15", "FILES: 847", "QUEUE: 3",    "API: OK",
    "MODEL: NOVA", "TOKENS: 18K","SYNC: 99%",   "ERR: 0",
    "INBOX: 7",    "CAL: 2 MTG", "TODO: 5",     "DONE: 18",
    "SYS: ONLINE", "UPTIME: 99%","LOAD: 0.82",  "TEMP: 61°C",
    "DISK: 234GB", "PROC: 247",  "THREAD: 12",  "PORT: 3000",
    "WEB: ACTIVE", "DB: CONN",   "CACHE: HIT",  "AUTH: OK",
    "NOVA: v2.4",  "BUILD: 418", "LOG: CLEAN",  "SEC: ARMED",
    "SCAN: DONE",  "AI: READY",  "NLP: LIVE",   "VIS: ON",
    "DATA: 1.2TB", "INDEX: 98%", "BACKUP: OK",  "ALERT: 0",
  ];

  interface SpriteDrift {
    phi: number;
    theta: number;
    r: number;
    speed: number;
  }

  function makeTextSprite(text: string, size = 0.08) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 14px Courier New";
    const alpha = 0.35 + Math.random() * 0.55;
    // Cyan to blue spectrum
    const gVal = (150 + Math.random() * 80) | 0;
    const bVal = Math.min(255, (200 + Math.random() * 55) | 0);
    ctx.fillStyle = `rgba(6, ${gVal}, ${bVal}, ${alpha})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    s.scale.set(size * 5, size * 0.7, 1);
    return s;
  }

  function scatterText(
    count: number,
    sizeFn: () => number,
    rFn: () => number,
    speedScale: [number, number],
  ) {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const sp = makeTextSprite(
        novaDataItems[Math.floor(Math.random() * novaDataItems.length)],
        sizeFn(),
      );
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = rFn();
      sp.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      );
      sp.userData = {
        phi,
        theta,
        r,
        speed:
          (speedScale[0] + Math.random() * speedScale[1]) *
          (Math.random() > 0.5 ? 1 : -1),
      } satisfies SpriteDrift;
      group.add(sp);
    }
    return group;
  }

  // Sprite counts tuned for performance: 1700 → 420 total draw calls
  const textOuter = scatterText(
    300,
    () => 0.04 + Math.random() * 0.04,
    () => R1 + 0.03 + Math.random() * 0.08,
    [0.0002, 0.0008],
  );
  orbGroup.add(textOuter);

  const textInner = scatterText(
    40,
    () => 0.03 + Math.random() * 0.03,
    () => R3 + 0.02,
    [0.0005, 0.001],
  );
  orbGroup.add(textInner);

  const textAmbient = scatterText(
    80,
    () => 0.03,
    () => R3 + 0.2 + Math.random() * (R1 - R3 - 0.3),
    [0.0003, 0.0006],
  );
  orbGroup.add(textAmbient);

  // ═══════════════════════════════════════════════
  // ORBITING DEBRIS / ROCKS
  // ═══════════════════════════════════════════════
  const debrisGeos = [
    new THREE.IcosahedronGeometry(0.012, 0),
    new THREE.IcosahedronGeometry(0.02, 0),
    new THREE.IcosahedronGeometry(0.03, 1),
    new THREE.IcosahedronGeometry(0.008, 0),
    new THREE.TetrahedronGeometry(0.015, 0),
    new THREE.OctahedronGeometry(0.018, 0),
  ];
  interface DebrisOrbit {
    orbitR: number;
    speed: number;
    tiltX: number;
    tiltZ: number;
    phase: number;
  }
  const debris: THREE.Mesh[] = [];
  for (let i = 0; i < 80; i++) {
    const geo = debrisGeos[Math.floor(Math.random() * debrisGeos.length)];
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.7 ? C_BRIGHT : C_MID,
      transparent: true,
      opacity: 0.3 + Math.random() * 0.6,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const orbitR = 1.2 + Math.random() * 4.0;
    const speed = (0.08 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1);
    const tiltX = (Math.random() - 0.5) * Math.PI * 0.9;
    const tiltZ = (Math.random() - 0.5) * Math.PI * 0.5;
    const phase = Math.random() * Math.PI * 2;
    mesh.userData = { orbitR, speed, tiltX, tiltZ, phase } satisfies DebrisOrbit;
    debris.push(mesh);
    orbGroup.add(mesh);

    if (Math.random() > 0.85) {
      const trailPts: THREE.Vector3[] = [];
      for (let j = 0; j <= 15; j++) {
        const a = -(j / 15) * 0.3;
        trailPts.push(
          new THREE.Vector3(
            orbitR * Math.cos(a + phase),
            orbitR * 0.08 * Math.sin(a * 3),
            orbitR * Math.sin(a + phase),
          ),
        );
      }
      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(trailPts),
        lineMat(C_FAINT, 0.08),
      );
      mesh.add(trail);
    }
  }

  // ═══════════════════════════════════════════════
  // DUST PARTICLES — cyan glow
  // ═══════════════════════════════════════════════
  const dustCount = 600;
  const dustPos = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    const rr = 0.5 + Math.pow(Math.random(), 0.6) * 7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    dustPos[i * 3]     = rr * Math.sin(phi) * Math.cos(theta);
    dustPos[i * 3 + 1] = rr * Math.cos(phi);
    dustPos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta);
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dustPos, 3));

  const dotC = document.createElement("canvas");
  dotC.width = dotC.height = 64;
  const dCtx = dotC.getContext("2d")!;
  const grad = dCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(6,182,212,1)");
  grad.addColorStop(0.2, "rgba(8,145,178,0.6)");
  grad.addColorStop(0.5, "rgba(0,100,130,0.15)");
  grad.addColorStop(1, "rgba(0,50,80,0)");
  dCtx.fillStyle = grad;
  dCtx.fillRect(0, 0, 64, 64);

  const dustMat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(dotC),
    size: 0.04,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    color: C_BRIGHT,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  orbGroup.add(dustPoints);

  // ═══════════════════════════════════════════════
  // SCANNING RINGS
  // ═══════════════════════════════════════════════
  function makeScanRing(radius: number, thickness = 0.015) {
    const geo = new THREE.RingGeometry(radius - thickness, radius + thickness, 120);
    const mat = new THREE.MeshBasicMaterial({
      color: C_BRIGHT,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  const scanRing1 = makeScanRing(R1, 0.01);
  const scanRing2 = makeScanRing(R1 * 0.7, 0.008);
  orbGroup.add(scanRing1, scanRing2);

  // ═══════════════════════════════════════════════
  // HEXAGONAL NODES — small tech details
  // ═══════════════════════════════════════════════
  for (let i = 0; i < 15; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = R1 + 0.02;
    const hexGeo = new THREE.CircleGeometry(0.03 + Math.random() * 0.02, 6);
    const hexEdges = new THREE.EdgesGeometry(hexGeo);
    const hex = new THREE.LineSegments(hexEdges, lineMat(C_MID, 0.5));
    hex.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
    hex.lookAt(0, 0, 0);
    outerShell.add(hex);
  }

  // ═══════════════════════════════════════════════
  // FOCUS MODE — orb shrinks to corner, content centers
  // ═══════════════════════════════════════════════
  const ORB_HOME_POS  = new THREE.Vector3(0, 0, 0);
  const ORB_FOCUS_POS = new THREE.Vector3(-3.6, 0, 0);
  const ORB_HOME_SCALE  = 1.0;
  const ORB_FOCUS_SCALE = 0.30;
  const CAM_FOCUS_POS = new THREE.Vector3(0, 0.5, 7.5);

  let modelFocus    = false;
  let externalFocus = false;
  let orbScaleCurrent = 1.0;

  function isFocused() { return modelFocus || externalFocus; }

  // ═══════════════════════════════════════════════
  // 3D MODEL LOADER
  // ═══════════════════════════════════════════════
  let currentModel: THREE.Group | null = null;
  let currentModelBox: THREE.BoxHelper | null = null;

  function clearModel() {
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) { if (mat) mat.dispose(); }
      });
      currentModel = null;
    }
    if (currentModelBox) {
      scene.remove(currentModelBox);
      currentModelBox.geometry.dispose();
      currentModelBox = null;
    }
    modelFocus = false;
    externalFocus = false;
    smoothTarget = HOME_POSITION.clone();
    setCoreLabel("NEURAL CORE");
  }

  function setFocus(active: boolean) {
    externalFocus = active;
    if (isFocused()) {
      smoothTarget = CAM_FOCUS_POS.clone();
    } else {
      smoothTarget = HOME_POSITION.clone();
    }
  }

  function fitModel(innerGroup: THREE.Group, name?: string) {
    // Compute bounding box while the group is still unparented (local = world)
    innerGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(innerGroup, true);
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Offset content so its center sits at pivot origin
    innerGroup.position.sub(center);

    // Pivot handles uniform scaling; always placed at world origin for focus mode
    const pivot = new THREE.Group();
    pivot.add(innerGroup);
    pivot.scale.setScalar(2.5 / maxDim);
    pivot.position.set(0, 0, 0);

    const boxHelper = new THREE.BoxHelper(pivot, 0x06b6d4);
    (boxHelper.material as THREE.LineBasicMaterial).transparent = true;
    (boxHelper.material as THREE.LineBasicMaterial).opacity = 0.3;

    scene.add(pivot);
    scene.add(boxHelper);
    currentModel    = pivot;
    currentModelBox = boxHelper;
    if (name) setCoreLabel(name);

    // Enter focus: orb retreats, camera pulls back
    modelFocus   = true;
    smoothTarget = CAM_FOCUS_POS.clone();
  }

  function loadModel(url: string, name?: string, format: "glb" | "stl" = "glb"): Promise<void> {
    clearModel();

    if (format === "stl") {
      return new Promise((resolve, reject) => {
        new STLLoader().load(
          url,
          (geometry) => {
            geometry.computeVertexNormals();

            const solidMat = new THREE.MeshBasicMaterial({
              color: 0x06b6d4,
              transparent: true,
              opacity: 0.10,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
            const solid = new THREE.Mesh(geometry, solidMat);

            const edges = new THREE.EdgesGeometry(geometry, 25);
            const edgeMat = new THREE.LineBasicMaterial({
              color: 0x06b6d4,
              transparent: true,
              opacity: 0.75,
              blending: THREE.AdditiveBlending,
            });
            const wire = new THREE.LineSegments(edges, edgeMat);

            const group = new THREE.Group();
            group.add(solid, wire);
            fitModel(group, name);
            resolve();
          },
          undefined,
          reject,
        );
      });
    }

    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          fitModel(gltf.scene, name);
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  function loadAssembly(parts: AssemblyPart[], name?: string): void {
    clearModel();
    if (parts.length === 0) return;

    const group = new THREE.Group();
    parts.forEach((part) => {
      const solidMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.10,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const solid = new THREE.Mesh(part.geometry, solidMat);
      solid.position.copy(part.position);
      solid.quaternion.copy(part.quaternion);

      const edgesGeo = new THREE.EdgesGeometry(part.geometry, 25);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
      });
      const wire = new THREE.LineSegments(edgesGeo, edgeMat);
      wire.position.copy(part.position);
      wire.quaternion.copy(part.quaternion);

      group.add(solid, wire);
    });

    fitModel(group, name);
  }

  // ═══════════════════════════════════════════════
  // VIDEO PLAYER
  // ═══════════════════════════════════════════════
  let videoElement: HTMLVideoElement | null = null;
  let videoMesh: THREE.Mesh | null = null;
  let videoTexture: THREE.VideoTexture | null = null;

  function loadVideo(url: string) {
    stopVideo();
    const vid = document.createElement("video");
    vid.src = url;
    vid.loop = true;
    vid.muted = false;
    vid.crossOrigin = "anonymous";

    const tex = new THREE.VideoTexture(vid);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(5.33, 3);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: new THREE.Color(0.6, 0.6, 0.6) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(-4.5, 0.5, 0);

    const edges = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x0e7490,
      transparent: true,
      opacity: 0.3,
    });
    const frame = new THREE.LineSegments(edges, edgeMat);
    mesh.add(frame);

    scene.add(mesh);
    videoElement = vid;
    videoMesh = mesh;
    videoTexture = tex;

    vid.play().catch(() => {});
  }

  function stopVideo() {
    if (videoElement) {
      videoElement.pause();
      videoElement.src = "";
      videoElement = null;
    }
    if (videoMesh) {
      scene.remove(videoMesh);
      (videoMesh.material as THREE.MeshBasicMaterial).dispose();
      videoMesh.geometry.dispose();
      videoMesh = null;
    }
    if (videoTexture) {
      videoTexture.dispose();
      videoTexture = null;
    }
  }

  // ═══════════════════════════════════════════════
  // GESTURE / PROGRAMMATIC CAMERA CONTROL
  // ═══════════════════════════════════════════════
  const sphericalScratch = new THREE.Spherical();
  const offsetScratch = new THREE.Vector3();

  // ── Velocity zoom ────────────────────────────────────────────────────────
  // Positive velocity → zoom in (distance shrinks), negative → zoom out.
  // Uses exponential step so speed feels consistent at any distance.
  let zoomVelocity = 0;
  let zoomDirection: "in" | "out" | null = null;
  const ZOOM_ACCEL    = 0.0032; // velocity added per frame while held
  const ZOOM_MAX      = 0.075;  // terminal velocity cap
  const ZOOM_FRICTION         = 0.86; // button release — aggressive stop
  const ZOOM_FRICTION_GESTURE = 0.97; // scroll/pinch release — long coast
  const ROT_FRICTION          = 0.80; // rotation coast after gesture ends

  // Smooth target only used by resetView
  let smoothTarget: THREE.Vector3 | null = null;
  let lastGestureTime    = -1000; // ms from performance.now(); -1000 = never
  let lastZoomWasGesture = false;
  let rotVelTheta        = 0; // angular velocity for hand-tracker rotation
  let rotVelPhi          = 0;

  function rotateBy(deltaTheta: number, deltaPhi: number) {
    smoothTarget = null;
    // Accumulate as velocity so 30fps hand-tracker input is smoothed at 60fps render
    rotVelTheta += deltaTheta;
    rotVelPhi   += deltaPhi;
  }

  // Gesture zoom — velocity impulse (hand tracker pinch / scroll wheel)
  // factor < 1 → zoom in (positive impulse), factor > 1 → zoom out (negative)
  function zoomBy(factor: number) {
    smoothTarget = null;
    lastGestureTime    = performance.now();
    lastZoomWasGesture = true;
    const impulse = -Math.log(factor) * 0.18;
    zoomVelocity = THREE.MathUtils.clamp(zoomVelocity + impulse, -ZOOM_MAX, ZOOM_MAX);
  }

  // Custom scroll-wheel handler (replaces OrbitControls built-in zoom)
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;  // line mode
    if (e.deltaMode === 2) delta *= 500; // page mode
    const impulse = -delta * 0.00006;
    zoomVelocity       = THREE.MathUtils.clamp(zoomVelocity + impulse, -ZOOM_MAX, ZOOM_MAX);
    smoothTarget       = null;
    lastGestureTime    = performance.now();
    lastZoomWasGesture = true;
  }
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  // Button/keyboard/voice — velocity based
  function startZoomIn()  { smoothTarget = null; zoomDirection = "in";  lastZoomWasGesture = false; }
  function startZoomOut() { smoothTarget = null; zoomDirection = "out"; lastZoomWasGesture = false; }
  function stopZoom()     { zoomDirection = null; /* velocity decays naturally */ }

  function resetView() {
    zoomVelocity = 0;
    zoomDirection = null;
    controls.target.set(0, 0, 0);
    smoothTarget = HOME_POSITION.clone();
  }

  // ═══════════════════════════════════════════════
  // ANIMATION
  // ═══════════════════════════════════════════════
  const clock = new THREE.Clock();
  let flickerTimer = 0;
  let rafId = 0;
  let disposed = false;
  const FRAME_MS = 1000 / 60; // 60 fps cap
  let lastFrameTime = 0;

  function animate(now: number) {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);

    // Always update controls so mouse input is consumed every native frame,
    // avoiding the pointer-delta accumulation that causes stuttering.
    controls.update();

    // Skip heavy work + render to enforce 60fps ceiling on high-refresh displays
    if (now - lastFrameTime < FRAME_MS) return;
    lastFrameTime = now - ((now - lastFrameTime) % FRAME_MS);

    const t = clock.getElapsedTime();

    outerShell.rotation.y += 0.0015;
    outerShell.rotation.x = Math.sin(t * 0.08) * 0.05;

    panelGroup.rotation.y += 0.0018;
    panelGroup.rotation.x = Math.sin(t * 0.08 + 0.5) * 0.04;

    shell2.rotation.y -= 0.001;
    shell2.rotation.z = Math.sin(t * 0.12) * 0.03;

    innerCore.rotation.y -= 0.005;
    innerCore.rotation.z += 0.002;
    innerCore.rotation.x = Math.cos(t * 0.1) * 0.08;

    icoWire.rotation.x += 0.008;
    icoWire.rotation.y += 0.012;

    const wave1 = Math.sin(t * 1.2);
    const wave3 = Math.pow(Math.max(0, Math.sin(t * 0.4)), 5);
    const wave4 = Math.pow(Math.max(0, Math.sin(t * 0.7 + 2)), 8);
    const fadeOut = Math.pow(Math.max(0, Math.sin(t * 0.25)), 3);
    const surge = wave3 * 1.5 + wave4 * 2.0;
    const coreScale = 1 + surge + Math.sin(t * 5) * 0.05;
    coreSphere.scale.setScalar(coreScale);
    const coreOpacity = Math.max(
      0,
      (0.08 + wave1 * 0.05 + surge * 0.2) * (1 - fadeOut * 0.95),
    );
    coreSphereMat.opacity = Math.min(0.6, coreOpacity);
    glowSphere.scale.setScalar(1 + surge * 0.8);
    glowSphereMat.opacity = Math.max(0, (0.03 + surge * 0.08) * (1 - fadeOut * 0.9));
    icoWire.scale.setScalar(1 + surge * 0.6);
    icoWireMat.opacity = Math.min(1, 0.5 + surge * 0.4);

    debris.forEach((d) => {
      const u = d.userData as DebrisOrbit;
      const a = t * u.speed + u.phase;
      d.position.set(
        u.orbitR * Math.cos(a) * Math.cos(u.tiltX),
        u.orbitR * Math.sin(u.tiltX) * Math.sin(a * 0.8) + Math.sin(a * 0.3 + u.tiltZ) * 0.2,
        u.orbitR * Math.sin(a) * Math.cos(u.tiltZ),
      );
      d.rotation.x += 0.015;
      d.rotation.z += 0.01;
    });

    const driftGroups: [THREE.Group, number][] = [
      [textOuter, 1],
      [textInner, 2],
      [textAmbient, 1.2],
    ];
    for (const [group, mult] of driftGroups) {
      group.children.forEach((sp) => {
        const u = sp.userData as SpriteDrift;
        u.theta += u.speed * mult;
        sp.position.set(
          u.r * Math.sin(u.phi) * Math.cos(u.theta),
          u.r * Math.cos(u.phi),
          u.r * Math.sin(u.phi) * Math.sin(u.theta),
        );
      });
    }

    const scanY1 = Math.sin(t * 0.4) * R1;
    scanRing1.position.y = scanY1;
    const scanS1 = Math.sqrt(Math.max(0, R1 * R1 - scanY1 * scanY1)) / R1;
    scanRing1.scale.set(scanS1, scanS1, 1);
    (scanRing1.material as THREE.MeshBasicMaterial).opacity = 0.2 * scanS1;

    const scanY2 = Math.sin(t * 0.6 + 2) * R3;
    scanRing2.position.y = scanY2;
    const scanS2 = Math.sqrt(Math.max(0, R3 * R3 - scanY2 * scanY2)) / R3;
    scanRing2.scale.set(scanS2, scanS2, 1);
    (scanRing2.material as THREE.MeshBasicMaterial).opacity = 0.15 * scanS2;

    dustPoints.rotation.y += 0.0002;

    flickerTimer += 0.016;
    if (flickerTimer > 0.1) {
      flickerTimer = 0;
      panelGroup.children.forEach((p) => {
        if (Math.random() > 0.95) {
          p.visible = !p.visible;
        }
      });
    }

    bloom.strength = 1.6 + Math.sin(t * 0.8) * 0.3;
    chromaticPass.uniforms.uTime.value = t;

    // ── Rotation velocity (hand-tracker inertia) ──────────────────────────
    if (Math.abs(rotVelTheta) > 0.00005 || Math.abs(rotVelPhi) > 0.00005) {
      offsetScratch.copy(camera.position).sub(controls.target);
      sphericalScratch.setFromVector3(offsetScratch);
      sphericalScratch.theta -= rotVelTheta;
      sphericalScratch.phi = THREE.MathUtils.clamp(
        sphericalScratch.phi - rotVelPhi,
        0.05,
        Math.PI - 0.05,
      );
      sphericalScratch.makeSafe();
      offsetScratch.setFromSpherical(sphericalScratch);
      camera.position.copy(controls.target).add(offsetScratch);
      camera.lookAt(controls.target);
      rotVelTheta *= ROT_FRICTION;
      rotVelPhi   *= ROT_FRICTION;
      if (Math.abs(rotVelTheta) < 0.00005) rotVelTheta = 0;
      if (Math.abs(rotVelPhi)   < 0.00005) rotVelPhi   = 0;
    }

    // ── Velocity zoom ─────────────────────────────────────────────────────
    if (zoomDirection === "in") {
      zoomVelocity = Math.min(zoomVelocity + ZOOM_ACCEL, ZOOM_MAX);
    } else if (zoomDirection === "out") {
      zoomVelocity = Math.max(zoomVelocity - ZOOM_ACCEL, -ZOOM_MAX);
    }
    if (Math.abs(zoomVelocity) > 0.00008) {
      offsetScratch.copy(camera.position).sub(controls.target);
      const newDist = THREE.MathUtils.clamp(
        offsetScratch.length() * Math.exp(-zoomVelocity),
        MIN_DISTANCE,
        MAX_DISTANCE,
      );
      offsetScratch.setLength(newDist);
      camera.position.copy(controls.target).add(offsetScratch);
      // Apply friction only after release; skip while gesture is still firing frames
      if (zoomDirection === null) {
        const gestureActive = (now - lastGestureTime) < 150;
        if (!gestureActive) {
          const friction = lastZoomWasGesture ? ZOOM_FRICTION_GESTURE : ZOOM_FRICTION;
          zoomVelocity *= friction;
          if (Math.abs(zoomVelocity) < 0.00008) { zoomVelocity = 0; lastZoomWasGesture = false; }
        }
      }
    }

    // ── Reset view smooth lerp ─────────────────────────────────────────────
    if (smoothTarget !== null) {
      camera.position.lerp(smoothTarget, 0.09);
      if (camera.position.distanceTo(smoothTarget) < 0.008) {
        camera.position.copy(smoothTarget);
        smoothTarget = null;
      }
    }

    if (currentModel) {
      currentModel.rotation.y += 0.003;
      currentModelBox?.update();
    }

    if (videoTexture && videoElement && !videoElement.paused) {
      videoTexture.needsUpdate = true;
    }

    // ── Focus mode: smooth orb retreat / return ───────────────────────────
    const focused = isFocused();
    orbGroup.position.lerp(focused ? ORB_FOCUS_POS : ORB_HOME_POS, 0.045);
    const orbScaleTarget = focused ? ORB_FOCUS_SCALE : ORB_HOME_SCALE;
    orbScaleCurrent = THREE.MathUtils.lerp(orbScaleCurrent, orbScaleTarget, 0.045);
    orbGroup.scale.setScalar(orbScaleCurrent);

    composer.render();
  }

  animate(0);

  // Pause rendering when tab is hidden — biggest idle heat reduction
  function onVisibilityChange() {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else {
      lastFrameTime = 0;
      rafId = requestAnimationFrame(animate);
    }
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // ——— RESIZE ———
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.resolution.set(Math.round(w / 2), Math.round(h / 2));
  }
  window.addEventListener("resize", onResize);

  // ——— CLEANUP ———
  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    renderer.domElement.removeEventListener("wheel", onWheel);
    controls.dispose();
    clearModel();
    stopVideo();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const anyMat = mat as THREE.Material & { map?: THREE.Texture };
        anyMat.map?.dispose();
        mat.dispose();
      }
    });
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    rotateBy,
    zoomBy,
    startZoomIn,
    startZoomOut,
    stopZoom,
    resetView,
    setCoreLabel,
    dispose,
    loadModel,
    loadAssembly,
    clearModel,
    setFocus,
    loadVideo,
    stopVideo,
  };
}
