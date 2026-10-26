/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, collectClientErrors,
	disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const [name, mimeType] of [['Recording', 'audio/aiff'], ['Recording.aiff', 'audio/aiff']]) {
	test(`File Import and native Save retain the authored AIFF source for ${name}`, async ({ page }) => {
		const pcm = [new Float32Array(4_800).fill(.25), new Float32Array(4_800).fill(-.125)];
		const buffer = Buffer.from(encodeAiff(pcm, { sampleRate: 48_000, bitDepth: 16, dither: false }));
		await disableNativeSavePicker(page); const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Import');
		await editor.locator('[data-import-input]').setInputFiles({ name, mimeType, buffer });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const archive = unzipSync(await downloadBytes(await saving));
		const project = JSON.parse(strFromU8(archive['project.json']));
		expect(project.sources).toHaveLength(1);
		expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 4_800, channelCount: 2, mimeType: 'audio/aiff' });
		expect(errors).toEqual([]);
	});
}
