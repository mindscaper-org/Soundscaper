/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { normalizeExportDialogAudioSettings } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { resolveExportLoudnessNormalization } from '../src/common/editor/export-plan-admission.js';

function settings(format = 'bw64', mode = 'passthrough') {
	return Object.freeze({ ...createExportDialogInitialSettings({ sampleRate: 48_000 }),
		format, adm: Object.freeze({ mode }), loudnessNormalization: 'ebu-r128' });
}

for (const desktop of [false, true]) test(`BW64 passthrough clears its now-disabled loudness choice, desktop=${desktop}`, () => {
	const original = settings();
	const normalized = normalizeExportDialogAudioSettings(original, desktop);
	assert.equal(normalized.loudnessNormalization, '');
	assert.equal(original.loudnessNormalization, 'ebu-r128');
	assert.equal(normalized.adm, original.adm);
});

test('BW64 request construction independently excludes a stale passthrough loudness target', () => {
	const request = createExportDialogRequest(settings());
	assert.equal(Object.hasOwn(request, 'loudnessNormalization'), false);
	assert.deepEqual(request.adm, { mode: 'passthrough' });
});

for (const [format, mode] of [['wav', 'passthrough'], ['bw64', 'authored']] as const) test(`normalization remains available for ${format}/${mode}`, () => {
	const original = settings(format, mode);
	assert.equal(normalizeExportDialogAudioSettings(original, false), original);
	assert.equal(createExportDialogRequest(original).loudnessNormalization, 'ebu-r128');
});

test('split delivery still clears hidden normalization and the plan still refuses an explicit passthrough target', () => {
	const original = { ...settings('wav', 'authored'), mode: 'stems' };
	assert.equal(normalizeExportDialogAudioSettings(original, false).loudnessNormalization, '');
	assert.equal(Object.hasOwn(createExportDialogRequest(original), 'loudnessNormalization'), false);
	assert.throws(() => resolveExportLoudnessNormalization({ loudnessNormalization: 'ebu-r128' }, {
		mode: 'mix', admMetadata: { mode: 'passthrough' }, renderStrategy: 'offline',
	}), /cannot be loudness-normalized/u);
});
