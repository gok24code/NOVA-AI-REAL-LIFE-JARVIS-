const { contextBridge, ipcRenderer } = require("electron");

// Exposes a minimal native-folder-picker bridge to the renderer. Needed
// because the browser's own `<input type="file" webkitdirectory>` requires
// a fresh "user activation" (a real click/keypress) to open — which a
// voice-triggered command doesn't have, since it arrives asynchronously
// after a record→transcribe round trip. Electron's native dialog, invoked
// from the main process, has no such restriction.
contextBridge.exposeInMainWorld("electronAPI", {
  pickModelFolder: () => ipcRenderer.invoke("pick-model-folder"),
  // Fixed Desktop\models folder — no dialog, triggered by "modelleri getir".
  loadFixedModelFolder: () => ipcRenderer.invoke("load-fixed-model-folder"),
});
