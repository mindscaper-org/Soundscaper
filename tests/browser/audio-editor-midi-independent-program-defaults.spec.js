/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../../src/common/editor/engine/midi-audio-renderer.ts';

test('independent imported instruments retain their own sound after sharing a lane and MIDI export', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	const note = { id: 'key', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 24000 };
	const file = (name, program) => ({ name: `${name}.mid`, mimeType: 'audio/midi', buffer: Buffer.from(writeMidiFile({ sampleRate: 48000, tempos: [], signatures: [], tracks: [{
		name, notes: [note], durationFrames: 96000, events: program === undefined ? [] : [{ frame: 0, status: 192, data: [program] },
			{ frame: 0, status: 176, data: [7, 30] }, { frame: 0, status: 176, data: [1, 127] }, { frame: 0, status: 176, data: [10, 0] }],
	}] })) });
	await importFiles(editor, [file('First patch', 40), file('Second default', undefined)]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	for (const name of ['First patch', 'Second default']) {
		await clipByName(editor, name).click();
		if (name === 'First patch') await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
		await editor.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	}
	const second = clipByName(editor, 'Second default');
	const properties = await openClipProperties(page, editor, second, { additional: false });
	await setClipTimeFrames(properties, 'startFrame', 192000); await closeClipProperties(properties);
	await second.click({ button: 'right', position: { x: 32, y: 10 } });
	const move = page.getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover(); await move.getByRole('menuitem').first().click();
	await expect(clipByName(editor, 'First patch').locator('xpath=ancestor::div[@data-track-row][1]').locator('[data-clip-id]')).toHaveCount(2);
	const native = await exportSamples(page, editor);
	expect(native.slice(192512, 216000).some(sample => Math.abs(sample) > .005)).toBe(true);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading, delivered = parseMidiFile(await downloadBytes(download), { sampleRate: 48000 });
	await download.delete();
	const track = delivered.tracks.find(value => value.notes.length); expect(track).toBeTruthy();
	const renderer = await openMidiAudioRenderer({ version: 1, notes: track.notes,
		interchange: { tempos: [], signatures: [], events: track.events ?? [] },
	}, 'fluidsynth', 48000);
	try {
		const output = (await renderer.render(0, 216000))[0];
		let error = 0; for (let frame = 192512; frame < 216000; frame++) error = Math.max(error, Math.abs(output[frame] - native[frame]));
		expect(error).toBeLessThan(.00001);
	} finally { await renderer.close(); }
});
