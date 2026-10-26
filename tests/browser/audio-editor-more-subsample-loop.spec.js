/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

test('a one-sample selected loop survives pitch-preserving double-speed playback', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__subsampleLoops = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer && this.loop) {
				globalThis.__subsampleLoops.push({ start: this.loopStart, end: this.loopEnd, offset: args[1] });
			}
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'single sample region.wav', duration: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [name, frame] of [['Selection end', 24_002], ['Selection start', 24_001]]) {
		const control = editor.getByRole('group', { name, exact: true });
		await control.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await control.locator('.timecode-digit').first().click();
		await page.keyboard.type(String(frame).padStart(12, '0'));
		await page.keyboard.press('Enter');
		await expect(control.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	const preserve = editor.getByRole('menuitem', { name: 'Preserve pitch', exact: true });
	if (await preserve.getAttribute('aria-checked') !== 'true') await preserve.click();
	await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill('2');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__subsampleLoops.length)).toBeGreaterThan(0);
	const loop = await page.evaluate(() => globalThis.__subsampleLoops.at(-1));
	expect(loop.end).toBeGreaterThan(loop.start);
	expect(loop.end - loop.start).toBeCloseTo(1 / 96_000, 10);
	expect(loop.offset).toBe(loop.start);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
