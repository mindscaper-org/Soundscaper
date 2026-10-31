/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Amplify keeps an edited gain draft while the current audio default is still being prepared', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__amplifyPreparedPcmReads = 0;
		const rendered = new WeakSet();
		const startRendering = OfflineAudioContext.prototype.startRendering;
		OfflineAudioContext.prototype.startRendering = async function (...args) {
			const buffer = await Reflect.apply(startRendering, this, args);
			rendered.add(buffer);
			return buffer;
		};
		const getChannelData = AudioBuffer.prototype.getChannelData;
		AudioBuffer.prototype.getChannelData = function (...args) {
			const channel = Reflect.apply(getChannelData, this, args);
			if (rendered.has(this)) globalThis.__amplifyPreparedPcmReads++;
			return channel;
		};
	});
	let release;
	const held = new Promise(resolve => { release = resolve; });
	let pending = 0;
	await page.route('**/staffpad-*.wasm', async route => { pending++; await held; await route.continue(); });
	try {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'Quiet.wav', duration: 1, frequency: 500, channelCount: 1 })]);
		const clip = editor.locator('[data-clip-id]').first();
		const properties = await openClipProperties(page, editor, clip, { additional: false });
		const pitch = properties.getByRole('textbox', { name: 'Pitch', exact: true });
		await pitch.fill('12'); await pitch.press('Enter');
		await closeClipProperties(properties);
		await clip.focus();
		await expect(clip).toBeFocused();
		await clip.press('Enter');
		await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
		const dialog = page.locator('[data-selection-effects-dialog]');
		const gain = dialog.locator('[data-effect-param="gainDb"]');
		const input = gain.locator('input[type="number"]');
		await expect.poll(() => pending).toBeGreaterThan(0);
		await input.fill('6');
		const pcmReads = await page.evaluate(() => globalThis.__amplifyPreparedPcmReads);
		release();
		// Observe the completed dry render reaching its PCM consumer, including
		// the engine's asynchronous worklet checks, before testing the late scan.
		await expect.poll(() => page.evaluate(() => globalThis.__amplifyPreparedPcmReads), { timeout: 30_000 }).toBeGreaterThan(pcmReads);
		const slider = gain.getByRole('slider');
		// The typed draft reserves the previous authored gain until blur.
		// A late headroom scan must not publish an automatic slider value.
		await expect(slider).toHaveValue('0');
		await expect(input).toHaveValue('6');
		await input.press('Tab');
		await expect(slider).toHaveValue('6');
	} finally { release(); }
});
