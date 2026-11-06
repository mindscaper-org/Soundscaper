/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles,
	disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const locked of [false, true]) test(`Amplify preserves ${locked ? 'locked listening while disabling Apply' : 'ordinary unlocked Apply'}`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__effectLockPreview = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer) {
				const samples = this.buffer.getChannelData(0);
				let peak = 0;
				for (const value of samples) peak = Math.max(peak, Math.abs(value));
				globalThis.__effectLockPreview.push({ duration: this.buffer.duration, peak });
			}
			return Reflect.apply(start, this, args);
		};
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'amplify-target.wav', frequency: 440, duration: 1, channelCount: 1 });
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name), row = clip.locator('xpath=ancestor::div[@data-track-row]');
	await clip.locator('.clip-header').click();
	if (locked) await chooseTrackMenuAction(page, editor, row, 'Lock track');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const apply = dialog.getByRole('button', { name: 'Apply to selection', exact: true });
	if (locked) {
		await expect(apply).toBeDisabled();
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__effectLockPreview.at(-1)?.peak ?? 0)).toBeGreaterThan(.9);
		expect(await page.evaluate(() => globalThis.__effectLockPreview.at(-1).duration)).toBeCloseTo(1, 4);
		await expect(apply).toBeDisabled();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		const output = await exportSamples(page, editor);
		expect(Math.max(...output.map(Math.abs))).toBeCloseTo(.35 * Math.SQRT1_2, 4);
	} else {
		await expect(apply).toBeEnabled();
		await apply.click();
		await expect(dialog).toBeHidden();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		const output = await exportSamples(page, editor);
		expect(Math.max(...output.map(Math.abs))).toBeCloseTo(Math.SQRT1_2, 4);
	}
});
