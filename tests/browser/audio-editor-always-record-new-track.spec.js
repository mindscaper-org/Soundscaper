/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const multitrack of [false, true]) test(`Always record to a new track persists and creates successive ${multitrack ? 'multi-track' : 'normal'} takes`, async ({ page }) => {
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
		globalThis.__newTrackRecordingChunks = 0;
		const NativeAudioWorkletNode = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeAudioWorkletNode {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				this.port.addEventListener('message', ({ data }) => {
					if (data.type === 'audio-chunk') globalThis.__newTrackRecordingChunks++;
				});
				this.port.start();
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const rows = editor.locator('[data-track-row]');
	let initialTracks = await rows.count();
	if (multitrack) {
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		const first = rows.first().locator('[data-recording-input-selectors]');
		await first.getByRole('combobox', { name: /^Track channels:/u }).selectOption('1');
		await first.getByRole('combobox', { name: /^Channel:/u }).selectOption('1');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		const second = rows.last();
		await second.getByRole('button', { name: /^Arm for recording:/u }).click();
		await second.getByRole('combobox', { name: /^Recording source:/u }).selectOption('device:default');
		await second.getByRole('combobox', { name: /^Track channels:/u }).selectOption('1');
		await second.getByRole('combobox', { name: /^Channel:/u }).selectOption('0');
		initialTracks++;
	}
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Playback\/Recording$/u }).click();
	const setting = preferences.getByRole('checkbox', { name: 'Always record to a new track', exact: true });
	await expect(setting).not.toBeChecked();
	await setting.check();
	await expect(setting).toBeChecked();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Playback\/Recording$/u }).click();
	await expect(setting).toBeChecked();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseTrackMenuAction(page, editor, rows.first(), 'Lock track');
	const record = editor.getByRole('button', { name: /^(?:Record to new track|Pause recording|Resume recording)$/u });
	for (let take = 1; take <= 2; take++) {
		const chunks = await page.evaluate(() => globalThis.__newTrackRecordingChunks);
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect(rows).toHaveCount(initialTracks + take * (multitrack ? 2 : 1));
		await expect.poll(() => page.evaluate(() => globalThis.__newTrackRecordingChunks)).toBeGreaterThan(chunks + 1);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', String(take * (multitrack ? 2 : 1)));
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		if (multitrack) {
			const channels = rows.locator('[data-recording-input-selectors]').getByRole('combobox', { name: /^Channel:/u });
			await expect(channels.nth(initialTracks + (take - 1) * 2)).toHaveValue('1');
			await expect(channels.nth(initialTracks + (take - 1) * 2 + 1)).toHaveValue('0');
		}
	}
});
