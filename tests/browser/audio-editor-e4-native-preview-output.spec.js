/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { installNativeOutputPeer } from './helpers/native-output-peer.js';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const metronome of [false, true]) test(`native output retains programme PCM with metronome ${metronome}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native audio hosts run in the maintained Electron renderer (Chromium).');
	await installNativeOutputPeer(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Native programme.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(48_000 * 8).fill(.25)], { sampleRate: 48_000, float: true })) }]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	await preferences.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(preferences.getByRole('combobox', { name: 'Speakers', exact: true })).toContainText('Chosen native speakers');
	await expect(preferences.getByRole('alert')).toHaveCount(0);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	if (metronome) {
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
		await page.getByRole('dialog', { name: 'Customize toolbar', exact: true }).getByRole('checkbox', { name: 'Metronome', exact: true }).click();
		await page.keyboard.press('Escape');
	}
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__nativeOutput.mean)).toBeCloseTo(.25 / Math.sqrt(2), 5);
	if (metronome) await editor.getByRole('button', { name: 'Metronome', exact: true }).click();
	const sequence = await page.evaluate(() => window.__nativeOutput.packets);
	await expect.poll(() => page.evaluate(() => window.__nativeOutput.packets)).toBeGreaterThan(sequence + 200);
	await expect.poll(() => page.evaluate(() => window.__nativeOutput.mean)).toBeGreaterThan(.15);
	expect(await page.evaluate(() => window.__nativeOutput.loss)).toEqual([]);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
