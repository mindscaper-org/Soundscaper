/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { startNightlyEditorHost, NIGHTLY_EDITOR_HOST_FLAG } from '../desktop/nightly-tests-editor-host.mjs';

const argv = [NIGHTLY_EDITOR_HOST_FLAG, '--user-data-dir=/tmp/editor-profile',
	'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=45000'];
const environment = { SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '1',
	SOUNDSCAPER_LOCAL_ASSISTANCE_PRODUCT_ID: 'soundscaper', SOUNDSCAPER_PACKAGED_PRODUCT_ROOT: '/opt/products',
	SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE: '/tmp/model-cache' };

test('nightly editor host synchronously loads production main with isolated settings and actual product resources', async () => {
	const calls: unknown[][] = [];
	const app = { setPath: (...args: unknown[]) => calls.push(['setPath', ...args]),
		setAppPath: (path: string) => calls.push(['appPath', path]), getVersion: () => 'launcher-version' };
	const dialog = { showMessageBox: async (..._args: unknown[]) => ({ response: 99, checkboxChecked: false }),
		showOpenDialog: async () => undefined };
	let settings: unknown;
	const plan = startNightlyEditorHost({ app, dialog }, { argv, environment, platform: 'linux', arch: 'x64',
		fileSystem: { accessSync: (path: string) => calls.push(['verify', path]), mkdirSync: () => undefined,
			readFileSync: () => JSON.stringify({ schemaVersion: 1, id: 'soundscaper', applicationVersion: '1.2.3' }),
			writeFileSync: (_path: string, value: string) => { settings = JSON.parse(value); } },
		setResourcesPath: (path: string) => calls.push(['resources', path]),
		loadMain: (path: string) => {
			assert.equal(app.getVersion(), '1.2.3');
			assert.deepEqual(settings, { schemaVersion: 1, locale: 'en', updatesEnabled: false,
				modelsDirectory: '/tmp/model-cache', nativePluginDiscoveryEnabled: false });
			calls.push(['main', path]);
		},
	});
	assert.equal(plan.profile, '/tmp/editor-profile');
	assert.deepEqual(calls, [
		['verify', '/opt/products/soundscaper.asar/desktop/preload.mjs'],
		['verify', '/opt/products/soundscaper/linux-unpacked/resources/renderer/offline-icons/soundscaper-512.png'],
		['setPath', 'userData', '/tmp/editor-profile'], ['setPath', 'appData', '/tmp/editor-profile/application-data'],
		['appPath', '/opt/products/soundscaper.asar'],
		['resources', '/opt/products/soundscaper/linux-unpacked/resources'],
		['main', '/opt/products/soundscaper.asar/desktop/main.mjs'],
	]);
	assert.deepEqual(await dialog.showMessageBox({ title: 'Local Assistance consent' }), { response: 0, checkboxChecked: false });
	await assert.rejects(dialog.showMessageBox({ title: 'Delete all projects' }), /Unexpected/u);
	await assert.rejects(dialog.showOpenDialog(), /Unexpected/u);
});

test('editor diagnostics fail closed without explicit real-model, profile and loopback authority', () => {
	for (const options of [
		{ argv: [], environment },
		{ argv, environment: { ...environment, SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '0' } },
		{ argv: argv.map(value => value.replace('127.0.0.1', '0.0.0.0')), environment },
	]) assert.throws(() => startNightlyEditorHost({ app: {}, dialog: {} }, options));
});
