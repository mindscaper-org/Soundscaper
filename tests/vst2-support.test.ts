/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopPluginConsent } from '../desktop/plugin-consent.ts';
import { createDefaultPluginDiscoveryConsent } from '../desktop/plugin-discovery-defaults.ts';
import { HELPER_EFFECT_PLUGIN_FORMATS } from '../desktop/helper-job-grant.ts';
import { createNativePluginEffect, normalizeNativePluginEffect } from '../src/common/editor/native-plugin-effect.ts';
import { createSoundscaperNativePluginState } from '../src/soundscaper/editor-native-plugin-state.ts';
import { expectedSoundscaperProfessionalNativeInventory } from '../scripts/lib/soundscaper-professional-native-build-result-contract.mjs';
import {
	availableNativePluginRuntimeFormats,
	registerNativePluginRuntimeIdentity,
	releaseNativePluginRuntime,
} from '../src/common/editor/native-plugin-realtime-node.js';

test('VST2 is an effect format on every maintained desktop target', () => {
	assert.ok([...HELPER_EFFECT_PLUGIN_FORMATS].some((format) => format === 'vst2'));
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		assert.ok(expectedSoundscaperProfessionalNativeInventory(target).peerPluginFormats.includes('vst2'));
	}
});

test('VST2 scanning requires explicit consent and preserves that choice across restart', () => {
	for (const platform of ['linux', 'darwin', 'win32']) {
		const options = { platform, homeDirectory: '/home/editor', pickDirectory: () => Promise.resolve(null) };
		const consent = createDefaultPluginDiscoveryConsent(options, { enabled: true, isFormatActivated: () => true });
		const offer = consent.describe().formats.find((format) => format.format === 'vst2');
		assert.ok(offer?.supported);
		assert.equal(offer.granted, false);
		assert.ok(offer.roots.length > 0);
		assert.throws(() => consent.scanTargets('vst2'), /consent/iu);
		consent.grant('vst2');
		consent.admitStandardRoot('vst2', offer.roots[0].rootId);
		assert.ok(consent.scanTargets('vst2')[0].path);
		const restored = new DesktopPluginConsent({ ...options, state: consent.exportState() });
		assert.deepEqual(restored.scanTargets('vst2'), consent.scanTargets('vst2'));
	}
});

test('VST2 effect and document descriptors survive serialization without changing format', () => {
	const effect = createNativePluginEffect({
		id: 'effect-vst2', params: { instanceId: 'instance-vst2', latencyFrames: 8 },
		context: { format: 'vst2', stablePluginId: '12345678', binarySha256: 'a'.repeat(64) },
	});
	assert.deepEqual(normalizeNativePluginEffect(JSON.parse(JSON.stringify(effect))), effect);
	const state = createSoundscaperNativePluginState({
		instanceId: 'instance-vst2', format: 'vst2', stablePluginId: '12345678', binarySha256: 'a'.repeat(64),
		stateBody: { kind: 'native-plugin-state', bodyId: `native-plugin-state:${'b'.repeat(64)}`, byteLength: 4, sha256: 'b'.repeat(64) },
		enabled: true, bypassed: false, continuity: 'live', latencySamples: 8,
	});
	assert.deepEqual(createSoundscaperNativePluginState(JSON.parse(JSON.stringify(state))), state);
});

test('VST2 runtime identities remain available to realtime and offline effect admission', () => {
	try {
		registerNativePluginRuntimeIdentity('instance-vst2-runtime', 'vst2');
		assert.ok(availableNativePluginRuntimeFormats().has('vst2'));
	} finally {
		releaseNativePluginRuntime('instance-vst2-runtime');
	}
	assert.equal(availableNativePluginRuntimeFormats().has('vst2'), false);
});
