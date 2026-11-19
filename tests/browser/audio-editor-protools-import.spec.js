/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { proToolsFixture } from '../helpers/protools-import-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('Pro Tools File Import binds audio cuts, retains them after reload, and File Open accepts legacy sessions', async ({ page }) => {
	await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const wav = Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }));
	await importFiles(editor, [
		{ name: 'Voice.ptx', mimeType: 'application/octet-stream', buffer: Buffer.from(proToolsFixture({ pagePadding: true })) },
		{ name: 'voice.wav', mimeType: 'audio/wav', buffer: wav },
	]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	await chooseFileAction(page, editor, 'Save project');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	const exporting = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	const download = await exporting;
	const otio = JSON.parse(Buffer.from(await downloadBytes(download)).toString('utf8'));
	const children = otio.tracks.children[0].children;
	expect(children[0].source_range.duration.value / children[0].source_range.duration.rate).toBe(.5);
	expect(children[1].source_range.start_time.value / children[1].source_range.start_time.rate).toBe(.25);
	expect(children[1].source_range.duration.value / children[1].source_range.duration.rate).toBe(.5);
	await download.delete();
	for (const [extension, version] of [['ptf', 8], ['pts', 5]]) {
		const previous = await editor.getAttribute('data-project-id');
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: `Legacy.${extension}`, mimeType: 'application/octet-stream', buffer: Buffer.from(proToolsFixture({ version })) });
		await expect(editor).not.toHaveAttribute('data-project-id', previous);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	}
});
