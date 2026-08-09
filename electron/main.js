// Electron shell for N.O.V.A. — launches the real Next.js production server
// (same server that runs "npm start") as a child process and shows it in a
// native window. No app feature is reimplemented here: everything (LLM,
// TTS, hand tracking, project agent, etc.) is still the same Next.js app.

const { app, BrowserWindow, session, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");

const PORT = process.env.NOVA_PORT || 3000;
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "app")
  : path.join(__dirname, "..");

// Local whisper.cpp server (see app/api/stt/route.ts) — used as a voice
// fallback in Electron since Web Speech API can't reach Google there.
// Started automatically if present, same idea as Ollama running in the
// background for the LLM. Not bundled in the app itself (it's a separate
// ~500MB model download) — path is overridable via env vars for other
// machines/installs.
const WHISPER_SERVER_EXE = process.env.WHISPER_SERVER_EXE || "C:\\whispercpp\\bin\\Release\\whisper-server.exe";
// Quantized (q5_1) model — roughly 2x faster than the full-precision small
// model on CPU with negligible accuracy loss.
const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH || "C:\\whispercpp\\models\\ggml-small-q5_1.bin";
const WHISPER_PORT = process.env.WHISPER_PORT || "8081";
const WHISPER_THREADS = process.env.WHISPER_THREADS || "12";

let serverProcess = null;
let whisperProcess = null;
let mainWindow = null;

function startNextServer() {
  const nextCli = path.join(APP_ROOT, "node_modules", "next", "dist", "bin", "next");

  serverProcess = spawn(process.execPath, [nextCli, "start", "-p", String(PORT)], {
    cwd: APP_ROOT,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ELECTRON_RUN_AS_NODE: "1",
    },
  });

  serverProcess.on("exit", (code) => {
    if (code && code !== 0 && mainWindow) {
      console.error(`Next.js server exited with code ${code}`);
    }
  });
}

function startWhisperServer() {
  if (!fs.existsSync(WHISPER_SERVER_EXE) || !fs.existsSync(WHISPER_MODEL_PATH)) {
    console.warn("[whisper] server exe/model not found, skipping (voice fallback in Electron won't work) —", WHISPER_SERVER_EXE);
    return;
  }

  whisperProcess = spawn(
    WHISPER_SERVER_EXE,
    [
      "-m", WHISPER_MODEL_PATH,
      "--host", "127.0.0.1",
      "--port", WHISPER_PORT,
      "-l", "tr",
      "-t", WHISPER_THREADS,
      "-bo", "1", // best-of 1 — skip extra candidate decoding passes
      "-nf", // no temperature-fallback retries on low-confidence decodes
    ],
    { stdio: "inherit", windowsHide: true }
  );

  whisperProcess.on("exit", (code) => {
    if (code && code !== 0) console.error(`[whisper] server exited with code ${code}`);
  });
}

// Native folder picker for the 3D model browser — see electron/preload.js
// for why this exists instead of the browser's <input type="file"
// webkitdirectory>: that requires a fresh user click/keypress to open,
// which a voice-triggered "klasörden gözat" command doesn't have (it fires
// asynchronously after a record→transcribe round trip). dialog.showOpenDialog,
// called from the main process, has no such restriction.
const MODEL_EXT_RE = /\.(glb|gltf|stl)$/i;
// Fixed folder for the voice-only "modelleri getir" command — no dialog
// involved at all, so there's no "user activation" concern here either way.
const FIXED_MODELS_DIR = process.env.NOVA_MODELS_DIR || path.join(os.homedir(), "Desktop", "models");

function readModelFolder(dir) {
  const dirName = path.basename(dir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() || !MODEL_EXT_RE.test(entry.name)) continue;
    const buf = fs.readFileSync(path.join(dir, entry.name));
    files.push({ name: entry.name, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  }

  return { dirName, files };
}

ipcMain.handle("pick-model-folder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readModelFolder(result.filePaths[0]);
});

ipcMain.handle("load-fixed-model-folder", async () => {
  if (!fs.existsSync(FIXED_MODELS_DIR)) return null;
  return readModelFolder(FIXED_MODELS_DIR);
});

function waitForServer(url, onReady) {
  const attempt = () => {
    http
      .get(url, (res) => {
        res.destroy();
        onReady();
      })
      .on("error", () => setTimeout(attempt, 300));
  };
  attempt();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    title: "N.O.V.A.",
    fullscreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown" || !mainWindow) return;
    if (input.key === "F11") {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key === "Escape" && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] process gone:", details);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("[renderer] window became unresponsive");
  });

  mainWindow.webContents.on("crashed", (_event, killed) => {
    console.error("[renderer] crashed, killed =", killed);
  });

  if (process.env.NOVA_DEBUG) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  // Web Speech API / MediaPipe need mic + camera without a manual prompt
  // dialog getting in the way (Electron blocks getUserMedia by default).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "media" || permission === "geolocation") {
      callback(true);
      return;
    }
    callback(false);
  });

  startNextServer();
  startWhisperServer();
  waitForServer(`http://localhost:${PORT}`, createWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      waitForServer(`http://localhost:${PORT}`, createWindow);
    }
  });
});

function killServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (whisperProcess && !whisperProcess.killed) {
    whisperProcess.kill();
    whisperProcess = null;
  }
}

app.on("window-all-closed", () => {
  killServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", killServer);
