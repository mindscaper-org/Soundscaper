/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, clickClipInterior, clipByName, disableNativeSavePicker, downloadBytes, fileDataTransfer, importFiles, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createAafExport } from '../../src/common/editor/aaf-export.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';
import { exchangeMidiBytes, midiAttachmentAaf, midiReferenceOtio } from '../helpers/interchange-midi-file-fixtures.ts';
import { persistedProject } from './helpers/complex-editing-workflows.js';

for (const [product, path] of [['Soundscaper', '/embed/en/'], ['Framescaper', '/framescaper/embed/en/']]) test(`${product}: ordinary Open, Import and drop open AAF; Export Other downloads an editable AAF`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, path, { defaultWorkspace: true });
	const wav = encodeWav([new Float32Array(48_000).fill(.25)], { sampleRate: 48_000, bitDepth: 24 });
	const result = createAafExport({ project: { title: 'AAF voice', sampleRate: 48_000,
		sources: [{ id: 's', name: 'Voice.wav', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 }],
		clips: [{ id: 'c', kind: 'audio', sourceId: 's', title: 'Phrase', timelineStartFrame: 24_000, durationFrames: 24_000, sourceStartFrame: 12_000 }],
		tracks: [{ id: 't', type: 'audio', name: 'Dialogue', clipIds: ['c'] }],
	}, media: new Map([['s', wav]]) });
	const fixture = { name: 'Voice.AAF', mimeType: 'application/octet-stream', buffer: Buffer.from(result.bytes) };
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles(fixture);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AAF']);
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('AAF-voice.aaf');
	const bytes = Buffer.from(await downloadBytes(download));
	let previous = await editor.getAttribute('data-project-id');
	await importFiles(editor, [{ ...fixture, buffer: bytes }]);
	await expect(editor).not.toHaveAttribute('data-project-id', previous);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	previous = await editor.getAttribute('data-project-id');
	const transfer = await fileDataTransfer(page, [{ ...fixture, buffer: bytes }]);
	const timeline = editor.getByRole('region', { name: 'Timeline', exact: true }).getByRole('region', { name: 'Timeline', exact: true });
	await timeline.dispatchEvent('dragover', { dataTransfer: transfer });
	await timeline.dispatchEvent('drop', { dataTransfer: transfer });
	await transfer.dispose();
	await expect(editor).not.toHaveAttribute('data-project-id', previous);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	await download.delete();
});

test('AAF embedded MIDI and OTIO linked MIDI open through File menus and remain editable after reload', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	for (const format of ['AAF', 'OTIO']) {
		const previousId = await editor.getAttribute('data-project-id');
		if (format === 'AAF') {
			const choosing = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Open');
			await (await choosing).setFiles({ name: 'Score.aaf', mimeType: 'application/octet-stream', buffer: Buffer.from(midiAttachmentAaf()) });
		} else await importFiles(editor, [
			{ name: 'Score.otio', mimeType: 'application/json', buffer: Buffer.from(midiReferenceOtio()) },
			{ name: 'Score.mid', mimeType: 'audio/midi', buffer: Buffer.from(exchangeMidiBytes()) },
		]);
		await expect(editor).not.toHaveAttribute('data-project-id', previousId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		const melody = () => format === 'AAF' ? clipByName(editor, 'Melody') : editor.getByRole('group', { name: /^Phrase clip,/u }).first();
		await clickClipInterior(page, melody());
		const notes = editor.getByRole('group', { name: 'Note editor', exact: true });
		if (!await notes.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
		await notes.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
		const pitch = notes.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
		await expect(pitch).toHaveValue('64'); await pitch.fill('67'); await pitch.press('Tab');
		const id = await editor.getAttribute('data-project-id');
		await expect.poll(async () => (await persistedProject(page, id)).clips.flatMap(clip => readMidiClip(clip)?.notes ?? [])[0]?.pitch).toBe(67);
		await page.reload({ waitUntil: 'domcontentloaded' });
		editor = await waitForEditor(page); await waitForProjectActivation(editor);
		await clickClipInterior(page, melody());
		const restored = editor.getByRole('group', { name: 'Note editor', exact: true });
		if (!await restored.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
		await restored.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
		await expect(restored.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('67');
	}
});
