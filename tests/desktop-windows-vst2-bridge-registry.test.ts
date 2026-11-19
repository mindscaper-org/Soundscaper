/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopPluginRegistry, installationIdFor, pluginObservationFromScanEntry } from '../desktop/plugin-registry.ts';
import { validateHelperPluginScanResult, type PluginScanEntry } from '../desktop/plugin-scan-results.ts';

const legacy: PluginScanEntry = { stableId: 'vst2:42', name: 'Legacy', vendor: 'Fixture', version: '1.0',
	binaryPath: '/plugins/legacy.dll', binaryBytes: 512, binarySha256: 'a'.repeat(64), binaryArchitecture: 'ia32',
	classification: 'effect', channelSupport: [{ inputs: 2, outputs: 2 }], realtime: true, offline: true,
	reportedLatencyFrames: 8, compatibility: 'compatible', descriptorVersion: 1 };
const context = { format: 'vst2' as const, platform: 'win32', architecture: 'x64', identity: { dev: 1, ino: 2 } };

test('x86 and x64 installations retain their architectures and require explicit collision selection', () => {
	let enabled = true;
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false,
		isInstallationEnabled: (entry) => entry.architecture !== 'ia32' || enabled });
	const modern: PluginScanEntry = { ...legacy, binaryArchitecture: 'x64', binarySha256: 'b'.repeat(64), binaryPath: '/plugins/modern.dll' };
	const scan = validateHelperPluginScanResult({ format: 'vst2', status: 'scanned', detail: '', entries: [legacy, modern] });
	for (const entry of scan.entries) assert.equal(registry.record(pluginObservationFromScanEntry(entry, context)).status, 'recorded');
	const id = installationIdFor(legacy.binarySha256, legacy.stableId);
	registry.allow(id);
	assert.throws(() => registry.hostGrantFor(id), /identity-collision/u);
	registry.select(id);
	assert.equal(registry.hostGrantFor(id).windowsX86Vst2, true);
	assert.equal(registry.describe().entries[0]?.installations.find((entry) => entry.installationId === id)?.architecture, 'ia32');
	enabled = false;
	assert.throws(() => registry.hostGrantFor(id), /incompatible/u);
	const nativeId = installationIdFor(modern.binarySha256, modern.stableId);
	registry.select(nativeId); registry.allow(nativeId);
	assert.equal(registry.hostGrantFor(nativeId).windowsX86Vst2, undefined);
});

test('a disabled-bridge scan cannot bind an unreadable placeholder as the real plugin identity', () => {
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const unreadable = { ...legacy, stableId: `unreadable:${legacy.binarySha256}`, compatibility: 'wrong-architecture' as const,
		classification: 'unknown' as const, channelSupport: [], realtime: false, offline: false };
	assert.equal(registry.record(pluginObservationFromScanEntry(unreadable, context)).status, 'recorded');
	assert.equal(registry.record(pluginObservationFromScanEntry(legacy, context)).status, 'recorded');
	assert.equal(registry.describe().entries.length, 1, 'successful rescan replaces the placeholder');
	assert.equal(registry.record(pluginObservationFromScanEntry({ ...legacy, stableId: 'vst2:spoof' }, context)).status, 'rejected',
		'a known digest still cannot claim another real identity');
});

test('Linux VST3 host grants carry Wine authority only while its separate opt-in is enabled', () => {
	let enabled = false;
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false, linuxWineVst3Enabled: () => enabled });
	const observation = pluginObservationFromScanEntry({ ...legacy, stableId: 'vst3:fixture', binaryArchitecture: 'x64' },
		{ ...context, format: 'vst3', platform: 'linux', architecture: 'x64' });
	assert.equal(registry.record(observation).status, 'recorded');
	const id = installationIdFor(observation.binarySha256, observation.stableId);
	registry.allow(id);
	assert.equal(registry.hostGrantFor(id).linuxWineVst3, undefined);
	enabled = true; assert.equal(registry.hostGrantFor(id).linuxWineVst3, true);
	enabled = false; assert.equal(registry.hostGrantFor(id).linuxWineVst3, undefined);
});
