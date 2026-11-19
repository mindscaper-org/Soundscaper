/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { fcpxmlContainedTrim } from '../helpers/fcpxml-contained-trim-fixture.ts';

test('File Import trims synchronized FCPXML audio to the visible container', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const channel = Float32Array.from({ length: 6 * 48000 }, (_, frame) => .1 + .01 * Math.floor(frame / 48000));
	await importFiles(editor, [{ name: 'Trim.fcpxml', mimeType: 'application/xml', buffer: Buffer.from(fcpxmlContainedTrim('sync-clip', true)) },
		{ name: 'dialogue.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([channel], { sampleRate: 48000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor, { includeTail: false });
	expect(pcm.length).toBe(96000);
	expect(pcm[24000]).toBeCloseTo(.12 / Math.sqrt(2), 4);
	expect(pcm[72000]).toBeCloseTo(.13 / Math.sqrt(2), 4);
});
