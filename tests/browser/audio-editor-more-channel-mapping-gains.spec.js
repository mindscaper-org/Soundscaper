/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, openExportDialog,
	readDownloadBytes } from './audio-editor-test-helpers.js';

test('reviewing an imported routing preset preserves its delivered attenuation and polarity', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'phase reference.wav', sampleRate: 48_000,
		duration: .1, channelCount: 2, channelAmplitudes: [.4, .1], frequency: 750 })]);
	const dialog = await openExportDialog(page, editor);
	const chooser = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	await (await chooser).setFiles({ name: 'difference.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, presets: [{ schemaVersion: 1,
			id: 'difference', label: 'Quiet difference', kind: 'audio', format: 'wav', settings: {
				channelMapping: { channels: [{ inputs: [{ channel: 0, gain: .25 }, { channel: 1, gain: -.5 }] }] },
			} }] })),
	});
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
	await page.getByRole('option', { name: 'Quiet difference (custom)', exact: true }).click();
	await dialog.locator('[data-export-channel-action="edit-mapping"] button').click();
	await page.locator('[data-export-channel-mapping]').getByRole('button', { name: 'Apply', exact: true }).click();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const delivered = await page.evaluate(async data => {
		const context = new OfflineAudioContext(1, 1, 48_000);
		const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
		return { channels: audio.numberOfChannels,
			peak: audio.getChannelData(0).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) };
	}, [...bytes]);
	expect(delivered.channels).toBe(1);
	// The fixture's right channel is pi/3 ahead: |.1 - .05*exp(i*pi/3)|.
	expect(delivered.peak).toBeCloseTo(Math.sqrt(.0075), 3);
});
