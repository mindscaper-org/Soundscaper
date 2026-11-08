/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';

for (const scope of ['V2 ', '']) test(`Allegro ${scope || 'default V0 '}text refuses an unretained channel without changing the project`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Channel lyrics.gro', mimeType: 'text/plain',
		buffer: Buffer.from(`T0 -tempor:120\nT0 ${scope}-lyrics:"hello"\nT0 V2 K60 P60 U0.5 L90\n`) });
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText('Channel-scoped Allegro text');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await importFiles(editor, [{ name: 'Global lyrics.gro', mimeType: 'text/plain',
		buffer: Buffer.from('T0 -tempor:120\nT0 V- -lyrics:"hello"\nT0 V2 K60 P60 U0.5 L90\n') }]);
	const events = await deliveredEvents(page, editor);
	expect(events.filter(event => event.metaType === 5).map(event => new TextDecoder().decode(Uint8Array.from(event.data)))).toEqual(['hello']);
	expect(events.filter(event => event.metaType === 32)).toEqual([]);
});

test('the original raw MIDI channel-prefix file remains importable and exportable', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Scoped lyrics',
		notes: [{ id: 'n', channel: 2, pitch: 60, velocity: 90, startFrame: 0, durationFrames: 24_000 }],
		events: [{ frame: 0, status: 255, metaType: 32, data: [2] }, { frame: 0, status: 255, metaType: 5, data: [...new TextEncoder().encode('hello')] }] }] });
	await importFiles(editor, [{ name: 'Scoped lyrics.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) }]);
	const events = await deliveredEvents(page, editor);
	expect(events.filter(event => event.metaType === 32).map(event => event.data)).toEqual([[2]]);
});

async function deliveredEvents(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading; const bytes = await downloadBytes(download); await download.delete();
	return parseMidiFile(bytes, { sampleRate: 48_000 }).tracks.flatMap(track => track.events ?? []);
}
