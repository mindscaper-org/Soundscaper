/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test('switching input three between Mono and Stereo retains the selected hardware channel', async ({ page }) => {
	await installOscillatorMicrophone(page);
	await page.addInitScript(() => {
		const request = navigator.mediaDevices.getUserMedia;
		navigator.mediaDevices.getUserMedia = async function (...options) {
			const stream = await Reflect.apply(request, this, options);
			for (const track of stream.getAudioTracks()) {
				const settings = track.getSettings();
				Object.defineProperty(track, 'getSettings', { configurable: true, value: () => ({ ...settings, channelCount: 4 }) });
			}
			return stream;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	const controls = editor.locator('[data-track-row] [data-recording-input-selectors]').first();
	const source = controls.getByRole('combobox', { name: /^Recording source:/u });
	await source.selectOption('device:default');
	const width = controls.getByRole('combobox', { name: /^Track channels:/u });
	await width.selectOption('1');
	const channel = controls.getByRole('combobox', { name: /^Channel:/u });
	await channel.selectOption('2');
	await expect(channel).toHaveValue('2');
	await width.selectOption('2');
	await expect(channel).toHaveValue('2');
	await width.selectOption('1');
	await expect(channel).toHaveValue('2');
});
