/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import {
	LIGHTSCAPER_SHELL_CHANNELS_CURRENT_V1 as CHANNELS,
	isLightscaperShellDocumentCurrentV1,
	readLightscaperCloseRequestCurrentV1,
	readLightscaperCloseResponseCurrentV1,
} from '../desktop/lightscaper-shell-contract-current-v1.ts';
import { createLightscaperCloseCoordinatorCurrentV1 } from '../desktop/lightscaper-close-coordinator-current-v1.ts';
import { createLightscaperPreloadBridgeCurrentV1 } from '../desktop/lightscaper-preload-bridge-current-v1.ts';
import { isLightscaperBlobDownloadCurrentV1, lightscaperBrowserWindowOptionsCurrentV1 } from '../desktop/lightscaper-window-security-current-v1.ts';
import { createTrustedDesktopIpc } from '../desktop/main-trusted-ipc.ts';

const FIRST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENVIRONMENT = { productId: 'lightscaper', platform: 'linux', arch: 'x64', version: '0.1.0-beta.1', development: false, locale: 'de' };

test('Lightscaper shell accepts only its exact main document authority', () => {
	assert.equal(isLightscaperShellDocumentCurrentV1('lightscaper-app://bundle/'), true);
	for (const url of ['https://lightscaper.org/', 'soundscaper-app://bundle/', 'framescaper-app://bundle/',
		'lightscaper-app://bundle.evil/', 'lightscaper-app://user@bundle/', 'lightscaper-app://bundle:1/',
		'lightscaper-app://bundle:/', 'lightscaper-app://bundle/?project=x', 'lightscaper-app://bundle/#x',
		'lightscaper-app://bundle/en/', 'lightscaper-app://BUNDLE/', 'lightscaper-app:///bundle/', 'invalid']) {
		assert.equal(isLightscaperShellDocumentCurrentV1(url), false, url);
	}
});

test('Lightscaper close wire is closed and never invokes foreign accessors', () => {
	assert.deepEqual(readLightscaperCloseRequestCurrentV1({ requestId: FIRST, reason: 'quit' }), { requestId: FIRST, reason: 'quit' });
	assert.deepEqual(readLightscaperCloseResponseCurrentV1({ requestId: FIRST, allow: false }), { requestId: FIRST, allow: false });
	let reads = 0;
	const accessor = { get requestId() { reads++; return FIRST; }, allow: true };
	for (const value of [accessor, { requestId: FIRST, allow: true, path: '/tmp/forbidden' },
		{ requestId: FIRST, allow: 1 }, { requestId: 'wrong', allow: true }, Object.create({ requestId: FIRST, allow: true })]) {
		assert.throws(() => readLightscaperCloseResponseCurrentV1(value), TypeError);
	}
	assert.equal(reads, 0);
	assert.throws(() => readLightscaperCloseRequestCurrentV1({ requestId: FIRST, reason: 'reload' }), TypeError);
});

function closeFixture() {
	const sent: unknown[] = [], actions: string[] = []; let ids = 0;
	const coordinator = createLightscaperCloseCoordinatorCurrentV1({
		createRequestId: () => ids++ === 0 ? FIRST : SECOND,
		sendRequest: value => { sent.push(value); },
		closeWindow: () => { actions.push('close'); },
		quitApplication: () => { actions.push('quit'); },
		flushStorage: () => { actions.push('flush'); },
	});
	return { coordinator, sent, actions };
}

test('native close remains vetoed until its one current request is admitted', () => {
	const { coordinator, sent, actions } = closeFixture();
	assert.equal(coordinator.requestWindowClose(), true);
	coordinator.signalReady();
	assert.equal(coordinator.requestWindowClose(), false);
	assert.equal(coordinator.requestWindowClose(), false);
	assert.deepEqual(sent, [{ requestId: FIRST, reason: 'window-close' }]);
	assert.equal(coordinator.respond({ requestId: SECOND, allow: true }), false);
	assert.deepEqual(actions, []);
	assert.equal(coordinator.respond({ requestId: FIRST, allow: false }), true);
	assert.equal(coordinator.requestWindowClose(), false);
	assert.equal(coordinator.respond({ requestId: SECOND, allow: true }), true);
	assert.deepEqual(actions, ['flush', 'close']);
	assert.equal(coordinator.requestWindowClose(), true);
	assert.equal(coordinator.respond({ requestId: SECOND, allow: true }), false);
});

