/* SPDX-License-Identifier: AGPL-3.0-only */

const { contextBridge, ipcRenderer } = require('electron');
const projectLostChannel = 'soundscaper-tracktion:project-lost';

contextBridge.exposeInMainWorld('soundscaperTracktion', Object.freeze({
	request: (command) => ipcRenderer.invoke('soundscaper-tracktion:project-request', command),
	onProjectLost: (listener) => {
		const receive = (_event, sessionId, message) => {
			if (typeof sessionId === 'string' && typeof message === 'string') listener(sessionId, message);
		};
		ipcRenderer.on(projectLostChannel, receive);
		return () => { ipcRenderer.removeListener(projectLostChannel, receive); };
	},
}));
