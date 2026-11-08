/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { installNativeOutputPeer, NATIVE_OUTPUT_PEER_WEBKIT_REASON } from './helpers/native-output-peer.js';

for (const [rate, refresh] of [[2, false], [1, true], [2, true]]) {
	test(`native ${rate}x timeline playback retains its actual pitch through device refresh=${refresh}`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
		await installNativeOutputPeer(page, { measureFrequency: true });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'Native timeline440.wav', sampleRate: 48_000,
			frequency: 440, duration: 30, channelCount: 1 })]);
		await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
		const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
		await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
		await page.keyboard.press('Escape');
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		const preserve = editor.getByRole('menuitem', { name: 'Preserve pitch', exact: true });
		if (await preserve.getAttribute('aria-checked') === 'true') await preserve.click();
		await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill(String(rate));
		await page.keyboard.press('Escape');
		await editor.getByRole('button', { name: rate === 1 ? 'Play' : 'Play at speed', exact: true }).click();
		const frequency = () => page.evaluate(() => window.__nativeOutput.frequency || 0);
		await expect.poll(frequency).toBeGreaterThan(440 * rate - 30);
		await expect.poll(frequency).toBeLessThan(440 * rate + 30);
		try {
			if (refresh) {
				const previous = await page.evaluate(() => window.__nativeOutput.sessionId);
				await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
				const action = setup.getByRole('button', { name: 'Refresh devices', exact: true });
				await expect(action).toBeEnabled(); await action.click();
				await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
				await expect.poll(() => page.evaluate(() => window.__nativeOutput.sessionId)).not.toBe(previous);
				await page.keyboard.press('Escape');
			}
			await expect.poll(() => page.evaluate(() => Math.max(0, ...window.__nativeOutput.channelRms))).toBeGreaterThan(.05);
			await expect.poll(frequency).toBeGreaterThan(440 * rate - 30);
			await expect.poll(frequency).toBeLessThan(440 * rate + 30);
		} finally { await editor.getByRole('button', { name: 'Stop', exact: true }).click(); }
	});
}