test('application Quit upgrades pending window close and a renderer change revokes old responses', () => {
	const first = closeFixture(); first.coordinator.signalReady(); first.coordinator.requestWindowClose();
	first.coordinator.beforeQuit();
	assert.equal(first.coordinator.respond({ requestId: FIRST, allow: true }), true);
	assert.deepEqual(first.actions, ['flush', 'quit']);
	const second = closeFixture(); second.coordinator.signalReady(); second.coordinator.requestWindowClose();
	second.coordinator.invalidateRenderer(); second.coordinator.signalReady(); second.coordinator.requestWindowClose();
	assert.equal(second.coordinator.respond({ requestId: FIRST, allow: true }), false);
	assert.deepEqual(second.actions, []);
	assert.equal(second.coordinator.respond({ requestId: SECOND, allow: true }), true);
	assert.deepEqual(second.actions, ['flush', 'close']);
});

test('preload exposes only closed Lightscaper lifecycle methods and removes subscriptions once', async () => {
	const invokes: [string, unknown[]][] = [], listeners = new Map<string, (event: unknown, value: unknown) => void>();
	let removals = 0;
	const api = createLightscaperPreloadBridgeCurrentV1({
		invoke: async (channel, ...args) => { invokes.push([channel, args]); return channel === CHANNELS.environment ? ENVIRONMENT : true; },
		on: (channel, listener) => { listeners.set(channel, listener); },
		removeListener: (channel, listener) => { assert.equal(listeners.get(channel), listener); listeners.delete(channel); removals++; },
	});
	assert.deepEqual(Object.keys(api).sort(), ['finishArchive', 'getEnvironment', 'onArchiveAvailable', 'onCloseRequested', 'onMenuCommand', 'photoRestore', 'photoSession', 'respondToClose', 'signalReady', 'takeArchive']);
	assert.equal(Object.isFrozen(api), true);
	assert.deepEqual(await api.getEnvironment(), ENVIRONMENT);
	await api.signalReady(); await api.respondToClose({ requestId: FIRST, allow: false });
	assert.deepEqual(invokes.map(([channel]) => channel), [CHANNELS.environment, CHANNELS.ready, CHANNELS.respond]);
	const requests: unknown[] = [];
	const off = api.onCloseRequested(request => { requests.push(request); });
	const wire = listeners.get(CHANNELS.closeRequested)!;
	wire({ sender: 'must not escape the preload' }, { requestId: FIRST, reason: 'window-close' });
	assert.deepEqual(requests, [{ requestId: FIRST, reason: 'window-close' }]);
	off(); off(); assert.equal(removals, 1);
	wire({}, { requestId: SECOND, reason: 'quit' }); assert.equal(requests.length, 1);
	assert.throws(() => { void api.respondToClose({ requestId: FIRST, allow: true, path: '/tmp/forbidden' }); });
	assert.equal(invokes.length, 3);
});

test('existing trusted IPC admits only the current Lightscaper main frame', () => {
	const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
	const mainFrame = { url: 'lightscaper-app://bundle/' }, sender = { mainFrame };
	const trusted = createTrustedDesktopIpc({
		ipcMain: { handle: (channel, listener) => { handlers.set(channel, listener); }, on: () => {} },
		windowFor: () => ({ webContents: sender }),
		assertDocumentUrl: url => { if (!isLightscaperShellDocumentCurrentV1(url)) throw new Error('wrong document'); },
	});
	trusted.handle(CHANNELS.environment, () => ENVIRONMENT);
	const invoke = handlers.get(CHANNELS.environment)!;
	assert.deepEqual(invoke({ sender, senderFrame: mainFrame }), ENVIRONMENT);
	assert.throws(() => invoke({ sender: { mainFrame }, senderFrame: mainFrame }));
	assert.throws(() => invoke({ sender, senderFrame: { url: mainFrame.url } }));
	mainFrame.url = 'framescaper-app://bundle/';
	assert.throws(() => invoke({ sender, senderFrame: mainFrame }));
});

