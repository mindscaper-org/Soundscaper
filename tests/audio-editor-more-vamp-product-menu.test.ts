/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationMenuProductItems } from '../src/soundscaper/editor-application-menu-product-runtime.js';
import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../src/common/i18n/editor-soundscaper-native-services-copy.ts';

test('the shipping Soundscaper menu includes the available Vamp analyzer for a selected range', () => {
	const item = menu(true, true).analyze.find((item: { id: string }) => item.id === 'native-analyzer-use');
	assert.ok(item, 'the selected-build alias must retain native analysis entries');
	assert.equal(item.disabled, false);
});

test('the shipping Vamp entry reports missing selection and missing analyzer runtime', () => {
	for (const [selection, runtime, reason] of [[false, true, 'Select a time range'], [true, false, 'runtime is unavailable']] as const) {
		const item = menu(selection, runtime).analyze.find((item: { id: string }) => item.id === 'native-analyzer-use');
		assert.ok(item);
		assert.equal(item.disabled, true);
		assert.ok('disabledReason' in item && typeof item.disabledReason === 'string' && item.disabledReason.includes(reason));
	}
});

function menu(selection: boolean, runtime: boolean) {
	return createApplicationMenuProductItems({ productId: 'soundscaper', capabilities: {},
		project: { sampleRate: 48_000, tracks: [], clips: [], selection: selection
			? { startFrame: 0, endFrame: 48_000, trackIds: [], clipIds: [] } : null },
		snapshot: {}, editBlocked: false, copy: SOUNDSCAPER_NATIVE_SERVICES_COPY,
		actions: { soundscaperNativeServices: { vampAnalyzerAvailable: runtime, open() {}, snapshot: {
			enabled: false, quarantined: false, payloadAvailable: true, payloadDetail: '',
			pluginEnabled: true, pluginQuarantined: false, pluginPayloadAvailable: true,
			pluginPayloadDetail: '', usableAudioBackends: [], enabledPluginFormats: ['vamp'],
		} } },
	});
}
