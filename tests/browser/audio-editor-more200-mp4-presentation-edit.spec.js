/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { editedM4aFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';

for (const mode of ['none', 'trim', 'offset', 'empty-first', 'version1']) test(`File Import preserves the MP4 ${mode} programme rather than all retained media`, async ({ page }) => {
	const { file, durationSeconds } = await editedM4aFixture(mode);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name);
	expect(source.sampleRate).toBe(44_100); expect(source.frameCount).toBe(Math.round(durationSeconds * 44_100));
	expect(document.clips[0].durationFrames).toBe(Math.round(source.frameCount * document.sampleRate / source.sampleRate));
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channels[0].maximum).toBeGreaterThan(.005);
});

for (const mode of ['multiple', 'all-empty']) test(`File Import refuses ${mode} MP4 edits and remains ready to import a flattened recording`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const unsupported = await editedM4aFixture(mode);
	await editor.locator('[data-import-input]').setInputFiles({ name: unsupported.file.name, mimeType: unsupported.file.type,
		buffer: Buffer.from(await unsupported.file.arrayBuffer()) });
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText(/edit list.*Flatten or render/iu, { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	const healthy = await editedM4aFixture('none');
	await editor.locator('[data-import-input]').setInputFiles({ name: healthy.file.name, mimeType: healthy.file.type,
		buffer: Buffer.from(await healthy.file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
});
