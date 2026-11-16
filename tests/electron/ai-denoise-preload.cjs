/* SPDX-License-Identifier: AGPL-3.0-only */
const { contextBridge, ipcRenderer } = require('electron');
const { installAiDenoisePreload } = require('../../desktop/ai-denoise-preload.ts');
installAiDenoisePreload(window, ipcRenderer);
contextBridge.exposeInMainWorld('denoiseTest', { result: value => ipcRenderer.send('denoise-test-result', value) });
