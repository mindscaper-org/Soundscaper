/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeClipProperties, closeDialog, commitInput, disableNativeSavePicker, importFiles, openClipProperties, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';

test('Normalize measures every channel emitted by a mono clip Reverb', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'mono.wav', duration: 1, frequency: 1000, channelAmplitudes: [.7], channelCount: 1 })]);
	const clip = editor.locator('[data-clip-id]').first();
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, properties, 'track', 'Reverb');
	const reverb = page.getByRole('dialog', { name: 'Reverb', exact: true });
	await commitInput(reverb.locator('[data-effect-param="mix"] input'), '.8');
	await commitInput(reverb.locator('[data-effect-param="decay"] input'), '.1');
	await closeDialog(reverb); await closeClipProperties(properties);
	const id = await editor.getAttribute('data-project-id'), clipId = await clip.getAttribute('data-clip-id');
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, id))?.clips.find(value => value.id === clipId)?.gain).toBeGreaterThan(1);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
	const output = readWavePcm(await readDownloadBytes(page, link));
	let peak = 0; for (const channel of output.channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
	expect(20 * Math.log10(peak)).toBeCloseTo(-1, 1);
});
