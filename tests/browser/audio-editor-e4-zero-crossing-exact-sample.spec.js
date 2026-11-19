/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const offset of [0, 1]) test(`At zero crossings preserves exact source zeros from an edge offset of ${offset} samples`, async ({ page }) => {
	const samples = Float32Array.from({ length: 48_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * frame / 48));
	const wav = encodeWav([samples], { sampleRate: 48_000, bitDepth: 16, dither: false });
	const pcm = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	// 1 kHz at 48 kHz has exact integer-PCM zero samples every 24 frames.
	// Authenticate the actual file samples, independently of the crossing helper.
	for (const frame of [16_008, 32_016]) {
		expect(pcm.getInt16(44 + frame * 2, true)).toBe(0);
		expect(Math.abs(pcm.getInt16(44 + (frame + 1) * 2, true))).toBeGreaterThan(1_000);
	}
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Ordinary 1 kHz recording.wav', mimeType: 'audio/wav', buffer: Buffer.from(wav) }]);
	await setSampleSelection(page, editor, 16_008 + offset, 32_016 + offset);
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
	await expect.poll(() => selectedFrame(editor, 'start')).toBe(16_008);
	await expect.poll(() => selectedFrame(editor, 'end')).toBe(32_016);
	if (offset) {
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.poll(() => selectedFrame(editor, 'start')).toBe(16_009);
		await expect.poll(() => selectedFrame(editor, 'end')).toBe(32_017);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect.poll(() => selectedFrame(editor, 'start')).toBe(16_008);
		await expect.poll(() => selectedFrame(editor, 'end')).toBe(32_016);
	}
});

test('At zero crossings finds a WAV sign change exactly 10 ms outside each selection edge', async ({ page }) => {
	const samples = new Float32Array(48_000).fill(.5);
	samples.fill(-.25, 15_520, 32_480);
	const wav = encodeWav([samples], { sampleRate: 48_000, bitDepth: 16, dither: false });
	const pcm = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	for (const [frame, sign] of [[15_520, -1], [32_480, 1]]) {
		expect(Math.sign(pcm.getInt16(44 + (frame - 1) * 2, true))).toBe(-sign);
		expect(Math.sign(pcm.getInt16(44 + frame * 2, true))).toBe(sign);
	}
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'WAV with exact sign changes.wav', mimeType: 'audio/wav', buffer: Buffer.from(wav) }]);
	await setSampleSelection(page, editor, 16_000, 32_000);
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
	await expect.poll(() => Promise.all([selectedFrame(editor, 'start'), selectedFrame(editor, 'end')])).toEqual([15_520, 32_480]);
});

async function setSampleSelection(page, editor, start, end) {
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [edge, frame] of [['end', end], ['start', start]]) {
		const field = editor.getByRole('group', { name: `Selection ${edge}`, exact: true });
		await field.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		const digits = field.locator('.timecode-digit');
		await expect(digits).toHaveCount(12);
		await digits.first().click();
		await page.keyboard.type(String(frame).padStart(12, '0'));
		await page.keyboard.press('Enter');
		await expect.poll(() => selectedFrame(editor, edge)).toBe(frame);
	}
}

function selectedFrame(editor, edge) {
	return editor.getByRole('group', { name: `Selection ${edge}`, exact: true })
		.locator('.timecode-digit').allTextContents().then(digits => Number(digits.join('')));
}
