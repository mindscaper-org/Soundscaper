/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { IdleEffectGate } from '../src/common/editor/idle-effect-processing.ts';
import { createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1, updateAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';

test('idle processing defaults on for new and older preferences and preserves an explicit opt-out', () => {
	const defaults = createAudioEditorPreferencesV1();
	assert.equal(defaults.advanced.suspendIdleEffectProcessing, true);
	const older = { ...defaults, advanced: { audioComServerUrl: defaults.advanced.audioComServerUrl } };
	assert.equal(loadAudioEditorPreferencesV1(older).preferences.advanced.suspendIdleEffectProcessing, true);
	const disabled = updateAudioEditorPreferencesV1(defaults, { advanced: { suspendIdleEffectProcessing: false } });
	const reloaded = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(disabled))).preferences;
	assert.equal(reloaded.advanced.suspendIdleEffectProcessing, false);
	assert.equal(updateAudioEditorPreferencesV1(reloaded, { advanced: { audioComServerUrl: 'https://example.org' } }).advanced.suspendIdleEffectProcessing, false);
	assert.throws(() => updateAudioEditorPreferencesV1(defaults, { advanced: { suspendIdleEffectProcessing: 'false' } }), /boolean/u);
});

test('idle gate clears reused output, stays alive and wakes on the first nonzero input on any port', () => {
	let resets = 0;
	const gate = new IdleEffectGate(1000, 0, () => { resets++; });
	const output = [new Float32Array(100)];
	for (let i = 0; i < 3; i++) {
		assert.equal(gate.before([[]], output, 100), true);
		gate.after(output, 100);
	}
	output[0]!.fill(7);
	assert.equal(gate.before([[]], output, 100), false);
	assert.equal(resets, 1);
	assert.ok(output[0]!.every(sample => sample === 0));
	assert.equal(gate.before([[]], output, 100), false);
	assert.equal(resets, 1);
	const tiny = new Float32Array(100); tiny[99] = 1e-12;
	assert.equal(gate.before([[], [new Float32Array(100), tiny]], output, 100), true);
});

test('latent echoes survive silent gaps and useful output prevents suspension', () => {
	const gate = new IdleEffectGate(1000, 1000, () => undefined);
	const input = [new Float32Array(100)]; input[0]![0] = 1;
	const output = [new Float32Array(100)];
	assert.equal(gate.before([input], output, 100), true);
	gate.after(output, 100);
	input[0]!.fill(0);
	for (let i = 0; i < 10; i++) {
		assert.equal(gate.before([input], output, 100), true);
		output[0]!.fill(i === 9 ? 0.5 : 0);
		gate.after(output, 100);
	}
	output[0]!.fill(0);
	for (let i = 0; i < 10; i++) {
		assert.equal(gate.before([input], output, 100), true);
		gate.after(output, 100);
	}
	assert.equal(gate.before([input], output, 100), false);
});

test('disabling, control changes, unknown tails and nonfinite signals keep processing', () => {
	const gate = new IdleEffectGate(1000, 0, () => undefined);
	const output = [new Float32Array(1000)];
	gate.before([[]], output, 1000); gate.after(output, 1000);
	assert.equal(gate.before([[]], output, 1000), false);
	gate.setEnabled(false);
	assert.equal(gate.before([[]], output, 1000), true);
	gate.setEnabled(true);
	gate.wake(5000);
	assert.equal(gate.before([[]], output, 1000), true);
	gate.after(output, 1000);
	gate.wake(Infinity);
	for (let i = 0; i < 10; i++) {
		assert.equal(gate.before([[]], output, 1000), true);
		gate.after(output, 1000);
	}
	const nonfinite = new Float32Array([NaN]);
	assert.equal(gate.before([[nonfinite]], output, 1), true);
});
