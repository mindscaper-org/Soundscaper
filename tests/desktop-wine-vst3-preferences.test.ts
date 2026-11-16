/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WineVst3Preferences } from '../desktop/wine-vst3-preferences.ts';

test('Wine is detected automatically without enabling Windows plugins or persisting an automatic selection', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-preferences-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const probes: (string | null)[] = [];
	const service = new WineVst3Preferences({ target: 'linux-x64', userDataPath: root, applicationRoot: root, packaged: false,
		persist: async (path, contents) => writeFile(path, contents), chooseExecutable: async () => '/manual/wine',
		probe: async (selected) => { probes.push(selected); return { state: 'ready', location: selected ?? '/usr/bin/wine', version: '11.22.0', sha256: 'a'.repeat(64) }; } });
	await Promise.all([service.ready(), service.describe()]);
	assert.deepEqual(probes, [null]);
	assert.equal(service.enabled, false);
	assert.equal((await service.describe()).location, '/usr/bin/wine');
	await assert.rejects(readFile(join(root, 'wine-vst3-preferences-v1.json')));
	await service.action('enable-wine-vst3');
	assert.equal(service.enabled, true);
	await service.action('browse-wine'); await service.action('rescan-wine');
	assert.deepEqual(probes, [null, '/manual/wine', '/manual/wine']);
	assert.deepEqual(JSON.parse(await readFile(join(root, 'wine-vst3-preferences-v1.json'), 'utf8')),
		{ enabled: true, selectedPath: '/manual/wine' });
	await service.action('clear-wine');
	assert.equal(probes.at(-1), null);
	await service.action('disable-wine-vst3');
	assert.equal(await service.runtimeConfiguration(), null);
});

test('unsupported targets never probe, cancelled selections preserve settings, and failed writes grant no consent', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-preferences-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let probes = 0;
	const options = { target: 'mac-arm64', userDataPath: root, applicationRoot: root, packaged: false,
		persist: async () => { throw new Error('disk full'); }, chooseExecutable: async () => null,
		probe: async () => { probes++; return { state: 'unavailable' as const, location: null, version: null, sha256: null }; } };
	const mac = new WineVst3Preferences(options);
	assert.equal((await mac.describe()).supported, false); assert.equal(probes, 0);
	await assert.rejects(mac.action('enable-wine-vst3'));
	const linux = new WineVst3Preferences({ ...options, target: 'linux-x64' });
	await linux.action('browse-wine'); assert.equal(linux.enabled, false);
	await assert.rejects(linux.action('enable-wine-vst3'), /disk full/u);
	assert.equal(linux.enabled, false);
});
