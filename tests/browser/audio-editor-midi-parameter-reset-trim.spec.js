/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';

// The reset/trim matrix has portable controller custody in
// audio-editor-midi-chronology-archive-custody.test.ts; retain the actual trim UI.
for (const trim of [24000]) test(`RPN reset boundary through actual FileImport and source trim ${trim}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const setup = [[0, 101, 0], [0, 100, 0], [6000, 121, 0], [12000, 96, 0], [18000, 121, 0]];
	const bytes = writeMidiFile({ sampleRate: 48000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'RPN reset boundaries',
		events: setup.map(([frame, cc, value]) => ({ frame, status: 176, data: [cc, value] })),
		notes: [{ id: 'key', startFrame: 48000, durationFrames: 48000, pitch: 60, channel: 0, velocity: 100 }],
	}] });
	await importFiles(editor, [{ name: 'RPN reset boundaries.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) }]);
	if (trim) {
		const properties = await openClipProperties(page, editor, clipByName(editor, 'RPN reset boundaries'), { additional: false });
		await setClipTimeFrames(properties, 'sourceInFrame', trim); await closeClipProperties(properties);
	}
	const downloading = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading; const output = await downloadBytes(download); await download.delete();
	const controls = parseMidiFile(output, { sampleRate: 48000 }).tracks.flatMap(track => track.events ?? []).filter(event => event.status === 176).map(event => event.data);
	expect(controls).toEqual(setup.map(([, cc, value]) => [cc, value]));
});
