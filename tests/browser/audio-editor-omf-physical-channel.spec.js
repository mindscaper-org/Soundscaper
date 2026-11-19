/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { omfPhysicalChannelBytes } from '../helpers/omf-physical-channel-fixture.ts';

test('OMF physical channel references retain two separate mono views of one embedded WAV', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Channels.omf', mimeType: 'application/octet-stream', buffer: Buffer.from(omfPhysicalChannelBytes([1, 2])) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor, { includeTail: false });
	expect(pcm[1200]).toBeCloseTo(.5 * Math.SQRT1_2, 4);
});
