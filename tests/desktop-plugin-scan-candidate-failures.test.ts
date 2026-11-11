/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePluginScanJobRunner } from '../desktop/native-helper-scan-job.js';
import { DesktopPluginRegistry, pluginObservationFromScanEntry } from '../desktop/plugin-registry.ts';
import { validateHelperPluginScanResult } from '../desktop/plugin-scan-results.ts';
import { createService, ENTRY } from './helpers/desktop-plugin-scan-service-fixture.ts';

const PATHS = ['/plugins/a.dll', '/plugins/b.dll', '/plugins/c.dll'];
const CONTEXT = { format: 'vst2', platform: 'win32', architecture: 'x64', identity: { dev: 1, ino: 2 } } as const;

function scanRunner(fail: () => never | Promise<never>) {
	return createNativePluginScanJobRunner({
		platform: 'win32', addonPath: '/unused', addonSha256: 'f'.repeat(64),
		loadAddon: async () => ({
			describe: () => ({ pluginFormats: ['vst2'] }),
			listPluginCandidates: () => PATHS,
			inspectPluginCandidate: (path: string) => {
				if (path === PATHS[1]) return fail();
				return { status: 'ok', stableId: path, name: path, vendor: 'Fixture', version: '1',
					classification: 'effect', inputChannels: 2, outputChannels: 2,
					realtime: true, offline: true, reportedLatencyFrames: 0 };
			},
		}),
		hashFile: async (path: string) => ({ byteLength: 100, identity: CONTEXT.identity,
			sha256: String(PATHS.indexOf(path) + 1).repeat(64) }),
	});
}

for (const asynchronous of [false, true]) {
	test(`a ${asynchronous ? 'rejected' : 'thrown'} candidate inspection preserves its neighbours and allows another scan`, async () => {
		const run = scanRunner(() => {
			const error = new Error('The isolated peer refused this DLL.');
			if (asynchronous) return Promise.reject(error);
			throw error;
		});
		const { service, quarantined } = createService({ consented: ['vst2', 'vst3'],
			run: request => run({ ...request, resourcePolicy: request.resourcePolicy, onProgress: () => undefined }).completion });
		const outcome = await service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst2' });
		assert.equal(outcome.status, 'described');
		if (outcome.status !== 'described') return;
		assert.deepEqual(outcome.scan.entries.map(entry => entry.compatibility), ['compatible', 'malformed', 'compatible']);
		assert.deepEqual(quarantined, [['2'.repeat(64), 'malformed-plugin']]);
		assert.equal((await service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst2' })).status, 'described');
	});
}

test('unloadable scan entries remain visible as incompatible without inventing a channel layout', () => {
	for (const compatibility of ['wrong-architecture', 'unsupported-format', 'malformed', 'oversize'] as const) {
		const scan = validateHelperPluginScanResult({ format: 'vst2', status: 'scanned', detail: '', entries: [{
			stableId: 'unreadable:fixture', name: 'Broken.dll', vendor: 'unknown', version: '0',
			binaryPath: '/plugins/b.dll', binaryBytes: 100, binarySha256: '2'.repeat(64),
			classification: 'unknown', channelSupport: [], realtime: false, offline: false,
			reportedLatencyFrames: null, compatibility, descriptorVersion: 1,
		}] });
		const observation = pluginObservationFromScanEntry(scan.entries[0], CONTEXT);
		assert.deepEqual(observation.topologies, []);
		const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
		assert.equal(registry.record(observation).status, 'recorded');
		const entry = registry.describe().entries[0];
		assert.equal(entry.name, 'Broken.dll');
		assert.equal(entry.eligible, false);
		assert.equal(entry.ineligibleReason, 'incompatible');
		assert.throws(() => registry.hostGrantFor(entry.installations[0].installationId));
	}
});

test('a refused VST2 candidate leaves an allowed VST3 installation usable', async () => {
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const vst3 = validateHelperPluginScanResult({ format: 'vst3', status: 'scanned', detail: '', entries: [ENTRY] });
	registry.record(pluginObservationFromScanEntry(vst3.entries[0], { ...CONTEXT, format: 'vst3' }));
	const installationId = registry.describe().entries[0].installations[0].installationId;
	registry.allow(installationId);
	const run = scanRunner(() => Promise.reject(new Error('The VST2 peer refused this DLL.')));
	const { service } = createService({ consented: ['vst2', 'vst3'], run: async request => {
		const result = validateHelperPluginScanResult(await run({ ...request,
			resourcePolicy: request.resourcePolicy, onProgress: () => undefined }).completion);
		for (const entry of result.entries) registry.record(pluginObservationFromScanEntry(entry, CONTEXT));
		return result;
	} });
	assert.equal((await service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst2' })).status, 'described');
	assert.equal(registry.describe().entries.length, 4);
	assert.equal(registry.describe().entries.find(entry => entry.format === 'vst3')?.eligible, true);
	assert.equal(registry.hostGrantFor(installationId).format, 'vst3');
});
