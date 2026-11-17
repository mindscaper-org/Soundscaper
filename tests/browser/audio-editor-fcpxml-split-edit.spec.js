/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { fcpxmlSplitEdit } from '../helpers/fcpxml-split-edit-fixture.ts';

for (const [start, duration] of [[1, 4], [3, 1]]) test(`FCPXML import retains split audio from ${start} for ${duration} seconds`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const channel = Float32Array.from({ length: 6 * 48000 }, (_, frame) => .1 + .01 * Math.floor(frame / 48000));
	await importFiles(editor, [{ name: 'Split.fcpxml', mimeType: 'application/xml', buffer: Buffer.from(fcpxmlSplitEdit('asset-clip', start, duration)) },
		{ name: 'dialogue.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([channel], { sampleRate: 48000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor, { includeTail: false });
	expect(pcm.length).toBe((start + duration) * 48000);
	for (const second of [1.5, 2.5, 3.5]) {
		const expected = second >= start && second < start + duration ? (.1 + .01 * Math.floor(second)) / Math.sqrt(2) : 0;
		expect(pcm[second * 48000]).toBeCloseTo(expected, 4);
	}
});
