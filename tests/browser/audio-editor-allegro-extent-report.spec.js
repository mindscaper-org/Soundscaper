/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { parseAllegroFile } from '../../src/common/editor/allegro-file.ts';

test('Allegro export discloses a retained MIDI rest through the existing Delivery Report', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [],
		tracks: [{ name: 'Long rest', durationFrames: 64_000, notes: [
			{ id: 'n', pitch: 60, velocity: 90, channel: 0, startFrame: 0, durationFrames: 4000 },
		] }] });
	await importFiles(editor, [{ name: 'Long rest.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) }]);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export Allegro (beta)']);
	const download = await downloading;
	try {
		const text = new TextDecoder().decode(await downloadBytes(download));
		expect(parseAllegroFile(text).tracks[0].notes).toHaveLength(1);
	} finally { await download.delete(); }
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).toBeVisible();
	await expect(report.locator('[data-severity="warning"]')).toContainText('cannot encode trailing track silence');
});
