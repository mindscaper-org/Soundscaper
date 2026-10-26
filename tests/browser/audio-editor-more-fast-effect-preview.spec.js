/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, commitInput, importFiles } from './audio-editor-test-helpers.js';

test('Change tempo previews six output seconds when a longer selection is sped up', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__fastEffectPreview = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer) globalThis.__fastEffectPreview.push(this.buffer.duration);
			return Reflect.apply(start, this, args);
		};
	});
	const recording = createWavFixture({ name: 'long tempo selection.wav', frequency: 440, duration: 18,
		channelCount: 1, channelAmplitudes: [.2] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change tempo']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.locator('[data-effect-param="tempoPercent"] input[type="number"]'), '100');
	await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__fastEffectPreview.at(-1)), { timeout: 20_000 }).toBeCloseTo(6, 3);
});
