/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { restorePluginDiscoveryDefaults } from '../src/common/editor/controller/preferences/plugin-discovery-defaults.ts';

test('factory reset enables scanning and restores supported common folders', async () => {
	const calls: unknown[] = [];
	await restorePluginDiscoveryDefaults({
		setEnabled: async (enabled) => { calls.push(['enabled', enabled]); },
		nativePluginAvailability: async () => ({ consent: { formats: [
			{ format: 'vst3', supported: true, granted: false, roots: [
				{ rootId: 'system', origin: 'standard', admitted: false },
				{ rootId: 'custom', origin: 'custom', admitted: true },
			] },
			{ format: 'au', supported: false, granted: false, roots: [] },
		] } }),
		setNativePluginConsent: async (request) => { calls.push(request); },
	});
	assert.deepEqual(calls, [
		['enabled', false],
		{ action: 'grant', format: 'vst3' },
		{ action: 'add-standard-root', format: 'vst3', rootId: 'system' },
		{ action: 'remove-root', format: 'vst3', rootId: 'custom' },
		['enabled', true],
	]);
});

test('failed folder restoration does not enable scanning with incomplete defaults', async () => {
	const enabled: boolean[] = [];
	await assert.rejects(restorePluginDiscoveryDefaults({
		setEnabled: async (value) => { enabled.push(value); },
		nativePluginAvailability: async () => { throw new Error('Settings unavailable'); },
		setNativePluginConsent: async () => undefined,
	}), /Settings unavailable/u);
	assert.deepEqual(enabled, [false]);
});

test('factory reset restores the Windows x86 VST2 bridge to its enabled default', async () => {
	const calls: unknown[] = [];
	await restorePluginDiscoveryDefaults({
		setEnabled: async (enabled) => { calls.push(['enabled', enabled]); },
		nativePluginAvailability: async () => ({ consent: { formats: [], windowsX86Vst2: { supported: true, enabled: false } } }),
		setNativePluginConsent: async (request) => { calls.push(request); },
	});
	assert.deepEqual(calls, [
		['enabled', false], { action: 'enable-x86-vst2', format: 'vst2' }, ['enabled', true],
	]);
});

test('factory reset leaves enabled or unsupported Windows bridges unchanged', async () => {
	for (const windowsX86Vst2 of [{ supported: true, enabled: true }, { supported: false, enabled: false }]) {
		const calls: unknown[] = [];
		await restorePluginDiscoveryDefaults({
			setEnabled: async (enabled) => { calls.push(['enabled', enabled]); },
			nativePluginAvailability: async () => ({ consent: { formats: [], windowsX86Vst2 } }),
			setNativePluginConsent: async (request) => { calls.push(request); },
		});
		assert.deepEqual(calls, [['enabled', false], ['enabled', true]]);
	}
});

test('factory reset disables Linux Wine hosting without changing Wine installation selection', async () => {
	const calls: unknown[] = [];
	await restorePluginDiscoveryDefaults({
		setEnabled: async (enabled) => { calls.push(['enabled', enabled]); },
		nativePluginAvailability: async () => ({ consent: { formats: [], linuxWineVst3: { supported: true, enabled: true } } }),
		setNativePluginConsent: async (request) => { calls.push(request); },
	});
	assert.deepEqual(calls, [
		['enabled', false], { action: 'disable-wine-vst3', format: 'vst3' }, ['enabled', true],
	]);
});
