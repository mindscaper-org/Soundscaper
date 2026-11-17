/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { fcpxmlAssetDurationDocument } from '../helpers/fcpxml-contained-trim-fixture.ts';

test('File Import uses the referenced asset duration when FCPXML omits it', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Whole asset.fcpxml', mimeType: 'application/xml', buffer: Buffer.from(fcpxmlAssetDurationDocument(false)) },
		{ name: 'dialogue.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(6 * 48000).fill(.25)], { sampleRate: 48000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor, { includeTail: false });
	expect(pcm.length).toBe(6 * 48000);
	expect(pcm[5 * 48000]).toBeCloseTo(.25 / Math.sqrt(2), 4);
});
