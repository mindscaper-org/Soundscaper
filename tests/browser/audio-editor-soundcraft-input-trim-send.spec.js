/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { soundcraftInputTrimSession } from '../helpers/soundcraft-input-trim-fixture.ts';

test('SoundCraft input trim remains audible on an automated pre-fader cue', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Trim.scraft', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(soundcraftInputTrimSession(true, true))) },
		{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor);
	const peak = pcm.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
	expect(peak).toBeCloseTo(.125, 3);
});
