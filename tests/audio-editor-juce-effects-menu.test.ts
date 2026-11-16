/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperNativeServicesMenuItems } from '../src/common/editor/ui/soundscaper-native-services-menu.ts';

const labels = ['Gain', 'Convolution Reverb', 'Reverb', 'Chorus', 'Phaser', 'Compressor', 'Noise Gate',
	'Limiter', 'Ladder Filter', 'Delay', 'Waveshaper', 'Panner', 'Bias', 'IIR Filter', 'FIR Filter',
	'State Variable Filter', 'First Order Filter', 'Linkwitz-Riley Filter'];

const snapshot = {
	enabled: true, quarantined: false, payloadAvailable: true, payloadDetail: '',
	pluginEnabled: true, pluginQuarantined: false, pluginPayloadAvailable: true, pluginPayloadDetail: '',
	usableAudioBackends: [], enabledPluginFormats: ['clap'],
};

test('Effect > JUCE contains every bundled processor and opens the chosen effect', () => {
	const opened: unknown[] = [];
	const items = createSoundscaperNativeServicesMenuItems({ productId: 'soundscaper', runtimeAvailable: true,
		snapshot, effectTargetAvailable: true }, { open: (...args) => { opened.push(args); } });
	const category = items.effect.find(({ id }) => id === 'juce-effects');
	assert.ok(category);
	assert.equal(category.label, 'JUCE');
	assert.deepEqual(category.items?.map(({ label }) => label), labels);
	category.items?.find(({ label }) => label === 'Chorus')?.onClick?.();
	assert.deepEqual(opened, [['native-effect-manage', 'org.soundscaper.juce.chorus']]);
});

test('JUCE effects cannot mutate read-only projects or run without an audio track', () => {
	for (const overrides of [{ readOnly: true }, { editingBlocked: true }, { effectTargetAvailable: false }]) {
		let calls = 0;
		const items = createSoundscaperNativeServicesMenuItems({ productId: 'soundscaper', runtimeAvailable: true,
			snapshot, effectTargetAvailable: true, ...overrides }, { open: () => { ++calls; } });
		const category = items.effect.find(({ id }) => id === 'juce-effects');
		assert.equal(category?.items?.length, labels.length);
		assert.ok(category?.items?.every(({ disabled, onClick }) => disabled && !onClick));
		assert.equal(calls, 0);
	}
});
