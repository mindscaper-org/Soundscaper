/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { effectPeakMemoryLimitBytes, normalizeEffectMemoryLimitGiB } from '../src/common/editor/effect-memory-budget.ts';
import { createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1, updateAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { normalizeAudioEditorAdvancedPreferences } from '../src/common/editor/advanced-preferences.ts';

test('desktop effects default to 4 GiB while browsers retain 256 MiB', () => {
	assert.equal(effectPeakMemoryLimitBytes(true), 4 * 1024 ** 3);
	assert.equal(effectPeakMemoryLimitBytes(false), 256 * 1024 ** 2);
	assert.equal(effectPeakMemoryLimitBytes(true, 16), 16 * 1024 ** 3);
	assert.equal(effectPeakMemoryLimitBytes(false, 16), 256 * 1024 ** 2);
});

test('advanced effect memory limits migrate, persist and survive unrelated preference changes', () => {
	const initial = createAudioEditorPreferencesV1();
	assert.equal(initial.advanced.effectMemoryLimitGiB, 4);
	assert.equal(normalizeAudioEditorAdvancedPreferences({ audioComServerUrl: 'https://api.audio.com' }).effectMemoryLimitGiB, 4);
	const updated = updateAudioEditorPreferencesV1(initial, { advanced: { effectMemoryLimitGiB: 16 } });
	const changed = updateAudioEditorPreferencesV1(updated, { advanced: { audioComServerUrl: 'https://audio.example' } });
	const restored = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(changed))).preferences;
	assert.equal(restored.advanced.effectMemoryLimitGiB, 16);
	assert.equal(restored.advanced.audioComServerUrl, 'https://audio.example');
});

test('effect memory preferences reject invalid values and unsafe byte counts without invoking accessors', () => {
	for (const value of [null, '', '8', 0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
		assert.throws(() => normalizeEffectMemoryLimitGiB(value), /memory limit/u);
		assert.throws(() => normalizeAudioEditorAdvancedPreferences({ effectMemoryLimitGiB: value }), /memory limit/u);
	}
	const input = Object.defineProperty({}, 'effectMemoryLimitGiB', { enumerable: true, get() { assert.fail('Preference accessors must not run'); } });
	assert.throws(() => normalizeAudioEditorAdvancedPreferences(input), /data property/u);
});
