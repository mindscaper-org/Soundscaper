/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { installNativeInputPeer } from './helpers/native-input-peer.js';
import { installNativeOutputPeer, NATIVE_OUTPUT_PEER_WEBKIT_REASON } from './helpers/native-output-peer.js';

test('Electron playback returns to the project clock after leaving a low-rate WASAPI route', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page, { backend: 'wasapi' });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Project clock.wav', sampleRate: 48_000,
		frequency: 8_000, duration: 4, channelCount: 1 })]);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	const host = setup.getByRole('combobox', { name: 'Host', exact: true });
	await host.selectOption('wasapi');
	const rate = setup.getByRole('combobox', { name: 'Recording sample rate', exact: true });
	await rate.selectOption('8000');
	await expect(rate).toHaveValue('8000');
	await expect(host).toBeEnabled();
	const playbackRate = () => page.evaluate(() => window.__nativeInputPeer.contexts.filter(context => context.state !== 'closed').at(-1)?.sampleRate);
	await expect.poll(playbackRate).toBe(8_000);
	await host.selectOption('electron');
	await expect(rate).toHaveCount(0);
	await expect(host).toBeEnabled();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	try {
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(playbackRate).toBe(48_000);
	} finally { await editor.getByRole('button', { name: 'Stop', exact: true }).click(); }
});

test('losing a separate native microphone leaves speaker playback running', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Separate input and output.wav', sampleRate: 48_000,
		frequency: 440, duration: 4, channelCount: 1 })]);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	try {
		await expect.poll(() => page.evaluate(() => Math.max(0, ...window.__nativeOutput.channelRms))).toBeGreaterThan(.05);
		const input = await page.evaluate(() => {
			const request = window.__nativeInputPeer.requests.find(value => value.direction === 'input');
			window.__nativeInputPeer.loseDevice(request.sessionId);
			return request.sessionId;
		});
		await expect.poll(() => page.evaluate(() => window.__nativeOutput.loss)).toEqual([{ sessionId: input, reason: 'device-loss' }]);
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		const fence = await page.evaluate(() => window.__nativeOutput.fence());
		await expect.poll(() => page.evaluate(({ packet, sessionId, periodFrames }) => window.__nativeOutput.packetHistory.some(next =>
			next.sessionId === sessionId && next.startFrame >= packet.endFrame + 8 * periodFrames && Math.max(...next.peaks) > .05), fence)).toBe(true);
	} finally { await editor.getByRole('button', { name: 'Stop', exact: true }).click(); }
});

test('native playback keeps the same device clock while paused and resumes audio', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeOutputPeer(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Pause and resume.wav', sampleRate: 48_000,
		frequency: 440, duration: 2, channelCount: 1 })]);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	const play = editor.getByRole('button', { name: 'Play', exact: true });
	await play.click();
	try {
		await expect.poll(() => page.evaluate(() => window.__nativeOutput.packetHistory.some(packet => Math.max(...packet.peaks) > .05)))
			.toBe(true);
		const sessionId = await page.evaluate(() => window.__nativeOutput.sessionId);
		const before = await page.evaluate(async () => (await window.__nativeOutput.fence()).packet.endFrame);
		await editor.getByRole('button', { name: 'Pause', exact: true }).click();
		await expect(play).toBeVisible();
		await expect.poll(() => page.evaluate(frame => window.__nativeOutput.packetHistory.filter(packet =>
			packet.startFrame >= frame && packet.peaks.every(peak => peak === 0)).length, before))
			.toBeGreaterThanOrEqual(16);
		const paused = await page.evaluate(async () => (await window.__nativeOutput.fence()).packet.endFrame);
		await play.click();
		await expect.poll(() => page.evaluate(frame => window.__nativeOutput.packetHistory.some(packet =>
			packet.startFrame >= frame && Math.max(...packet.peaks) > .05), paused)).toBe(true);
		expect(await page.evaluate(() => [window.__nativeOutput.sessionId, window.__nativeOutput.loss])).toEqual([sessionId, []]);
	} finally { await editor.getByRole('button', { name: 'Stop', exact: true }).click(); }
});

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
