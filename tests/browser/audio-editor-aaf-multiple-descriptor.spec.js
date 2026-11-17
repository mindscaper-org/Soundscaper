/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { aafMultipleDescriptorBytes } from '../helpers/aaf-multiple-descriptor-fixture.ts';

test('AAF linked WAV descriptors on one source mob import their own recordings', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Linked.aaf', mimeType: 'application/octet-stream', buffer: Buffer.from(aafMultipleDescriptorBytes()) },
		...['First.wav', 'Second.wav'].map((name, index) => ({ name, mimeType: 'audio/wav',
			buffer: Buffer.from(encodeWav([new Float32Array(4800).fill(index ? .375 : .125)], { sampleRate: 48000, bitDepth: 16, dither: false })) }))]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor, { includeTail: false });
	expect(pcm[1200]).toBeCloseTo(.5 * Math.SQRT1_2, 4);
});
