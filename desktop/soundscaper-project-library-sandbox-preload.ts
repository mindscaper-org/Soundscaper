/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryMainPreloadBridge,
} from './soundscaper-project-library-main-preload.ts';

import { SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS, type SoundscaperDesktopProjectRecoveryBridge } from '../src/soundscaper/desktop-project-recovery-bridge.ts';

 declare const require: (specifier: 'electron') => Readonly<{
	contextBridge: Readonly<{ exposeInMainWorld(name: string, value: unknown): void }>;
	ipcRenderer: Readonly<{ invoke(channel: string, value?: unknown): Promise<unknown> }>;
}>;

const { contextBridge, ipcRenderer } = require('electron');
const api = createSoundscaperDesktopProjectLibraryMainPreloadBridge({
	invoke: (channel: string, value?: unknown) => ipcRenderer.invoke(channel, value),
});

contextBridge.exposeInMainWorld(
	'soundscaperProjectLibraryDesktop',
	Object.freeze({ v1: api }),
);

const recovery: SoundscaperDesktopProjectRecoveryBridge = Object.freeze({
	listProjectRecoverySummaries: async () => { await api.connect(); return await ipcRenderer.invoke(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.list) as Awaited<ReturnType<SoundscaperDesktopProjectRecoveryBridge['listProjectRecoverySummaries']>>; },
	readProjectRecoveryCandidates: async (projectId: string) => { await api.connect(); return await ipcRenderer.invoke(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.read, projectId) as Awaited<ReturnType<SoundscaperDesktopProjectRecoveryBridge['readProjectRecoveryCandidates']>>; },
});
contextBridge.exposeInMainWorld('soundscaperProjectRecoveryDesktop', recovery);
