/* SPDX-License-Identifier: AGPL-3.0-only */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soundscaperTracktion', Object.freeze({
	request: (command) => ipcRenderer.invoke('soundscaper-tracktion:project-request', command),
}));
