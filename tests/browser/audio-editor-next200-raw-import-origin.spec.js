/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

// The Node origin tests cover each suffix and desktop slice through Scape
// reopening. Keep both actual import UIs and every suffix in one browser Save.
test('raw, pcm and WAV imports preserve their original file facts through native Save', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const files = [];
	for (const extension of ['raw', 'pcm', 'wav']) {
		const name = `Room.${extension}`;
		const mimeType = extension === 'wav' ? 'audio/wav' : 'application/octet-stream';
		const buffer = extension === 'wav' ? Buffer.from(encodeWav([Float32Array.of(.25, -.25)], { sampleRate: 44_100, float: true }))
			: Buffer.from([0, 32, 0, 224]);
		let input, dialog;
		if (extension === 'wav') input = editor.locator('[data-import-input]');
		else {
			await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
			dialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
			input = dialog.locator('input[type="file"]');
		}
		await input.setInputFiles({ name, mimeType, buffer });
		const lastModified = extension === 'wav' ? null
			: await input.evaluate(node => new Date(node.files[0].lastModified).toISOString());
		files.push({ name, mimeType, byteLength: buffer.length, lastModified });
		if (dialog) {
			await dialog.getByRole('button', { name: 'Import', exact: true }).click();
			await expect(dialog).toHaveCount(0);
		}
		await expect(editor).toHaveAttribute('data-clip-count', String(files.length));
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	}
	const pending = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const archive = unzipSync(await downloadBytes(await pending));
	const project = JSON.parse(strFromU8(archive['project.json']));
	expect(project.sources).toHaveLength(3); expect(project.clips).toHaveLength(3);
	for (const file of files) {
		const source = project.sources.find(source => source.provenance.contributions
			.some(contribution => contribution.origin.originalFileName === file.name));
		expect(source, file.name).toMatchObject({ sampleRate: 44_100, frameCount: 2, channelCount: 1 });
		expect(source.provenance.contributions[0].origin).toMatchObject({ kind: 'local-file',
			originalFileName: file.name, mimeType: file.mimeType, byteLength: file.byteLength });
		if (file.lastModified) expect(source.provenance.contributions[0].origin.lastModified).toBe(file.lastModified);
		const pcm = Buffer.from(archive[`audio/${source.id}.f32c`]);
		expect(pcm.readUInt32LE(0)).toBe(2); expect(pcm.readFloatLE(4)).toBe(.25); expect(pcm.readFloatLE(8)).toBe(-.25);
	}
});
