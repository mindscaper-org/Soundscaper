/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
for (const range of [false, true]) test(`Invert keeps unselected peer unchanged after track range=${range}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [
		createWavFixture({ name: 'Music.wav', frequency: 440, duration: 1, channelCount: 1, channelAmplitudes: [.2] }),
		createWavFixture({ name: 'Voice.wav', frequency: 880, duration: 1, channelCount: 1, channelAmplitudes: [.3] }),
	]);
	const before = await exportSamples(page, editor);
	await clipByName(editor, 'Music.wav').locator('.clip-header').click();
	if (range) await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText(/applied/iu);
	const after = await exportSamples(page, editor);
	expect(coefficient(after, 440) / coefficient(before, 440)).toBeCloseTo(-1, 3);
	expect(coefficient(after, 880) / coefficient(before, 880)).toBeCloseTo(1, 3);
});

function coefficient(values, frequency) {
	let sum = 0;
	for (let frame = 14400; frame < 33600; frame++) sum += values[frame] * Math.sin(2 * Math.PI * frequency * frame / 48000);
	return sum;
}
