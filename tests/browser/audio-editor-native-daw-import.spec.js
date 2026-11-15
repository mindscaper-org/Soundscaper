/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { ardourSession, soundcraftSession } from '../helpers/native-daw-import-fixtures.ts';
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
