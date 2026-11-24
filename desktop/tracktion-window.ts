/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, protocol, session, utilityProcess } from 'electron/main';

import { createTrustedDesktopIpc } from './main-trusted-ipc.ts';
import { resolveStaticFile, securityHeaders } from './protocol.js';
import { tracktionAudioPreferences } from './tracktion-audio-preferences.ts';
import type { TracktionOfflineEffectHost } from './tracktion-offline-effects.ts';
import type { TracktionPluginLibrary } from './tracktion-plugin-library.ts';
import { registerTracktionProjectIpc, TRACKTION_PROJECT_REQUEST } from './tracktion-project-ipc.ts';
import { TracktionProjectService } from './tracktion-project-service.ts';
import { startTracktionUtilitySession } from './tracktion-utility-session.ts';

const SCHEME = 'soundscaper-tracktion-app';
const PARTITION = 'persist:soundscaper-tracktion';
const ORIGIN = `${SCHEME}://bundle`;
const EDITOR_URL = `${ORIGIN}/index.html`;
const ASSETS = new Map<string, readonly [string, string]>([
	[EDITOR_URL, ['index.html', 'text/html; charset=utf-8']],
	[`${ORIGIN}/editor.js`, ['editor.js', 'text/javascript; charset=utf-8']],
	[`${ORIGIN}/editor.css`, ['editor.css', 'text/css; charset=utf-8']],
]);

type ProjectPorts = ConstructorParameters<typeof TracktionProjectService>[0];
type TracktionProjectDialogs = Pick<ProjectPorts, 'chooseCreateDirectory' | 'chooseOpenProject' | 'chooseWave' | 'chooseExport'>;

export function registerTracktionScheme(): void {
	protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

export async function openTracktionWindow(options: {
	readonly bundleRoot: string;
	readonly scratchRoot: string;
	readonly peer: string;
	readonly show?: boolean;
	readonly dialogs?: TracktionProjectDialogs;
	readonly offlineEffects?: TracktionOfflineEffectHost;
	readonly pluginLibrary?: TracktionPluginLibrary;
}) {
	const [bundleRoot, executable] = await Promise.all([realpath(options.bundleRoot), realpath(options.peer)]);
	const browserSession = session.fromPartition(PARTITION);
	browserSession.setPermissionCheckHandler(() => false);
	browserSession.setPermissionRequestHandler((_webContents, _permission, reply) => reply(false));
	browserSession.protocol.handle(SCHEME, (request) => serveEditorAsset(bundleRoot, request));

	const window = new BrowserWindow({
		title: 'Soundscaper Tracktion', width: 1120, height: 720, show: options.show ?? true,
		webPreferences: {
			partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false,
			preload: resolve(import.meta.dirname, 'tracktion-preload.cjs'),
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event) => event.preventDefault());
	window.webContents.on('will-prevent-unload', (event) => {
		if (dialog.showMessageBoxSync(window, {
			type: 'question', message: 'Close the current project and discard unsaved changes?',
			buttons: ['Cancel', 'Discard changes'], defaultId: 0, cancelId: 0,
		}) === 1) event.preventDefault();
	});

	const service = new TracktionProjectService({
		...(options.dialogs ?? projectDialogs(window)),
		scratchRoot: options.scratchRoot,
		audioPreferences: tracktionAudioPreferences(join(app.getPath('userData'), 'Tracktion Audio Setup.json')),
		...(options.pluginLibrary ? { pluginLibrary: options.pluginLibrary } : {}),
		isOwnerCurrent: (owner) => owner === window && !window.isDestroyed(),
		startPeer: (launch) => startTracktionUtilitySession(
			utilityProcess.fork, resolve(import.meta.dirname, 'tracktion-utility-process.ts'), { ...launch, executable },
			options.pluginLibrary ?? options.offlineEffects,
		),
	});
	const { handle } = createTrustedDesktopIpc({
		ipcMain, windowFor: () => window.isDestroyed() ? null : window,
		assertDocumentUrl: (url) => { if (url !== EDITOR_URL) throw new Error('The Tracktion editor document is invalid.'); },
	});
	registerTracktionProjectIpc({ handle, ownerFor: () => window, service });
	let disposal: Promise<void> | undefined;
	function dispose(): Promise<void> {
		if (disposal) return disposal;
		ipcMain.removeHandler(TRACKTION_PROJECT_REQUEST);
		browserSession.protocol.unhandle(SCHEME);
		disposal = service.dispose();
		return disposal;
	}
	window.once('closed', () => { void dispose().catch(console.error); });
	try {
		await window.loadURL(EDITOR_URL);
	} catch (error) {
		window.destroy();
		await dispose();
		throw error;
	}
	return { window, dispose };
}

async function serveEditorAsset(root: string, request: Request): Promise<Response> {
	const asset = ASSETS.get(request.url);
	if (request.method !== 'GET' || !asset) return new Response(null, { status: 404 });
	const [name, contentType] = asset;
	try {
		const file = await resolveStaticFile(root, name);
		const bytes = await readFile(file.path);
		return new Response(new Uint8Array(bytes), {
			headers: { ...securityHeaders(), 'Content-Type': contentType },
		});
	} catch {
		return new Response(null, { status: 404 });
	}
}

function projectDialogs(window: BrowserWindow): TracktionProjectDialogs {
	async function choose(options: Electron.OpenDialogOptions): Promise<string | null> {
		const result = await dialog.showOpenDialog(window, options);
		return result.canceled ? null : result.filePaths[0] ?? null;
	}
	return {
		chooseCreateDirectory: () => choose({ title: 'New project', properties: ['openDirectory', 'createDirectory'] }),
		chooseOpenProject: () => choose({
			title: 'Open project', properties: ['openFile'], filters: [{ name: 'Tracktion Edit', extensions: ['tracktionedit'] }],
		}),
		chooseWave: () => choose({
			title: 'Import audio', properties: ['openFile'], filters: [{ name: 'WAV', extensions: ['wav'] }],
		}),
		chooseExport: async (format) => {
			const result = await dialog.showSaveDialog(window, {
				defaultPath: format === 'wav' ? 'Mix.wav' : 'Project.zip',
				filters: [{ name: format.toUpperCase(), extensions: [format] }],
			});
			return result.canceled ? null : result.filePath ?? null;
		},
	};
}
