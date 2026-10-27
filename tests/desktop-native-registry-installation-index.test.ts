/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopPluginRegistry, type PluginScanObservation } from '../desktop/plugin-registry.ts';
import { DesktopVampAnalyzerRegistry, type VampAnalyzerLibraryObservation } from '../desktop/vamp-analyzer-registry.ts';

function effect(index: number): PluginScanObservation {
	const stableId = `org.example.effect${String(index)}`;
	return { format: 'vst3', stableId, bundleStableIds: [stableId], name: 'Effect', vendor: 'Example', version: '1',
		platform: 'linux', architecture: 'x64', binaryPath: `/plugins/${String(index)}.vst3`, binaryBytes: 4096,
		binarySha256: index.toString(16).padStart(64, '0'), identity: { dev: 1, ino: index + 2 }, classification: 'effect',
		topologies: [{ inputChannels: 2, outputChannels: 2 }], realtimeSupported: true, offlineSupported: true,
		reportedLatencyFrames: 0, compatibility: 'compatible', descriptorVersion: 1 };
}
function library(): VampAnalyzerLibraryObservation {
	return { kind: 'analyzer-library', format: 'vamp', libraryPath: '/plugins/analyzers.so', libraryBytes: 4096,
		librarySha256: 'ab'.repeat(32), identity: { dev: 1, ino: 2 }, platform: 'linux', architecture: 'x64', compatibility: 'compatible',
		descriptors: Array.from({ length: 128 }, (_, index) => ({ kind: 'analyzer', format: 'vamp', identifier: `org.example.analyzer${String(index)}`,
			name: 'Analyzer', description: '', maker: 'Example', copyright: '', pluginVersion: 1, vampApiVersion: 2, inputDomain: 'time',
			minimumChannels: 1, maximumChannels: 2, preferredStepSize: 512, preferredBlockSize: 1024, parameters: [], programs: [],
			outputs: [{ identifier: 'events', name: 'Events', description: '', unit: '', binCount: 1, binNames: [], extents: null,
				quantizeStep: null, sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false }] })) };
}

for (const kind of ['effect', 'vamp'] as const) test(`${kind} allowance replay resolves each installation directly and retires forgotten indices`, context => {
	const registry = kind === 'effect' ? new DesktopPluginRegistry({ isQuarantined: () => false }) : new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const ids: string[] = [];
	if (registry instanceof DesktopPluginRegistry) for (let index = 0; index < 128; index += 1) {
		const admission = registry.record(effect(index)); assert.equal(admission.status, 'recorded');
		if (admission.status === 'recorded') ids.push(admission.installationId);
	} else {
		const admission = registry.recordLibrary(library()); assert.equal(admission.status, 'recorded');
		if (admission.status === 'recorded') ids.push(...admission.analyzers.map(analyzer => analyzer.installationId));
	}
	const tracked = new Set(ids); const get = Map.prototype.get; let lookups = 0;
	context.mock.method(Map.prototype, 'get', function (this: Map<unknown, unknown>, key: unknown) {
		if (typeof key === 'string' && tracked.has(key)) lookups += 1;
		return get.call(this, key) as unknown;
	});
	for (const id of ids) registry.allow(id);
	assert.ok(lookups <= ids.length * 2, `allowance replay performed ${String(lookups)} installation lookups`);
	context.mock.restoreAll();
	assert.ok(registry.describe().entries.every(entry => entry.eligible));
	assert.equal(registry.forget(ids[0]!), true); assert.equal(registry.forget(ids[0]!), false);
	assert.throws(() => registry.allow(ids[0]!), /registered|Unknown/iu);
	if (registry instanceof DesktopPluginRegistry) {
		const admission = registry.record({ ...effect(0), binaryPath: '/moved/effect.vst3' }); assert.equal(admission.status, 'recorded');
		registry.allow(ids[0]!); assert.equal(registry.hostGrantFor(ids[0]!).binaryPath, '/moved/effect.vst3');
	} else {
		const admission = registry.recordLibrary({ ...library(), libraryPath: '/moved/analyzers.so' }); assert.equal(admission.status, 'recorded');
		registry.allow(ids[0]!); assert.equal(registry.executionGrantFor(ids[0]!).libraryPath, '/moved/analyzers.so');
	}
});
