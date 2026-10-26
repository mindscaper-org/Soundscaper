/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const extension of ['raw', 'pcm', 'wav']) test(`import preserves original ${extension} file facts through native Save`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const name = `Room.${extension}`;
	const mimeType = extension === 'wav' ? 'audio/wav' : 'application/octet-stream';
	const buffer = extension === 'wav' ? Buffer.from(encodeWav([Float32Array.of(.25, -.25)], { sampleRate: 44_100, float: true }))
		: Buffer.from([0, 32, 0, 224]);
	let expectedTimestamp;
	if (extension === 'wav') {
		const input = editor.locator('[data-import-input]');
		await input.setInputFiles({ name, mimeType, buffer });
	} else {
		await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
		const dialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
		const input = dialog.locator('input[type="file"]');
		await input.setInputFiles({ name, mimeType, buffer });
		expectedTimestamp = await input.evaluate(node => new Date(node.files[0].lastModified).toISOString());
		await dialog.getByRole('button', { name: 'Import', exact: true }).click();
		await expect(dialog).toHaveCount(0);
	}
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const pending = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const archive = unzipSync(await downloadBytes(await pending));
	const project = JSON.parse(strFromU8(archive['project.json'])); const source = project.sources[0];
	expect(source).toMatchObject({ sampleRate: 44_100, frameCount: 2, channelCount: 1 });
	const origin = source.provenance.contributions[0].origin;
	expect(origin).toMatchObject({ kind: 'local-file', originalFileName: name, mimeType, byteLength: buffer.length });
	if (expectedTimestamp) expect(origin.lastModified).toBe(expectedTimestamp);
	const pcm = Buffer.from(Object.entries(archive).find(([key]) => key.endsWith('.f32c'))[1]);
	expect(pcm.readUInt32LE(0)).toBe(2); expect(pcm.readFloatLE(4)).toBe(.25); expect(pcm.readFloatLE(8)).toBe(-.25);
});
