/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

for (const pending of [false, true]) {
	test(`sound activation records quiet input after the requested threshold commits (pending=${pending})`, async ({ page }) => {
		await page.addInitScript(() => {
			const heldTransactions = new WeakSet();
			const complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
			globalThis.__soundSettingCallbacks = [];
			globalThis.__soundSettingHold = false;
			globalThis.__soundSettingEntered = false;
			Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
				configurable: true,
				get() { return complete.get.call(this); },
				set(callback) {
					complete.set.call(this, function (event) {
						if (globalThis.__soundSettingHold && heldTransactions.has(this)) {
							globalThis.__soundSettingEntered = true;
							globalThis.__soundSettingCallbacks.push(() => callback?.call(this, event));
						} else callback?.call(this, event);
					});
				},
			});
			const put = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (value, ...args) {
				if (globalThis.__soundSettingHold && this.name === 'settings'
					&& value?.key === 'soundscaper:audio-editor-preferences-v1'
					&& value.value?.recording?.soundActivation?.thresholdDb === -40) heldTransactions.add(this.transaction);
				return Reflect.apply(put, this, [value, ...args]);
			};
			globalThis.__releaseSoundSetting = () => {
				globalThis.__soundSettingHold = false;
				for (const callback of globalThis.__soundSettingCallbacks.splice(0)) callback();
			};
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
				enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'fixture', label: 'Fixture mic' }],
				getUserMedia: async () => {
					const context = new AudioContext(), destination = context.createMediaStreamDestination();
					const oscillator = context.createOscillator(), gain = context.createGain();
					gain.gain.value = .02;
					oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
					globalThis.__activationInput = { context };
					const [track] = destination.stream.getAudioTracks(), settings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', { configurable: true,
						value: () => ({ ...settings(), channelCount: 1, sampleRate: context.sampleRate, latency: 0 }) });
					return destination.stream;
				},
			} });
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		const options = page.getByRole('dialog', { name: 'Record options', exact: true });
		await options.getByRole('button', { name: 'Sound activation', exact: true }).click();
		const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
		const panel = settings.locator('[data-sound-activation-settings]');
		const threshold = settings.getByRole('slider', { name: 'Activation threshold', exact: true });
		await threshold.fill('-10'); await expect(panel).toHaveAttribute('data-sound-activation-threshold-db', '-10');
		if (pending) await page.evaluate(() => { globalThis.__soundSettingHold = true; });
		await threshold.fill('-40');
		if (pending) await expect.poll(() => page.evaluate(() => globalThis.__soundSettingEntered)).toBe(true);
		else await expect(panel).toHaveAttribute('data-sound-activation-threshold-db', '-40');
		await page.keyboard.press('Escape'); await expect(settings).toBeHidden();
		await options.getByRole('button', { name: 'Sound-activated recording', exact: true }).click();
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		if (pending) {
			await expect.poll(() => page.evaluate(() => globalThis.__activationInput?.context.currentTime ?? 0)).toBeGreaterThan(.2);
			await expect(record).toHaveAttribute('aria-pressed', 'false');
			await page.evaluate(() => globalThis.__releaseSoundSetting());
		}
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const origin = await page.evaluate(() => globalThis.__activationInput.context.currentTime);
		await expect.poll(() => page.evaluate(() => globalThis.__activationInput.context.currentTime)).toBeGreaterThan(origin + .8);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		await expect(editor.locator('.clip-header')).toHaveCount(1);
	});
}
