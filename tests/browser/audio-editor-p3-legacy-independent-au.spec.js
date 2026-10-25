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


test('mixed legacy project import classifies supported audio by ownership rather than its AU filename', async ({ page }) => {
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const independent = createWavFixture({ name: 'Independent.au', frequency: 330, duration: .2, channelCount: 1 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [independent]);
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await importFiles(editor, [
		{ name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(await projectFile.arrayBuffer()) },
		{ name: dataFile.name, mimeType: dataFile.type, buffer: Buffer.from(await dataFile.arrayBuffer()) }, independent,
	]);
	await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

for (const caseSibling of [true, false]) test(`selected legacy data directory keeps independent sibling audio; case-only=${String(caseSibling)}`, async ({ page }, testInfo) => {
	// Directory admission imports both the legacy document and its sibling audio.
	test.setTimeout(60_000);
	const root = testInfo.outputPath('Selected');
	const blocks = join(root, 'Session_data');
	const independentDirectory = join(root, caseSibling ? 'SESSION_DATA' : 'Other_data');
	await mkdir(blocks, { recursive: true });
	try { await mkdir(independentDirectory); }
	catch (error) {
		if (caseSibling && error.code === 'EEXIST') test.skip(true, 'The filesystem cannot hold case-distinct sibling directories.');
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
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(clipByName(editor, independent.name)).toBeVisible();
	const downloaded = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloaded));
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.clips).toHaveLength(2);
	expect(project.sources).toHaveLength(2);
	const recording = project.sources.find(source => source.name === independent.name);
	expect(recording).toMatchObject({ frameCount: 9600, sampleRate: 48000, channelCount: 1 });
	const pcm = entries[`audio/${recording.id}.f32c`];
	expect(pcm).toBeDefined();
	const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	expect(view.getUint32(0, true)).toBe(9600);
	expect(view.getFloat32(4 + 1000 * 4, true)).toBe(independent.buffer.readInt16LE(44 + 1000 * 2) / 32768);
});
