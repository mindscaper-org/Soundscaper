/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, collectClientErrors,
	disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

// Node checks the full name/MIME matrix and exact PCM after independent reopen.
test('File Import and Save retain AIFF identity with and without a suffix', async ({ page }) => {
	test.setTimeout(60_000);
	const pcm = [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)];
	const buffer = Buffer.from(encodeAiff(pcm, { sampleRate: 48_000, bitDepth: 16, dither: false }));
	const names = ['Recording', 'Recording.aiff'];
	await disableNativeSavePicker(page); const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(names.map(name => ({ name, mimeType: 'audio/aiff', buffer })));
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const archive = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(archive['project.json']));
	expect(project.sources).toHaveLength(2);
	for (const name of names) {
		const source = project.sources.find(source => source.name === name); expect(source, name).toBeDefined();
		expect(source).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 2, mimeType: 'audio/aiff' });
		const samples = Buffer.from(archive[`audio/${source.id}.f32c`]); expect(samples.readUInt32LE(0)).toBe(4800);
		for (let frame = 0; frame < 4800; frame++) {
			expect(samples.readFloatLE(4 + frame * 4)).toBe(.25);
			expect(samples.readFloatLE(4 + (4800 + frame) * 4)).toBe(-.125);
		}
	}
	expect(errors).toEqual([]);
});
