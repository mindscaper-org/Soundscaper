/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, clipByName, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

test('mixed legacy project import keeps a standalone Sun AU recording', async ({ page, browserName }) => {
	test.skip(browserName !== 'webkit', 'The native Sun AU decoder is available in WebKit; Chromium and Firefox refuse this container.');
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const bytes = new Uint8Array(await dataFile.arrayBuffer()); const view = new DataView(bytes.buffer);
	for (let index = 0; index < 4800; index++) view.setFloat32(24 + index * 4, -.5);
	const independent = { name: 'Independent.au', mimeType: 'audio/basic', buffer: Buffer.from(bytes) };
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [independent]);
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await importFiles(editor, [
		{ name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(await projectFile.arrayBuffer()) },
		{ name: dataFile.name, mimeType: dataFile.type, buffer: Buffer.from(await dataFile.arrayBuffer()) }, independent,
	]);
	await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

test('opening a legacy AUP folder imports only its referenced audio', async ({ page }, testInfo) => {
	const root = testInfo.outputPath('Selected');
	const blocks = join(root, 'Session_data');
	const independentDirectory = join(root, 'SESSION_DATA');
	await mkdir(blocks, { recursive: true });
	try { await mkdir(independentDirectory); }
	catch (error) {
		if (error.code === 'EEXIST') test.skip(true, 'The filesystem cannot hold case-distinct sibling directories.');
		throw error;
	}
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	await writeFile(join(blocks, dataFile.name), new Uint8Array(await dataFile.arrayBuffer()));
	await writeFile(join(blocks, 'orphan.au'), new Uint8Array(await dataFile.arrayBuffer()));
	const independent = createWavFixture({ name: 'Independent.au', frequency: 330, duration: .2, channelCount: 1 });
	await writeFile(join(independentDirectory, independent.name), independent.buffer);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: projectFile.name, mimeType: projectFile.type,
		buffer: Buffer.from(await projectFile.arrayBuffer()) });
	await (await choosing).setFiles(root);
	await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clipByName(editor, independent.name)).toHaveCount(0);
	const downloaded = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloaded));
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.clips).toHaveLength(1);
	expect(project.sources).toHaveLength(1);
	const [recording] = project.sources;
	expect(recording).toMatchObject({ frameCount: 4800, sampleRate: 48000, channelCount: 1 });
	const pcm = entries[`audio/${recording.id}.f32c`];
	expect(pcm).toBeDefined();
	const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	expect(view.getUint32(0, true)).toBe(4800);
	expect(view.getFloat32(4, true)).toBe(0.25);
	expect(view.getFloat32(8, true)).toBe(-0.25);
});
