/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('a silent delivery channel does not retain an unrelated recorder track name', async ({ page }) => {
	await disableNativeSavePicker(page);
	const fixture = await readFile(new URL('../fixtures/bwfmetaedit-mid-side.wav.base64', import.meta.url), 'utf8');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Location.wav', mimeType: 'audio/wav', buffer: Buffer.from(fixture, 'base64') }]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await chooseDropdown(page, dialog.locator('[data-export-field="dither"]'), 'None');
	await dialog.getByRole('radio', { name: 'Custom channel mapping', exact: true }).check();
	await dialog.getByRole('button', { name: 'Edit mapping', exact: true }).click();
	const mapping = page.getByRole('dialog', { name: 'Edit channel mapping', exact: true });
	await mapping.getByRole('checkbox', { name: 'Route input 2 to output 2', exact: true }).uncheck();
	await mapping.getByRole('button', { name: 'Apply', exact: true }).click();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const wave = await inspectWavBlobPcm(new Blob([bytes]));
	const { channels } = readWavePcm(bytes);
	expect(channels).toHaveLength(2);
	expect(channels[0].some(value => Math.abs(value) > 0.05)).toBe(true);
	expect(channels[1].every(value => value === 0)).toBe(true);
	expect(wave.ixml.note).toBe('Mid-side location take');
	expect(wave.ixml.tracks).toEqual([]);
});
