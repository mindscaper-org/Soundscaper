/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('an armed stereo recording retains two meter bars while an unarmed mono track is selected', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
			enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'stereo', label: 'Stereo microphone' }],
			async getUserMedia() {
				const context = new AudioContext({ sampleRate: 48_000 });
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				const merger = context.createChannelMerger(2);
				const destination = context.createMediaStreamDestination();
				oscillator.frequency.value = 440;
				gain.gain.value = .8;
				oscillator.connect(gain).connect(merger, 0, 0);
				merger.connect(destination); oscillator.start();
				await context.resume();
				return destination.stream;
			},
		} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	const rows = editor.locator('[data-track-row]');
	const first = rows.first();
	const armFirst = first.getByRole('button', { name: /^Arm for recording:/u });
	if (await armFirst.getAttribute('aria-pressed') !== 'true') await armFirst.click();
	await first.getByRole('combobox', { name: /^Recording source:/u }).selectOption('device:default');
	await first.getByRole('combobox', { name: /^Track channels:/u }).selectOption('2');
	await expect(first.getByRole('combobox', { name: /^Track channels:/u })).toHaveValue('2');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	const second = rows.last();
	const armSecond = second.getByRole('button', { name: /^Arm for recording:/u });
	if (await armSecond.getAttribute('aria-pressed') === 'true') await armSecond.click();
	await second.getByRole('combobox', { name: /^Recording source:/u }).selectOption('');
	await second.locator('[data-track-header]').click({ position: { x: 80, y: 22 } });
	await chooseCommandAction(page, editor, 'Window', 'Recording meter');
	const panel = editor.locator('[data-workspace-panel="recording-meter"]');
	if (!await panel.count()) await chooseCommandAction(page, editor, 'Window', 'Recording meter');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	try {
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect(first.locator('[data-clip-id^="recording-preview-"]')).toBeVisible();
		await expect(second.locator('[data-clip-id^="recording-preview-"]')).toHaveCount(0);
		const fills = panel.locator('.kw-audio-editor__playback-meter-peak');
		await expect(fills).toHaveCount(2);
		await expect.poll(() => fills.first().evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--playback-meter-peak')))).toBeGreaterThan(80);
		await expect.poll(() => fills.nth(1).evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--playback-meter-peak')))).toBe(0);
	} finally { await editor.getByRole('button', { name: 'Stop', exact: true }).click(); }
});
