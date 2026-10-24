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
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [edge, frame] of [['end', 32_016], ['start', 16_008]]) {
		const field = editor.getByRole('group', { name: `Selection ${edge}`, exact: true });
		await field.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		const digits = field.locator('.timecode-digit');
		await expect(digits).toHaveCount(12);
		await digits.first().click();
		await page.keyboard.type(String(frame + offset).padStart(12, '0'));
		await page.keyboard.press('Enter');
		await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(frame + offset);
	}
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
	const selectedFrame = edge => editor.getByRole('group', { name: `Selection ${edge}`, exact: true })
		.locator('.timecode-digit').allTextContents().then(digits => Number(digits.join('')));
	await expect.poll(() => selectedFrame('start')).toBe(16_008);
	await expect.poll(() => selectedFrame('end')).toBe(32_016);
	if (offset) {
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.poll(() => selectedFrame('start')).toBe(16_009);
		await expect.poll(() => selectedFrame('end')).toBe(32_017);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect.poll(() => selectedFrame('start')).toBe(16_008);
		await expect.poll(() => selectedFrame('end')).toBe(32_016);
	}
});
