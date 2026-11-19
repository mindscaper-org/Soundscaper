/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audioEffectLabel, audioEffectTypes, audioSelectionEffectTypes, createEffect, effectTailFrames } from '../src/common/editor/effects.js';
import { effectParameterInventory } from '../src/common/editor/effect-parameter-descriptors.ts';
import { PROJECT_FEATURE_AUDIO_EFFECT_TYPES } from '../src/common/editor/project-feature-capabilities.ts';
import { applyAudioSelectionEffectAsync, estimateAudioSelectionEffectOutputFrames } from '../src/common/editor/selection-effects.js';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';
import { nativeEffectParameterLabel } from '../src/common/editor/ui/inspector/effect-helpers.ts';

test('Hum removal is reachable from Noise removal and repair and available in selection and realtime racks', () => {
	assert.ok(audioEffectTypes().includes('hum-removal'));
	assert.ok(audioSelectionEffectTypes().includes('hum-removal'));
	assert.equal(audioEffectLabel('hum-removal'), 'Hum removal');
	assert.ok(EFFECT_MENU_GROUPS.some(([group, types]) => group === 'noiseRepair' && types.includes('hum-removal')));
	assert.ok((PROJECT_FEATURE_AUDIO_EFFECT_TYPES as readonly string[]).includes('hum-removal'));
	const effect = createEffect('hum-removal');
	const inventory = effectParameterInventory({ kind: 'track', id: 'track-1' }, effect, { sampleRate: 48000 });
	assert.equal(inventory.descriptors.length, 4);
	for (const descriptor of inventory.descriptors) {
		assert.equal(descriptor.latencyFrames, 0);
		assert.equal(descriptor.automatable, false);
		assert.match(descriptor.automationBlockReason ?? '', /live controls/);
		assert.equal(descriptor.address.kind, 'effect');
		if (descriptor.address.kind === 'effect') {
			assert.doesNotMatch(nativeEffectParameterLabel('hum-removal', descriptor.address.parameterId, 'en'), /^effectParam/);
		}
	}
	assert.ok(effectTailFrames(effect, 48000) > 0);
	assert.equal(effectTailFrames(createEffect('hum-removal', { params: { reduction: 0 } }), 48000), 0);
});

test('selection Hum removal retains duration, reduces mains hum and leaves its input unchanged', async () => {
	const rate = 8000;
	const input = Float32Array.from({ length: rate * 4 }, (_, frame) => .4 * Math.sin(2 * Math.PI * 60 * frame / rate));
	const before = input.slice();
	const params = { frequency: 60, harmonics: 3, bandwidth: 4, reduction: 30 };
	assert.equal(estimateAudioSelectionEffectOutputFrames('hum-removal', input.length, params), input.length);
	const result = await applyAudioSelectionEffectAsync('hum-removal', [input], rate, params);
	assert.equal(result.length, 1);
	assert.equal(result[0].length, input.length);
	assert.deepEqual(input, before);
	const rms = (samples: Float32Array): number => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
	const ratio = rms(result[0].subarray(rate * 3)) / rms(input.subarray(rate * 3));
	assert.ok(ratio < .035 && ratio > .025, `Expected about 30 dB reduction; amplitude ratio was ${ratio}.`);
});
