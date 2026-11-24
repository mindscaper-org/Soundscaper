/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { app, Menu } from 'electron/main';

import { probeTracktionDesktop, tracktionSmokeProfile } from './tracktion-desktop-smoke.ts';
import { openTracktionWindow, registerTracktionScheme } from './tracktion-window.ts';
import type { TracktionPluginLibrary } from './tracktion-plugin-library.ts';

const root = resolve(import.meta.dirname, '..');
const development = !app.isPackaged;
const prepared = existsSync(join(root, 'desktop/tracktion-utility-process.mjs'));
const resources = development ? resolve(root, '..') : process.resourcesPath;
const smokeProfile = tracktionSmokeProfile(process.argv);
const profile = smokeProfile ?? join(app.getPath('appData'), 'Soundscaper Tracktion');
app.setName('Soundscaper');
app.setAppUserModelId('org.soundscaper.desktop');
mkdirSync(profile, { mode: 0o700, recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
registerTracktionScheme();

if (app.requestSingleInstanceLock()) {
	void start().catch((error: unknown) => {
		console.error(error);
		app.exit(1);
	});
} else {
	app.quit();
}

async function start(): Promise<void> {
	await app.whenReady();
	Menu.setApplicationMenu(null);
	const peerName = process.platform === 'win32' ? 'soundscaper_tracktion_peer.exe' : 'soundscaper_tracktion_peer';
	const smokeProject = smokeProfile ? join(smokeProfile, 'Project') : null;
	let editor: Awaited<ReturnType<typeof openTracktionWindow>> | undefined;
	const plugins = await installedPlugins(() => editor?.window ?? null);
	try {
		editor = await openTracktionWindow({
			bundleRoot: prepared ? join(resources, 'renderer') : join(root, '.desktop-build/tracktion-editor'),
			peer: prepared ? join(resources, 'runtime/tracktion', peerName)
				: join(root, '.native-build/tracktion-session', process.platform === 'win32' ? 'Release' : '', peerName),
			...(prepared ? { utilityEntry: join(root, 'desktop/tracktion-utility-process.mjs') } : {}),
			scratchRoot: join(profile, 'Edit Sessions'),
			...(plugins ? { pluginLibrary: plugins.library } : {}),
			...(smokeProject ? {
				show: false,
				dialogs: {
					chooseCreateDirectory: () => Promise.resolve(smokeProject),
					chooseOpenProject: () => Promise.resolve(null),
					chooseWave: () => Promise.resolve(null),
					chooseExport: () => Promise.resolve(null),
				},
			} : {}),
		});
	} catch (error) {
		await plugins?.dispose();
		throw error;
	}
	const running = editor;
	if (smokeProject) {
		try { await probeTracktionDesktop(running, smokeProject); }
		finally {
			await running.dispose().finally(() => plugins?.dispose());
			running.window.destroy();
		}
		app.quit();
		return;
	}
	app.on('second-instance', () => { running.window.focus(); });
	app.on('window-all-closed', () => {
		void running.dispose().finally(() => plugins?.dispose()).then(() => app.quit(), (error: unknown) => {
			console.error(error);
			app.exit(1);
		});
	});
}

async function installedPlugins(parentWindow: () => Electron.BrowserWindow | null) {
	if (!prepared) return null;
	type PluginRuntime = { library: TracktionPluginLibrary; dispose(): Promise<void> };
	const { startTracktionInstalledPlugins } = await import('./tracktion-installed-plugin-registration.mjs') as {
		startTracktionInstalledPlugins(options: { profile: string; parentWindow: typeof parentWindow; resourcesPath: string }): Promise<PluginRuntime>;
	};
	return await startTracktionInstalledPlugins({ profile, parentWindow, resourcesPath: resources });
}
