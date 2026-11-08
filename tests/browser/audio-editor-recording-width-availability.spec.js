/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test('Stereo width is unavailable when its input bank belongs to another track', async ({ page }) => {
	await installStereoMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	const rows = editor.locator('[data-track-row]');
	const first = rows.first().locator('[data-recording-input-selectors]');
	const firstWidth = first.getByRole('combobox', { name: /^Track channels:/u });
	await first.getByRole('combobox', { name: /^Recording source:/u }).selectOption('device:default');
	await firstWidth.selectOption('2');
	await expect(firstWidth).toHaveValue('2');
	await firstWidth.selectOption('1');
	await first.getByRole('combobox', { name: /^Channel:/u }).selectOption('0');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	const second = rows.last().locator('[data-recording-input-selectors]');
	await second.getByRole('combobox', { name: /^Recording source:/u }).selectOption('device:default');
	await second.getByRole('combobox', { name: /^Channel:/u }).selectOption('1');
	await expect(second.getByRole('combobox', { name: /^Track channels:/u })).toHaveValue('1');
	const stereo = firstWidth.locator('option[value="2"]');
	await expect(stereo).toHaveJSProperty('disabled', true);
	await firstWidth.focus();
	await page.keyboard.press('ArrowDown');
	await expect(firstWidth).toHaveValue('1');
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
	await second.getByRole('combobox', { name: /^Recording source:/u }).selectOption('');
	await expect(stereo).toHaveJSProperty('disabled', false);
	await firstWidth.selectOption('2');
	await expect(firstWidth).toHaveValue('2');
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
});

test('Desktop input exposes its supported first channel and hardware retains Mono2', async ({ page }) => {
	await installStereoMicrophone(page);
	await page.addInitScript(() => {
		navigator.mediaDevices.getDisplayMedia = async () => {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
			stream.addTrack(canvas.captureStream(1).getVideoTracks()[0]);
			return stream;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	const controls = editor.locator('[data-track-row] [data-recording-input-selectors]').first();
	const source = controls.getByRole('combobox', { name: /^Recording source:/u });
	const width = controls.getByRole('combobox', { name: /^Track channels:/u });
	const channel = controls.getByRole('combobox', { name: /^Channel:/u });
	await source.selectOption('device:default');
	await width.selectOption('1');
	await channel.selectOption('1');
	await expect(channel).toHaveValue('1');
	await source.selectOption('display');
	await expect(source).toHaveValue('display');
	await expect(channel).toHaveValue('0');
	await expect(channel.getByRole('option')).toHaveCount(1);
	await expect(channel.getByRole('option')).toHaveText('Mono 1');
	await width.selectOption('2');
	await expect(width).toHaveValue('2');
	await expect(channel.getByRole('option')).toHaveCount(1);
	await expect(channel.getByRole('option')).toHaveText('Stereo 1–2');
	await width.selectOption('1');
	await channel.focus();
	await page.keyboard.press('ArrowDown');
	await expect(channel).toHaveValue('0');
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
});

async function installStereoMicrophone(page) {
	await installOscillatorMicrophone(page);
	await page.addInitScript(() => {
		const request = navigator.mediaDevices.getUserMedia;
		navigator.mediaDevices.getUserMedia = async function (...options) {
			const stream = await Reflect.apply(request, this, options);
			for (const track of stream.getAudioTracks()) {
				const settings = track.getSettings();
				Object.defineProperty(track, 'getSettings', { configurable: true, value: () => ({ ...settings, channelCount: 2 }) });
			}
			return stream;
		};
	});
}
