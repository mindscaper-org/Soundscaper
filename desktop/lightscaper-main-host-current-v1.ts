/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, type DownloadItem } from 'electron/main';
import { APP_ID, APP_NAME, APP_ORIGIN, APP_SCHEME, DECLARED_APPLICATION_VERSION, PRODUCT_ID, SESSION_PARTITION, SUPPORTED_LOCALES } from './constants.js';
import { configureDesktopStorage } from './desktop-storage-bootstrap.ts';
import { createTrustedDesktopIpc } from './main-trusted-ipc.ts';
import { attachDesktopMainWindowRecovery } from './main-window-recovery.ts';
import { createProtocolHandler, registerAppScheme } from './protocol.js';
import { assertEditorDocumentUrl, resolveLocale } from './validation.js';
import { createLightscaperCloseCoordinatorCurrentV1 } from './lightscaper-close-coordinator-current-v1.ts';
import { createLightscaperDownloadLifetimeCurrentV1 } from './lightscaper-download-lifetime-current-v1.ts';
import { LIGHTSCAPER_SHELL_CHANNELS_CURRENT_V1 as CHANNELS, LIGHTSCAPER_SHELL_ORIGIN_CURRENT_V1,
	LIGHTSCAPER_SHELL_PARTITION_CURRENT_V1, isLightscaperShellDocumentCurrentV1 } from './lightscaper-shell-contract-current-v1.ts';
import { isLightscaperBlobDownloadCurrentV1, lightscaperBrowserWindowOptionsCurrentV1 } from './lightscaper-window-security-current-v1.ts';
import { ReadCapabilityStore } from './file-capabilities.js';
import { registerSelectedReadCapability } from './read-selection-service.js';
import { createDesktopSaveSizeWarningConfirmation } from './save-size-warning-dialog.ts';
import { createLightscaperArchiveOpenCoordinatorCurrentV1 } from './lightscaper-archive-open-coordinator-current-v1.ts';
import { extractLightscaperArchiveOpenPathsCurrentV1 } from './lightscaper-archive-open-paths-current-v1.ts';

/** Optional statically inventoried main-process smoke dispatch. These ports
 * never cross the context bridge; production composition passes no hooks. */
export interface LightscaperMainHooksCurrentV1 {
	readonly onWindowCreated?: (window: BrowserWindow) => void;
	readonly onRendererReady?: (window: BrowserWindow) => void | Promise<void>;
	readonly onDownload?: (item: DownloadItem) => boolean;
}

/** A browser-managed Photo Session host. No native sibling project library,
 * assistance service, codec tier or arbitrary filesystem API is registered. */
