/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { installLiveOutputObserver } from './helpers/live-output-observer.js';

test.use({ browserCoverage: false, bypassCSP: true });

function longChord() {
	const events = [0, 0xff, 0x51, 3, 7, 0xa1, 0x20];
	for (let pitch = 48; pitch < 80; pitch++) events.push(0, 0x90, pitch, 70);
	let ticks = 3600 * 960;
	const delta = [ticks & 127];
	while ((ticks >>>= 7)) delta.unshift((ticks & 127) | 128);
	events.push(...delta, 0x80, 48, 0);
	for (let pitch = 49; pitch < 80; pitch++) events.push(0, 0x80, pitch, 0);
	events.push(0, 0xff, 0x2f, 0);
	const header = Buffer.from('4d546864000000060000000101e04d54726b00000000', 'hex');
	header.writeUInt32BE(events.length, header.length - 4);
	return { name: 'one-hour-chord.mid', mimeType: 'audio/midi', buffer: Buffer.concat([header, Buffer.from(events)]) };
}

test('long MIDI imports, edits and plays without waiting for a full PCM render', async ({ page }) => {
	await page.addInitScript(() => {
		const OriginalWorker = globalThis.Worker;
		globalThis.__midiDspStarts = 0;
		globalThis.Worker = class extends OriginalWorker {
			constructor(url, options) { super(url, options); if (options?.name === 'soundscaper-midi') globalThis.__midiDspStarts++; }
		};
	});
	await installLiveOutputObserver(page, '__midiOutput');
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longChord()]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const noteEditor = editor.getByRole('group', { name: 'Note editor', exact: true });
	await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const velocity = noteEditor.getByRole('spinbutton', { name: 'Velocity', exact: true });
	await velocity.fill('90'); await velocity.press('Enter');
	await expect(velocity).toHaveValue('90');
	expect(await page.evaluate(() => globalThis.__midiDspStarts)).toBe(0);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__midiOutput.some(block => block.peak > 0.001))).toBe(true);
	// Real input stays usable while the worker synthesizes a source far larger than RAM caches.
	await velocity.fill('80'); await velocity.press('Enter');
	await expect(velocity).toHaveValue('80');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});
