/* SPDX-License-Identifier: AGPL-3.0-only */

import { contextBridge, ipcRenderer } from 'electron';
import { createLightscaperPreloadBridgeCurrentV1 } from './lightscaper-preload-bridge-current-v1.ts';
import { isLightscaperShellDocumentCurrentV1 } from './lightscaper-shell-contract-current-v1.ts';

if (process.isMainFrame && isLightscaperShellDocumentCurrentV1(globalThis.location.href)) {
	const bridge = Object.freeze({ v1: createLightscaperPreloadBridgeCurrentV1(ipcRenderer) });
	contextBridge.exposeInMainWorld('scapeDesktop', bridge);
	contextBridge.exposeInMainWorld('lightscaperDesktop', bridge);
}
