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
