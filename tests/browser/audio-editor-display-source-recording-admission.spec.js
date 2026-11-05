/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('display source selection observes the active recording lock in Preferences', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox', 'Firefox does not support display audio capture.');
	await page.addInitScript(() => {
		window.__displaySourceRequests = 0;
		Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
			window.__displaySourceRequests += 1;
			const context = new AudioContext();
			const oscillator = context.createOscillator();
			const destination = context.createMediaStreamDestination();
			oscillator.connect(destination);
			oscillator.start();
			await context.resume();
			const canvas = document.createElement('canvas');
			canvas.getContext('2d').fillRect(0, 0, 1, 1);
			destination.stream.addTrack(canvas.captureStream().getVideoTracks()[0]);
			return destination.stream;
		} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('display');
	await setup.getByRole('button', { name: 'Choose display source', exact: true }).click();
	await expect(setup.getByRole('button', { name: 'Choose a different display source', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	await expect(preferences.getByRole('combobox', { name: 'Microphone', exact: true })).toBeDisabled();
	await expect(preferences.getByRole('button', { name: 'Choose a different display source', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	await setup.getByRole('button', { name: 'Choose a different display source', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__displaySourceRequests)).toBe(2);
	await expect(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
});
