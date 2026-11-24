/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { app, Menu } from 'electron/main';

import { openTracktionWindow, registerTracktionScheme } from './tracktion-window.ts';

const root = resolve(import.meta.dirname, '..');
const profile = join(app.getPath('appData'), 'Soundscaper Tracktion');
app.setName('Soundscaper Tracktion');
app.setAppUserModelId('org.soundscaper.tracktion');
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
	const peer = process.platform === 'win32' ? 'Release/soundscaper_tracktion_peer.exe' : 'soundscaper_tracktion_peer';
	const editor = await openTracktionWindow({
		bundleRoot: join(root, '.desktop-build/tracktion-editor'),
		peer: join(root, '.native-build/tracktion-session', peer),
		scratchRoot: join(profile, 'Edit Sessions'),
	});
	app.on('second-instance', () => { editor.window.focus(); });
	app.on('window-all-closed', () => {
		void editor.dispose().then(() => app.quit(), (error: unknown) => {
			console.error(error);
			app.exit(1);
		});
	});
}