export function startLightscaperDesktopMainCurrentV1(hooks: LightscaperMainHooksCurrentV1 = {}): void {
	if (String(PRODUCT_ID) !== 'lightscaper' || String(APP_NAME) !== 'Lightscaper'
		|| String(APP_SCHEME) !== 'lightscaper-app' || String(APP_ORIGIN) !== LIGHTSCAPER_SHELL_ORIGIN_CURRENT_V1
		|| String(SESSION_PARTITION) !== LIGHTSCAPER_SHELL_PARTITION_CURRENT_V1) {
		throw new Error('Lightscaper desktop entry requires its authenticated product composition.');
	}
	if (DECLARED_APPLICATION_VERSION === null || app.getVersion() !== DECLARED_APPLICATION_VERSION) {
		throw new Error('Lightscaper desktop application version differs from its release line.');
	}
	const entryDirectory = dirname(fileURLToPath(import.meta.url));
	const buildRoot = resolve(entryDirectory, '../..');
	const resources = app.isPackaged
		? { renderer: resolve(process.resourcesPath, 'renderer'), runtime: resolve(process.resourcesPath, 'runtime') }
		: { renderer: resolve(buildRoot, 'renderer'), runtime: resolve(buildRoot, 'runtime') };
	app.setName('Lightscaper');
	app.enableSandbox();
	registerAppScheme(protocol);
	const storage = configureDesktopStorage({ app, appName: 'Lightscaper', platform: process.platform, environment: process.env, argv: process.argv });
	let window: BrowserWindow | null = null;
	let desktopSession: Electron.Session | undefined;
	let archiveOwner: object | null = null, resourcesRetired = false, pickerPending = false;
	let resourceRetirement: Promise<void> | null = null;
	const readCapabilities = new ReadCapabilityStore({ confirmFileSizeWarning: createDesktopSaveSizeWarningConfirmation(options => dialog.showMessageBox(options), 'loading') });
	const archiveOpen = createLightscaperArchiveOpenCoordinatorCurrentV1({
		register: (path, owner) => registerSelectedReadCapability(readCapabilities, path, { owner, purpose: 'project' }),
		release: (id, owner) => readCapabilities.release(id, { owner }), revokeOwner: owner => readCapabilities.revokeOwner(owner),
		notify: (owner, event) => { if (owner === archiveOwner) currentWindow()?.webContents.send(CHANNELS.archiveAvailable, event); },
	});
	const downloads = createLightscaperDownloadLifetimeCurrentV1();
	const currentWindow = (): BrowserWindow | null => window && !window.isDestroyed() ? window : null;
	const close = createLightscaperCloseCoordinatorCurrentV1({
		createRequestId: randomUUID,
		sendRequest: request => { currentWindow()?.webContents.send(CHANNELS.closeRequested, request); },
		closeWindow: () => { currentWindow()?.close(); },
		quitApplication: () => { app.quit(); },
		flushStorage: () => { desktopSession?.flushStorageData(); },
	});
	const trusted = createTrustedDesktopIpc({ ipcMain, windowFor: currentWindow,
		assertDocumentUrl: url => {
			assertEditorDocumentUrl(url);
			if (!isLightscaperShellDocumentCurrentV1(url)) throw new Error('Untrusted Lightscaper document.');
		} });
	function fail(error: unknown): void {
		console.error('Lightscaper desktop failed:', error instanceof Error ? error.message : 'Unknown failure');
		app.exit(1);
	}
	app.on('before-quit', () => { close.beforeQuit(); });
	app.on('will-quit', event => {
		if (resourcesRetired) return;
		event.preventDefault();
		resourceRetirement ??= (async () => {
			await archiveOpen.close(); await readCapabilities.dispose(); desktopSession?.flushStorageData();
			// will-quit was prevented while these barriers joined. Complete that
			// shutdown directly; a nested quit can stay inside Electron's old quit.
			resourcesRetired = true; app.exit(0);
		})();
		void resourceRetirement.catch(fail);
	});
	app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
	app.on('activate', () => { if (!resourceRetirement && !resourcesRetired && !currentWindow() && desktopSession) void createWindow().catch(fail); });
	app.on('open-file', (event, path) => { event.preventDefault(); enqueueArchive(path); });
	app.on('second-instance', (_event, argv, workingDirectory) => {
		for (const path of extractLightscaperArchiveOpenPathsCurrentV1(argv, workingDirectory)) enqueueArchive(path);
		const existing = currentWindow();
		if (existing) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); }
	});
	if (!app.requestSingleInstanceLock()) { app.quit(); return; }
	for (const path of extractLightscaperArchiveOpenPathsCurrentV1(process.argv, process.cwd())) enqueueArchive(path);
	storage.prepareBeforeReady();
	void start().catch(fail);

	async function start(): Promise<void> {
		await storage.migrate(); await app.whenReady();
		if (process.platform === 'win32') app.setAppUserModelId(String(APP_ID));
		desktopSession = session.fromPartition(LIGHTSCAPER_SHELL_PARTITION_CURRENT_V1);
		desktopSession.setPermissionCheckHandler(() => false);
		desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
		desktopSession.setDevicePermissionHandler(() => false);
		desktopSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}); });
		await desktopSession.protocol.handle(String(APP_SCHEME), createProtocolHandler({
			productId: 'lightscaper', rendererRoot: resources.renderer, runtimeRoot: resources.runtime,
			readCapabilities,
		}));
		desktopSession.on('will-download', (event, item, contents, frame) => {
			const owner = currentWindow();
			if (!owner || contents !== owner.webContents || !frame || frame !== contents.mainFrame
				|| !isLightscaperShellDocumentCurrentV1(frame.url)
				|| !isLightscaperBlobDownloadCurrentV1(item.getURL(), item.getInitiatorOrigin())) {
				event.preventDefault(); return;
			}
			downloads.track(item);
			if (hooks.onDownload?.(item) === true) return;
			// No main-process save path is inferred from a renderer value. Electron
			// shows its ordinary native save dialog for this genuine browser blob.
			item.setSaveDialogOptions({ title: 'Save Lightscaper output', buttonLabel: 'Save',
				properties: ['createDirectory', 'showOverwriteConfirmation'] });
		});
		const locale = String(resolveLocale([app.getLocale(), ...app.getPreferredSystemLanguages()], SUPPORTED_LOCALES));
		trusted.handle(CHANNELS.environment, (_event, ...args) => {
			if (args.length) throw new TypeError('Lightscaper environment takes no arguments.');
			return { productId: 'lightscaper', platform: process.platform, arch: process.arch,
				version: app.getVersion(), development: !app.isPackaged, locale };
		});
		trusted.handle(CHANNELS.ready, (_event, ...args) => {
			if (args.length) throw new TypeError('Lightscaper ready takes no arguments.');
			const firstReady = close.signalReady();
			const owner = currentWindow();
			if (firstReady && owner) {
				archiveOwner = Object.freeze({}); void archiveOpen.replaceOwner(archiveOwner).catch(fail);
			}
			// A smoke run must not hold this acknowledgement through renderer
			// teardown: lifecycle disposal joins readiness delivery itself.
			if (owner && firstReady) void Promise.resolve().then(() => hooks.onRendererReady?.(owner)).catch(fail);
			return true;
		});
		trusted.handle(CHANNELS.respond, (_event, ...args) => {
			if (args.length !== 1) throw new TypeError('Lightscaper close response requires one record.');
			return close.respond(args[0]);
		});
		trusted.handle(CHANNELS.archiveTake, (_event, ...args) => {
			if (args.length) throw new TypeError('Lightscaper archive take takes no arguments.');
			return archiveOwner ? archiveOpen.takeArchive(archiveOwner) : null;
		});
		trusted.handle(CHANNELS.archiveFinish, (_event, ...args) => {
			if (args.length !== 1 || !archiveOwner) throw new TypeError('Lightscaper archive finish requires a current owner and one record.');
			return archiveOpen.finishArchive(archiveOwner, args[0]).then(() => true);
		});
		const template: Electron.MenuItemConstructorOptions[] = [
			...(process.platform === 'darwin' ? [{ label: 'Lightscaper', submenu: [{ role: 'about' as const },
				{ role: 'services' as const }, { type: 'separator' as const }, { role: 'hide' as const },
				{ role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
			{ label: 'File', submenu: [{ label: 'Open catalog backup…', accelerator: 'CmdOrCtrl+O',
				click: () => { void chooseArchive().catch(fail); } }, { type: 'separator' }, { role: 'close' }, { role: 'quit' }] },
			{ role: 'editMenu' }, { role: 'windowMenu' },
		];
		Menu.setApplicationMenu(Menu.buildFromTemplate(template));
		await createWindow();
	}
	async function createWindow(): Promise<void> {
		if (currentWindow()) return;
		const created = new BrowserWindow(lightscaperBrowserWindowOptionsCurrentV1({
			preloadPath: resolve(entryDirectory, 'preload.cjs'), rendererRoot: resources.renderer, packaged: app.isPackaged,
		}));
		window = created; invalidateRenderer();
		const contents = created.webContents;
		contents.setWindowOpenHandler(() => ({ action: 'deny' }));
		contents.on('will-navigate', event => { if (!isLightscaperShellDocumentCurrentV1(event.url)) event.preventDefault(); });
		contents.on('will-frame-navigate', event => { if (!event.isMainFrame || !isLightscaperShellDocumentCurrentV1(event.url)) event.preventDefault(); });
		contents.on('will-attach-webview', event => { event.preventDefault(); });
		contents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) invalidateRenderer(); });
		attachDesktopMainWindowRecovery({
			cleanup: async () => { close.invalidateRenderer(); archiveOwner = null; await archiveOpen.replaceOwner(null); }, editorUrl: `${LIGHTSCAPER_SHELL_ORIGIN_CURRENT_V1}/`,
			exit: code => { app.exit(code); }, isIntentional: () => !currentWindow(),
			reportError: fail, webContents: contents, windowFor: currentWindow,
		});
		created.once('ready-to-show', () => { if (!created.isDestroyed()) created.show(); });
		created.on('close', event => {
			if (downloads.deferClose(() => { if (!created.isDestroyed()) created.close(); }) || !close.requestWindowClose()) event.preventDefault();
		});
		created.on('closed', () => { if (window === created) { window = null; invalidateRenderer(); } });
		hooks.onWindowCreated?.(created);
		await created.loadURL(`${LIGHTSCAPER_SHELL_ORIGIN_CURRENT_V1}/`);
	}
	function invalidateRenderer(): void {
		close.invalidateRenderer(); archiveOwner = null; void archiveOpen.replaceOwner(null).catch(fail);
	}
	function enqueueArchive(path: string): void {
		if (archiveOpen.enqueuePath(path) === 'full') dialog.showErrorBox('Lightscaper', 'Finish opening the pending catalog backups before opening another file.');
	}
	async function chooseArchive(): Promise<void> {
		const owner = currentWindow(); if (!owner || pickerPending) return;
		pickerPending = true;
		try {
			const result = await dialog.showOpenDialog(owner, { title: 'Open catalog backup', properties: ['openFile'],
				filters: [{ name: 'Scape catalog backups', extensions: ['liscape', 'sscape', 'fscape', 'scape'] }] });
			if (!result.canceled && currentWindow() === owner) for (const path of result.filePaths) enqueueArchive(path);
		} finally { pickerPending = false; }
	}
}
