/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { createOtioExport } from '../../src/common/editor/otio-export.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

function fixtures() {
	const { text } = createOtioExport({ sequenceRate: { num: 25, den: 1 }, project: {
		id: 'timeline', title: 'Interchange voice', sampleRate: 48_000,
		sources: [{ id: 'source', name: 'voice.wav', storageKey: 'voice.wav', kind: 'audio' }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', title: 'Phrase', timelineStartFrame: 24_000, durationFrames: 24_000, sourceStartFrame: 12_000 }],
		tracks: [{ id: 'voice', type: 'audio', name: 'Dialogue', clipIds: ['clip'] }],
	} });
	return [{ name: 'voice.otio', mimeType: 'application/json', buffer: Buffer.from(text) },
		{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(48_000).fill(.25)], { sampleRate: 48_000, float: true })) }];
}

test('shared Import binds OTIO media, Export Other downloads embedded OMF, and shared Open restores it', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await importFiles(editor, fixtures());
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OMF']);
	const download = await downloading;
	const bytes = Buffer.from(await downloadBytes(download));
	expect(download.suggestedFilename()).toBe('Interchange-voice.omf');
	const previousProject = await editor.getAttribute('data-project-id');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Restored.omf', mimeType: 'application/octet-stream', buffer: bytes });
	await expect(editor).not.toHaveAttribute('data-project-id', previousProject);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
	await download.delete();
	for (const [label, name, mimeType] of [['Export FCPXML', 'voice.fcpxml', 'application/xml'], ['Export edit list (EDL)', 'voice.edl', 'text/plain']]) {
		const exporting = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', label]);
		const saved = await exporting;
		const currentProject = await editor.getAttribute('data-project-id');
		await importFiles(editor, [{ name, mimeType, buffer: Buffer.from(await downloadBytes(saved)) }, fixtures()[1]]);
		await expect(editor).not.toHaveAttribute('data-project-id', currentProject);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
		await saved.delete();
	}
});

test('Framescaper binds selected OTIO camera media through its exact source clock', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/', { defaultWorkspace: true });
	const rationalTime = (value) => ({ OTIO_SCHEMA: 'RationalTime.1', value, rate: 25 });
	const text = JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: 'Camera edit', tracks: { OTIO_SCHEMA: 'Stack.1', children: [
		{ OTIO_SCHEMA: 'Track.1', kind: 'Video', name: 'Picture', children: [{ OTIO_SCHEMA: 'Clip.1', name: 'Camera',
			source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: rationalTime(0), duration: rationalTime(10) },
			media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'camera.webm' } }] },
	] } });
	await importFiles(editor, [{ name: 'camera.otio', mimeType: 'application/json', buffer: Buffer.from(text) }, createDeterministicAvFixture('camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Video clip:/u })).toHaveCount(1);
	const exporting = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	const download = await exporting;
	const otio = JSON.parse(Buffer.from(await downloadBytes(download)).toString('utf8'));
	expect(otio.tracks.children[0].children[0].media_reference.metadata['media.kw.soundscaper'].sourceName).toBe('camera.webm');
	await download.delete();
});
