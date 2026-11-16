/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, fileDataTransfer, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { ardourSession, soundcraftSession } from '../helpers/native-daw-import-fixtures.ts';
import { hindenburgSession } from '../helpers/hindenburg-import-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('File Import opens Ardour and SoundCraft audio sessions and File Open restores a SoundCraft bundle', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const wav = Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }));
	for (const [name, mimeType, text] of [['voice.ardour', 'application/xml', ardourSession(true)],
		['voice.scraft', 'application/json', JSON.stringify(soundcraftSession())]]) {
		await importFiles(editor, [{ name, mimeType, buffer: Buffer.from(text) }, { name: 'voice.wav', mimeType: 'audio/wav', buffer: wav }]);
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
	}
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
	await writer.add('voice.scraft', new TextReader(JSON.stringify(soundcraftSession())));
	await writer.add('Audio Files/voice.wav', new BlobReader(new Blob([wav])));
	const bundle = Buffer.from(await (await writer.close()).arrayBuffer());
	const previous = await editor.getAttribute('data-project-id');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'voice.scraftz', mimeType: 'application/zip', buffer: bundle });
	await expect(editor).not.toHaveAttribute('data-project-id', previous);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
});

for (const [product, path] of [['Soundscaper', '/embed/en/'], ['Framescaper', '/framescaper/embed/en/']]) {
	test(`${product}: Hindenburg Import binds media, Save retains trims, Open keeps offline cuts, and drop binds companions`, async ({ page }) => {
		await disableNativeSavePicker(page);
		let editor = await bootEditor(page, path, { defaultWorkspace: true });
		const session = { name: 'Podcast.NHSX', mimeType: 'application/xml', buffer: Buffer.from(hindenburgSession()) };
		const media = { name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true })) };
		await importFiles(editor, [session, media]);
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await chooseCommandAction(page, editor, 'File', 'Delivery Report');
		let report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report.getByText(/Hindenburg stereo balance and pan law/u)).toBeVisible();
		await report.getByRole('button', { name: 'Close', exact: true }).last().click();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const exporting = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
		const download = await exporting;
		const children = JSON.parse(Buffer.from(await downloadBytes(download)).toString('utf8')).tracks.children[0].children;
		expect(children[0].source_range.duration.value / children[0].source_range.duration.rate).toBe(.5);
		expect(children[1].source_range.start_time.value / children[1].source_range.start_time.rate).toBe(.25);
		expect(children[1].source_range.duration.value / children[1].source_range.duration.rate).toBe(.5);
		await download.delete();
		let previous = await editor.getAttribute('data-project-id');
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles(session);
		await expect(editor).not.toHaveAttribute('data-project-id', previous);
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
		await chooseCommandAction(page, editor, 'File', 'Delivery Report');
		report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report.getByText(/Referenced media is unavailable/u)).toBeVisible();
		await report.getByRole('button', { name: 'Close', exact: true }).last().click();
		previous = await editor.getAttribute('data-project-id');
		const transfer = await fileDataTransfer(page, [session, media]);
		const timeline = editor.getByRole('region', { name: 'Timeline', exact: true }).getByRole('region', { name: 'Timeline', exact: true });
		await timeline.dispatchEvent('dragover', { dataTransfer: transfer });
		await timeline.dispatchEvent('drop', { dataTransfer: transfer });
		await transfer.dispose();
		await expect(editor).not.toHaveAttribute('data-project-id', previous);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	});
}
