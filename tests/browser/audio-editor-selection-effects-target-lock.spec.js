/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles,
	disableNativeSavePicker, openNestedCommandMenu } from './audio-editor-test-helpers.js';
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
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const file = createWavFixture({ name: 'amplify-target.wav', frequency: 440, duration: 1, channelCount: 1 });
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name), row = clip.locator('xpath=ancestor::div[@data-track-row]');
	await clip.locator('.clip-header').click();
	if (locked) await chooseTrackMenuAction(page, editor, row, 'Lock track');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const gain = dialog.getByRole('spinbutton', { name: 'Amplification (dB)', exact: true });
	await expect.poll(async () => Number(await gain.inputValue())).toBeCloseTo(9.12, 2);
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

for (const locked of [false, true]) test(`direct Invert ${locked ? 'declines a locked target while retaining settings dialogs' : 'applies to the ordinary unlocked target'}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const file = createWavFixture({ name: 'invert-target.wav', frequency: 440, duration: 1, channelCount: 1 });
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name), row = clip.locator('xpath=ancestor::div[@data-track-row]');
	await clip.locator('.clip-header').click();
	if (locked) {
		await chooseTrackMenuAction(page, editor, row, 'Lock track');
		const menu = await openNestedCommandMenu(page, editor, 'Effect', ['Special']);
		await expect(menu.getByRole('menuitem', { name: /^Invert(?:\s|$)/u })).toBeDisabled();
		await expect(menu.getByRole('menuitem', { name: /^Reverse(?:\s|$)/u })).toBeDisabled();
		await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await expect(dialog.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
		await expect(dialog.getByRole('button', { name: 'Apply to selection', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await chooseTrackMenuAction(page, editor, row, 'Unlock track');
	}
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	const output = await exportSamples(page, editor);
	expect(output[100]).toBeCloseTo(.175 * Math.SQRT1_2, 4);
});
