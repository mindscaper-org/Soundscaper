/* SPDX-License-Identifier: AGPL-3.0-only */

import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';

for (const kind of ['generator', 'image']) test(`DAWproject exports programme audio and reports its unsupported ${kind}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Programme.wav', duration: 1, frequency: 440, channelCount: 1 })]);
	if (kind === 'generator') await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	else {
		const choosing = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		await (await choosing).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	}
	const visual = editor.getByRole('group', { name: kind === 'image' ? 'Image clip: poster' : 'Video clip: Title', exact: true });
	await expect(visual).toBeVisible();
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const archive = await readDawprojectArchive(new Blob([await downloadBytes(await downloading)]));
	try {
		expect(archive.projectXml).toContain('Programme');
		const path = archive.entryNames.find(name => name.endsWith('.wav')); expect(path).toBeTruthy();
		const wav = await archive.readEntry(path); expect(wav).toBeTruthy();
		const bytes = new DataView(await wav.arrayBuffer());
		expect(bytes.getUint32(24, true)).toBe(48_000);
		expect(wav.size).toBe(44 + 48_000 * 4);
		expect(Math.abs(bytes.getFloat32(44 + 12_001 * 4, true))).toBeGreaterThan(0.01);
	} finally { await archive.close(); }
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).toBeVisible();
	await expect(report.locator('[data-severity="warning"]')).toContainText(new RegExp(kind, 'u'));
	await expect(visual).toBeVisible();
});
