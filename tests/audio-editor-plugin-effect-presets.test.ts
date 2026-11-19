/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEffectPresets, saveAudioEditorEffectPreset, listAudioEditorEffectPresets,
	exportAudioEditorEffectPreset, importAudioEditorEffectPresets, deleteAudioEditorEffectPreset } from '../src/common/editor/effect-presets.js';
import { pluginEffectType } from '../src/common/editor/effect-plugin-identity.ts';

test('every plug-in format saves, restores, exports and deletes presets under its own stable identity', () => {
	let state = createAudioEditorEffectPresets();
	for (const format of ['vst3', 'vst2', 'clap', 'au', 'lv2', 'ladspa', 'nyquist', 'vamp']) {
		const effectType = pluginEffectType(format, 'example:effect');
		const params = { values: { gain: 0.75 }, program: 'Bright', debug: false };
		const saved = saveAudioEditorEffectPreset(state, { effectType, name: 'Bright', params, idFactory: () => format });
		state = saved.state;
		params.values.gain = 0;
		assert.deepEqual(saved.preset.params, { values: { gain: 0.75 }, program: 'Bright', debug: false });
		const imported = importAudioEditorEffectPresets(createAudioEditorEffectPresets(), exportAudioEditorEffectPreset(state, format));
		assert.deepEqual(listAudioEditorEffectPresets(imported, effectType), [saved.preset]);
		assert.equal(listAudioEditorEffectPresets(state, pluginEffectType(format, 'other')).length, 0);
		assert.equal(deleteAudioEditorEffectPreset(imported, format).presets.length, 0);
	}
	assert.equal(state.presets.length, 8);
});

test('plug-in presets reject executable, cyclic, nonfinite, and oversized payloads', () => {
	const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
	for (const params of [{ value: Infinity }, { callback() {} }, cyclic, { value: 'x'.repeat(2 ** 21) }]) {
		assert.throws(() => saveAudioEditorEffectPreset(createAudioEditorEffectPresets(), {
			effectType: pluginEffectType('nyquist', 'effect'), name: 'Invalid', params,
		}));
	}
});