test('Lightscaper preload grants only the OS-selected archive and requires a joined native release', async () => {
	const id = 'a'.repeat(64), descriptor = { id, name: 'Owned.liscape', size: 3, lastModified: 0,
		url: `lightscaper-app://bundle/_desktop/read/scape-range-v1/${id}/Owned.liscape`,
		mimeType: 'application/vnd.soundscaper.scape+zip', readProfile: 'scape-range-v1' };
	let answer: unknown = null, released = true;
	const calls: [string, unknown[]][] = [];
	const api = createLightscaperPreloadBridgeCurrentV1({
		invoke: async (channel, ...args) => { calls.push([channel, args]); return channel === CHANNELS.archiveTake ? answer : released; },
		on: () => undefined, removeListener: () => undefined,
	});
	assert.equal(await api.takeArchive(), null); answer = descriptor;
	assert.deepEqual(await api.takeArchive(), descriptor);
	answer = { ...descriptor, url: 'file:///private/Owned.liscape' };
	await assert.rejects(api.takeArchive());
	const before = calls.length;
	await assert.rejects(api.finishArchive({ id, path: '/private/Owned.liscape' } as { id: string }));
	assert.equal(calls.length, before);
	await api.finishArchive({ id }); assert.deepEqual(calls.at(-1), [CHANNELS.archiveFinish, [{ id }]]);
	released = false; await assert.rejects(api.finishArchive({ id }), /not acknowledged/u);
});

test('Lightscaper archive availability sends no native events, paths or descriptors through the preload', () => {
	let listener: ((event: unknown, value: unknown) => void) | undefined, count = 0, removed = 0;
	const api = createLightscaperPreloadBridgeCurrentV1({ invoke: async () => true,
		on: (_channel, callback) => { listener = callback; }, removeListener: () => { removed++; } });
	const off = api.onArchiveAvailable((...args: unknown[]) => { assert.deepEqual(args, []); count++; });
	assert.ok(listener); listener({ sender: 'native authority' }, { available: false }); assert.equal(count, 0);
	listener({}, { available: true }); assert.equal(count, 1);
	assert.throws(() => { listener!({}, { available: true, path: '/private/Owned.liscape' }); });
	assert.equal(count, 1); off(); off(); assert.equal(removed, 1);
	listener({}, { available: true }); assert.equal(count, 1);
});

test('Lightscaper has native OS chrome and a sandboxed isolated renderer without Node', () => {
	const root = process.cwd(), options = lightscaperBrowserWindowOptionsCurrentV1({
		preloadPath: join(root, 'preload.cjs'), rendererRoot: join(root, 'renderer'), packaged: true,
	});
	assert.equal(options.frame, true); assert.equal(options.titleBarStyle, 'default');
	const web = options.webPreferences!;
	assert.equal(web.partition, 'persist:lightscaper-production'); assert.equal(web.sandbox, true);
	assert.equal(web.contextIsolation, true); assert.equal(web.nodeIntegration, false);
	assert.equal(web.nodeIntegrationInWorker, false); assert.equal(web.nodeIntegrationInSubFrames, false);
	assert.equal(web.webSecurity, true); assert.equal(web.allowRunningInsecureContent, false);
	assert.equal(web.webviewTag, false); assert.equal(web.devTools, false); assert.ok(isAbsolute(web.preload!));
});

test('download routing admits only genuine Lightscaper-origin blob output', () => {
	const blob = `blob:lightscaper-app://bundle/${FIRST}`;
	assert.equal(isLightscaperBlobDownloadCurrentV1(blob, 'lightscaper-app://bundle'), true);
	for (const [url, origin] of [[blob, 'null'], [blob, ''], [blob, 'framescaper-app://bundle'],
		[`blob:lightscaper-app://bundle.evil/${FIRST}`, 'lightscaper-app://bundle'],
		[`blob:lightscaper-app://BUNDLE/${FIRST}`, 'lightscaper-app://bundle'],
		[`blob:lightscaper-app://user@bundle/${FIRST}`, 'lightscaper-app://bundle'],
		['https://assets.soundscaper.org/file', 'lightscaper-app://bundle'],
		[`blob:lightscaper-app://bundle/${FIRST}?path=/tmp/x`, 'lightscaper-app://bundle']]) {
		assert.equal(isLightscaperBlobDownloadCurrentV1(url!, origin!), false);
	}
});
