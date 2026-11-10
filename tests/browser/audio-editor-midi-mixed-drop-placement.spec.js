/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
	fileDataTransfer, importFiles,
} from './audio-editor-test-helpers.js';
import { strFromU8, unzipSync } from 'fflate';

const bed = createWavFixture({ name: 'Bed.wav', frequency: 220, duration: 1 });
const first = createWavFixture({ name: 'First.wav', frequency: 440, duration: 1 });
const second = createWavFixture({ name: 'Second.wav', frequency: 880, duration: 1 });
const midi = {
	name: 'Notes.mid', mimeType: 'audio/midi',
	buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex'),
};

// Input-order variants retain real destination/PCM/store/Scape custody in audio-editor-midi-batch-import-archive-custody.test.ts.
for (const [arrangement, files] of [
	['interleaved MIDI', [first, midi, second]],
]) test(`dropping ${arrangement} preserves each WAV's track placement`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [bed]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const bedRow = editor.locator('[data-track-row]').filter({
		has: page.getByRole('group', { name: /^Bed\.wav clip(?:,|$)/u }),
	});
	const lane = bedRow.locator('.audio-editor-track-lane[data-track-lane]');
	const bounds = await lane.boundingBox();
	expect(bounds).not.toBeNull();
	const transfer = await fileDataTransfer(page, files);
	const position = {
		dataTransfer: transfer,
		clientX: bounds.x + Math.min(420, bounds.width - 24),
		clientY: bounds.y + bounds.height / 2,
	};
	await lane.dispatchEvent('dragover', position);
	await lane.dispatchEvent('drop', position);
	await transfer.dispose();
	await expect(editor).toHaveAttribute('data-clip-count', String(files.length + 1));
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(download))['project.json']));
	await download.delete();
	const sourceNames = new Map(project.sources.map(source => [source.id, source.name]));
	const savedClip = name => project.clips.find(clip => sourceNames.get(clip.sourceId) === name);
	const owner = name => project.tracks.find(track => track.clipIds.includes(savedClip(name).id));
	expect(owner(first.name).id).toBe(owner(bed.name).id);
	expect(owner(second.name).id).not.toBe(owner(first.name).id);
	expect(project.tracks.indexOf(owner(second.name))).toBe(project.tracks.indexOf(owner(first.name)) + 1);
	expect(savedClip(first.name).timelineStartFrame).toBeGreaterThan(0);
	expect(savedClip(second.name).timelineStartFrame).toBe(savedClip(first.name).timelineStartFrame);
});
