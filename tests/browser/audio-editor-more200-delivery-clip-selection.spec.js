/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, closeDialog, disableNativeSavePicker, downloadBytes, openExportDialog, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { deliverySelectionArchive } from '../helpers/more200-delivery-selection-fixture.ts';

test('Delivery queue offers selected clips and writes exactly their selected span', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Selected take.sscape', mimeType: 'application/zip',
		buffer: Buffer.from(await (await deliverySelectionArchive()).arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'delivery-clip-selection');
	await waitForProjectActivation(editor);
	const clip = editor.locator('[data-clip-id="selected"]');
	await clip.focus();
	await clip.press('Enter');
	const exporting = await openExportDialog(page, editor);
	await exporting.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Selected recording WAV');
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await closeDialog(exporting);
	await chooseFileAction(page, editor, 'Delivery queue');
	const queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
	const targets = queue.getByRole('group', { name: 'Deliver', exact: true });
	const selection = targets.getByRole('checkbox', { name: 'Current selection', exact: true });
	await expect(selection).toBeEnabled();
	await targets.getByRole('checkbox', { name: 'Entire project', exact: true }).uncheck();
	await selection.check();
	await queue.getByRole('group', { name: 'Formats', exact: true }).getByRole('checkbox', { name: 'Selected recording WAV', exact: true }).check();
	const download = page.waitForEvent('download');
	await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
	const bytes = await downloadBytes(await download);
	await expect(queue.getByRole('listitem')).toContainText('Delivered');
	const wav = new Blob([bytes]);
	const descriptor = await inspectWavBlobPcm(wav);
	expect(descriptor.sampleRate).toBe(48_000);
	expect(descriptor.frameCount).toBe(24_000);
	const peaks = [];
	await streamWavBlobPcm(wav, { descriptor, onChunk(channels) { peaks.push(channels[0][100]); } });
	expect(peaks[0]).toBeCloseTo(0.25 * Math.SQRT1_2, 4);
});
