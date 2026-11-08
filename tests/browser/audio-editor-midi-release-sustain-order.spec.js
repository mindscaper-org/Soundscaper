/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function midiFile(order) {
	const on = [0, 144, 69, 100];
	const release = order === 'before'
		? [0x87, 0x40, 176, 64, 127, 0, 128, 69, 0]
		: [0x87, 0x40, 128, 69, 0, order === 'later' ? 1 : 0, 176, 64, 127];
	const track = [...on, ...release, 0x83, order === 'later' ? 0x5f : 0x60, 176, 64, 0, 0, 255, 47, 0];
	return { name: 'Key and pedal order.mid', mimeType: 'audio/midi', buffer: Buffer.from([
		77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, track.length, ...track,
	]) };
}

test('File Import refuses a same-tick late sustain press before creating a changed audible fallback', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [midiFile('after')]);
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText('sustain and key-release order');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});

for (const order of ['before', 'later']) test(`MIDI import retains its representable ${order} sustain behavior`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [midiFile(order)]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const pcm = await exportSamples(page, editor);
	const peak = pcm.slice(52_800, 60_000).reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
	if (order === 'before') expect(peak).toBeGreaterThan(0.05);
	else expect(peak).toBeLessThan(0.0001);
});
