/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clipByName, clipField, closeClipProperties, commitInput,
	disableNativeSavePicker, downloadBytes, importFiles, openClipProperties,
} from './audio-editor-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';

// Whole/partial conductor variants retain real controller/store/Scape/MIDI delivery custody in audio-editor-midi-conductor-channel-custody.test.ts.
for (const [changes, length] of [[true, '4.25']]) {
	test(`looped MIDI restores its source conductor with changes=${changes} and length=${length}`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const bytes = writeMidiFile({ sampleRate: 48_000,
			tempos: [{ frame: 0, bpm: 120 }, ...(changes ? [{ frame: 24_000, bpm: 60 }] : [])],
			signatures: [{ frame: 0, numerator: 4, denominator: 4 },
				...(changes ? [{ frame: 24_000, numerator: 3, denominator: 4 }] : [])],
			tracks: [{ name: 'Meter loop', durationFrames: 96_000, notes: [
				{ id: 'a', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 12_000 },
				{ id: 'b', pitch: 64, channel: 0, velocity: 90, startFrame: 72_000, durationFrames: 12_000 },
			] }],
		});
		await importFiles(editor, [{ name: 'Meter loop.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) }]);
		const clip = clipByName(editor, 'Meter loop');
		await expect(clip).toBeVisible();
		await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		const properties = await openClipProperties(page, editor, clip);
		await commitInput(clipField(properties, 'durationFrame'), length);
		await expect(clipField(properties, 'durationFrame')).toHaveValue(length);
		await closeClipProperties(properties);
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
		const download = await downloading;
		const result = parseMidiFile(await downloadBytes(download));
		await download.delete();
		const frame = length === '4.25' ? 198_000 : 108_000;
		expect(result.tempos.filter(event => event.frame <= frame).at(-1)?.bpm).toBe(120);
		expect(result.signatures.filter(event => event.frame <= frame).at(-1)?.numerator).toBe(4);
	});
}
