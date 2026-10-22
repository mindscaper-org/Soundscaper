/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

for (const right of ['opposite', 'silent']) test(`pitch-preserving playback meters retain the ${right} right channel`, async ({ page }) => {
	const recording = createWavFixture({ name: 'opposite polarity stereo.wav', duration: 8, frequency: 440,
		channelCount: 2, channelAmplitudes: [.4, .4] });
	for (let offset = 44; offset < recording.buffer.length; offset += 4) {
		recording.buffer.writeInt16LE(right === 'opposite' ? -recording.buffer.readInt16LE(offset) : 0, offset + 2);
	}
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const meter = editor.locator('[data-playback-meter]').first().getByRole('meter');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(-20);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	const preserve = editor.getByRole('menuitem', { name: 'Preserve pitch', exact: true });
	if (await preserve.getAttribute('aria-checked') !== 'true') await preserve.click();
	await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill('0.5');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	await page.waitForTimeout(800);
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(-20);
	if (right === 'silent') {
		const fills = meter.locator('.kw-audio-editor__playback-meter-peak');
		await expect.poll(() => fills.nth(1).evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--playback-meter-peak')))).toBe(0);
	}
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
