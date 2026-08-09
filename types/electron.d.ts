// Bridge exposed by electron/preload.js — only present when running inside
// the Electron shell, undefined in a regular browser tab.

interface PickedModelFile {
  name: string;
  data: ArrayBuffer;
}

interface PickedModelFolder {
  dirName: string;
  files: PickedModelFile[];
}

interface ElectronAPI {
  pickModelFolder: () => Promise<PickedModelFolder | null>;
  loadFixedModelFolder: () => Promise<PickedModelFolder | null>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
