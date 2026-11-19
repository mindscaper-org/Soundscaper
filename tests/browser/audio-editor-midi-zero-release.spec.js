/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

// Both release clocks have exact PCM/archive custody in
// audio-editor-midi-expression-archive-custody.test.ts. Keep the native silent route.
for (const zero of [true]) test(`MIDI immediate key release remains silent through file delivery: zero=${zero}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	const name = zero ? 'Zero release' : 'Normal release';
	await importFiles(editor, [{ name: 'Release.mid', mimeType: 'audio/midi', buffer: Buffer.from(releaseFile(zero, name)) }]);
	await expect(clipByName(editor, name)).toBeVisible(); await expect(editor).toHaveAttribute('data-clip-count', '1');
	const before = peak(await exportSamples(page, editor));
	if (zero) expect(before).toBeLessThan(1e-5);
	else expect(before).toBeGreaterThan(.05);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading, delivered = await downloadBytes(download); await download.delete();
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await importFiles(editor, [{ name: 'Delivered.mid', mimeType: 'audio/midi', buffer: Buffer.from(delivered) }]);
	await expect(clipByName(editor, name)).toBeVisible(); await expect(editor).toHaveAttribute('data-clip-count', '1');
	const after = peak(await exportSamples(page, editor));
	if (zero) expect(after).toBeLessThan(1e-5);
	else expect(after).toBeCloseTo(before, 5);
});

function releaseFile(zero, name) {
	const text = [...new TextEncoder().encode(name)];
	const events = [0, 255, 81, 3, 0xe4, 0xe1, 0xc0, 0, 255, 3, text.length, ...text,
		0, 144, 60, 100, zero ? 0 : 1, 128, 60, 0, zero ? 16 : 15, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
}
