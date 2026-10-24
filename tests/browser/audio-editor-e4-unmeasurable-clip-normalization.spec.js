/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting, readClipGain } from './audio-editor-clip-settings-test-helpers.js';

for (const [duration, amplitude, peakOnly] of [[.1, .25, false], [1, 0, false], [1, .25, false], [.1, .25, true]]) test(`${duration}s amplitude ${amplitude} ${peakOnly ? 'peak' : 'LUFS'} normalization reports whether measurement exists`, async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Recording.wav', duration, frequency: 1000, channelCount: 1, channelAmplitudes: [amplitude] });
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	expect(await readClipGain(properties)).toBe(0);
	await chooseClipMediaSetting(properties, peakOnly ? 'Normalize to −1 dBFS' : 'Normalize to −14 LUFS');
	if (!peakOnly && (duration < .4 || amplitude === 0)) {
		const toast = editor.locator('[data-editor-toast="workspace-error"]');
		await expect(toast.getByRole('alert')).toContainText('Loudness could not be measured');
		await toast.getByRole('button', { name: 'Close', exact: true }).click();
		expect(await readClipGain(properties)).toBe(0);
		if (amplitude > 0) {
			await chooseClipMediaSetting(properties, 'Normalize to −1 dBFS');
			await expect.poll(() => readClipGain(properties)).toBeGreaterThan(0);
		}
	} else {
		await expect.poll(() => readClipGain(properties)).toBeGreaterThan(0);
		await expect(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});
