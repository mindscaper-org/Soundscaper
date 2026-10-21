/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, readFile } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles, openExportDialog } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const [date, time, displayedDate] of [['2026.02.03', '04_05_06', '2026-02-03'], ['0000-02-29', '04:05:06', '0000-02-29']]) {
	test(`valid imported BEXT origination ${date} stays visible in its metadata fields`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const bytes = encodeWav([new Float32Array(480)], { sampleRate: 48_000,
			bext: { originationDate: date, originationTime: time } });
		await editor.locator('[data-import-input]').setInputFiles({ name: 'origination.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) });
		await expect(editor.locator('[data-clip-id]').first()).toBeVisible();
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();
		await expect(panel.locator('input[name="originationDate"]')).toHaveValue(displayedDate);
		await expect(panel.locator('input[name="originationTime"]')).toHaveValue('04:05:06');
	});
}

test('imported audio presets reset omitted settings in the actual downloaded WAV', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	const originalRate = Number(await dialog.locator('[data-export-field="sampleRate"] input').inputValue());
	const presets = dialog.locator('[data-delivery-presets]');
	await presets.getByRole('button', { name: 'More options', exact: true }).click();
	const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	await (await choosing).setFiles({ name: 'delivery-presets.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
		schemaVersion: 1, presets: [
			{ schemaVersion: 1, id: 'telephone', label: 'Telephone', kind: 'audio', format: 'wav',
				settings: { sampleRate: 16_000, sampleFormat: 'int16', channelMapping: 'mono', dither: 'none', mode: 'clips', includeTail: false } },
			{ schemaVersion: 1, id: 'defaults', label: 'Default WAV', kind: 'audio', format: 'wav', settings: {} },
		],
	})) });
	for (const name of ['Telephone', 'Default WAV']) {
		await presets.getByRole('button', { name: 'Preset', exact: true }).click();
		await page.getByRole('option', { name: `${name} (custom)`, exact: true }).click();
	}
	await expect(dialog.locator('[data-export-field="sampleRate"] input')).toHaveValue(String(originalRate));
	const downloading = page.waitForEvent('download');
	await dialog.locator('[data-export-action="start"] button').click();
	const download = await downloading;
	expect(download.suggestedFilename()).toMatch(/\.wav$/u);
	const bytes = await readFile(await download.path());
	expect(bytes.toString('ascii', 12, 16)).toBe('fmt ');
	expect(bytes.readUInt16LE(22)).toBe(2);
	expect(bytes.readUInt32LE(24)).toBe(originalRate);
	expect(bytes.readUInt16LE(34)).toBe(24);
});

test('a broken label file leaves the other selected label files imported', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.locator('[data-import-input]').setInputFiles([
		{ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('0\t0.1\tFirst retained\n') },
		{ name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('malformed') },
		{ name: 'last.txt', mimeType: 'text/plain', buffer: Buffer.from('0.4\t0.5\tLast retained\n') },
	]);
	await expect(editor.getByRole('group', { name: 'Edit labels: First retained', exact: true })).toBeVisible();
	await expect(editor.getByRole('group', { name: 'Edit labels: Last retained', exact: true })).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('A TXT label needs a time and title.');
});
