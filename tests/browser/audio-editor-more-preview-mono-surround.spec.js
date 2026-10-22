/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, importFiles } from './audio-editor-test-helpers.js';

test('mixed mono and surround Effect Preview leaves the extra output channels silent', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__wideEffectPreviews = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer?.numberOfChannels === 6) {
				globalThis.__wideEffectPreviews.push(Array.from({ length: 6 }, (_, channel) =>
					this.buffer.getChannelData(channel).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)));
			}
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'surround bed.wav', frequency: 440, duration: 1, channelCount: 6, channelAmplitudes: [0, 0, 0, 0, 0, 0] }),
		createWavFixture({ name: 'mono voice.wav', frequency: 440, duration: 1, channelCount: 1, channelAmplitudes: [.2] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.locator('[data-effect-param="gainDb"] input[type="number"]'), '0');
	await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__wideEffectPreviews.length)).toBe(1);
	const peaks = await page.evaluate(() => globalThis.__wideEffectPreviews[0]);
	expect(peaks[0]).toBeGreaterThan(.1); expect(peaks[1]).toBeGreaterThan(.1);
	expect(peaks.slice(2)).toEqual([0, 0, 0, 0]);
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
