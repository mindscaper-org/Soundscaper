/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, Menu } from 'electron/main';

import { openTracktionWindow, registerTracktionScheme } from './tracktion-window.ts';
import type { TracktionPluginLibrary } from './tracktion-plugin-library.ts';

const root = resolve(import.meta.dirname, '..');
const development = !app.isPackaged;
const prepared = existsSync(join(root, 'desktop/tracktion-utility-process.mjs'));
const resources = development ? resolve(root, '..') : process.resourcesPath;
const profile = join(app.getPath('appData'), 'Soundscaper Tracktion');
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
		});
	} catch (error) {
		await plugins?.dispose();
		throw error;
	}
	const running = editor;
	app.on('second-instance', () => { running.window.focus(); });
	app.on('window-all-closed', () => {
		void running.dispose().finally(() => plugins?.dispose()).then(() => app.quit(), (error: unknown) => {
			console.error(error);
			app.exit(1);
		});
	});
}

async function installedPlugins(parentWindow: () => Electron.BrowserWindow | null) {
	const entry = join(prepared ? root : join(root, '.desktop-build/app'), 'desktop/tracktion-installed-plugin-registration.mjs');
	try { await stat(entry); }
	catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
		throw error;
	}
	type PluginRuntime = { library: TracktionPluginLibrary; dispose(): Promise<void> };
	const { startTracktionInstalledPlugins } = await import(pathToFileURL(entry).href) as {
		startTracktionInstalledPlugins(options: { profile: string; parentWindow: typeof parentWindow; resourcesPath: string }): Promise<PluginRuntime>;
	};
	return await startTracktionInstalledPlugins({ profile, parentWindow, resourcesPath: prepared ? resources : join(root, '.desktop-build') });
}
