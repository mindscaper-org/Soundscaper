/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { installNativeInputPeer } from './helpers/native-input-peer.js';
import { NATIVE_OUTPUT_PEER_WEBKIT_REASON } from './helpers/native-output-peer.js';

test('selecting the WASAPI system default microphone can record again', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page, { backend: 'wasapi' });
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('wasapi');
	const microphone = setup.getByRole('combobox', { name: 'Microphone', exact: true });
	await expect(microphone).toHaveValue('native:wasapi:in:microphone');
	await expect(microphone).toBeEnabled();
	await microphone.selectOption('default');
	await expect(microphone).toBeEnabled();
	await page.keyboard.press('Escape');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(12_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

test('Record waits for the alternate WASAPI microphone assigned to its track', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page, { backend: 'wasapi' });
	await page.addInitScript(() => {
		const api = window.soundscaperDesktop.v1, describe = api.describeNativeAudioBackend, open = api.openNativeAudioSession;
		const admitted = new Promise(resolve => { window.__allowWASAPIPin = resolve; });
		api.describeNativeAudioBackend = async request => {
			const result = await describe(request);
			result.inventory.devices.push({ handle: 'alternate', label: 'Alternate WASAPI microphone', direction: 'input', channelCount: 2 });
			return result;
		};
		api.openNativeAudioSession = async request => {
			const deviceHandle = request.candidates[0].deviceHandle;
			if (deviceHandle === 'alternate') {
				window.__openingWASAPIPin = true;
				await admitted;
			}
			return { ...await open(request), deviceHandle };
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const settings = editor.getByRole('button', { name: 'Audio setup', exact: true });
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	const microphone = setup.getByRole('combobox', { name: 'Microphone', exact: true });
	await settings.click();
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('wasapi');
	await expect(microphone).toHaveValue('native:wasapi:in:microphone'); await expect(microphone).toBeEnabled();
	const speaker = await page.evaluate(async () => (await window.__nativeOutput.fence()).sessionId);
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	const row = editor.locator('[data-track-row]').first();
	const arm = row.getByRole('button', { name: /^Arm for recording:/u });
	if (await arm.getAttribute('aria-pressed') !== 'true') await arm.click();
	const source = row.getByRole('combobox', { name: /^Recording source:/u });
	await source.selectOption('device:native:wasapi:in:alternate');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect.poll(() => page.evaluate(() => window.__openingWASAPIPin)).toBe(true);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await page.evaluate(() => window.__allowWASAPIPin());
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(async () => Number(await editor.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow'))).toBeGreaterThan(12_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(source).toHaveValue('device:native:wasapi:in:alternate');
	await expect.poll(() => page.evaluate(() => window.__nativeInputPeer.requests.filter(request => request.direction === 'input')
		.map(request => request.candidates[0].deviceHandle))).toEqual(['microphone', 'alternate', 'microphone']);
	expect(await page.evaluate(async () => (await window.__nativeOutput.fence()).sessionId)).toBe(speaker);
	await settings.click();
	await expect(microphone).toHaveValue('native:wasapi:in:microphone');
});

test('ALSA can switch a shared PCM to stereo recording without reopening its speakers', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page);
	await page.addInitScript(() => {
		const api = window.soundscaperDesktop.v1, describe = api.describeNativeAudioBackend, open = api.openNativeAudioSession;
		api.describeNativeAudioBackend = async request => {
			const result = await describe(request);
			result.inventory.devices = [{ handle: 'default', label: 'Default PCM', direction: 'duplex' }];
			return result;
		};
		api.openNativeAudioSession = async request => {
			if (request.direction === 'duplex') return { status: 'refused', code: 'streaming-unavailable',
				message: 'ALSA uses separate capture and playback streams.', attempts: [] };
			return { ...await open(request), deviceHandle: request.candidates[0].deviceHandle };
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('radio', { name: 'Mono', exact: true }).check();
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toBeEnabled();
	const speakerSession = await page.evaluate(async () => (await window.__nativeOutput.fence()).sessionId);
	await setup.getByRole('radio', { name: 'Stereo', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__nativeInputPeer.requests.map(({ direction, channelCount }) => [direction, channelCount])))
		.toEqual([['input', 1], ['output', 2], ['input', 2]]);
	await expect(setup.getByRole('alert')).toHaveCount(0);
	expect(await page.evaluate(async () => (await window.__nativeOutput.fence()).sessionId)).toBe(speakerSession);
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Record onto the active track', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause recording', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(async () => Number(await editor.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow'))).toBeGreaterThan(12_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

test('ALSA direct hardware choices open for capture and playback', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page);
	const handle = 'hw:CARD=Studio,DEV=0';
	await page.addInitScript(handle => {
		const api = window.soundscaperDesktop.v1, describe = api.describeNativeAudioBackend, open = api.openNativeAudioSession;
		api.describeNativeAudioBackend = async request => {
			const result = await describe(request);
			result.inventory.devices = [{ handle: 'default', label: 'Default PCM', direction: 'duplex', isDefault: true },
				{ handle, label: 'Studio hardware', direction: 'duplex' }];
			return result;
		};
		api.openNativeAudioSession = async request => {
			const deviceHandle = request.candidates[0].deviceHandle;
			if (request.mode !== (deviceHandle === handle ? 'exclusive' : 'shared')) return { status: 'refused', code: 'format-refused',
				message: 'The backend granted a different format or mode than requested.', attempts: [] };
			return { ...await open(request), deviceHandle };
		};
	}, handle);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	const microphone = setup.getByRole('combobox', { name: 'Microphone', exact: true });
	const speakers = setup.getByRole('combobox', { name: 'Speakers', exact: true });
	const openedRequests = () => page.evaluate(() => window.__nativeInputPeer.requests.map(request => [request.direction, request.mode]));
	const inputRequests = [['input', 'shared'], ['output', 'shared'], ['input', 'exclusive']];
	await expect(microphone).toBeEnabled();
	await microphone.selectOption(`native:alsa:in:${handle}`);
	await expect.poll(openedRequests).toEqual(inputRequests);
	await expect(speakers).toBeEnabled();
	await expect(setup.getByRole('alert')).toHaveCount(0);
	await speakers.selectOption(`native:alsa:out:${handle}`);
	await expect.poll(openedRequests).toEqual([...inputRequests, ['output', 'exclusive']]);
	await expect(microphone).toBeEnabled();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Record onto the active track', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause recording', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(async () => Number(await editor.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow'))).toBeGreaterThan(12_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

test('a busy renderer still saves only captured audio when the native microphone disconnects', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page);
	await page.addInitScript(() => {
		const capture = window.__nativeCaptureTail = { frames: 0, silentFrames: 0 };
		window.AudioWorkletNode = new Proxy(AudioWorkletNode, {
			construct(target, argumentsList, newTarget) {
				const node = Reflect.construct(target, argumentsList, newTarget);
				if (argumentsList[1] === 'kw-audio-recorder') {
					node.port.addEventListener('message', ({ data }) => {
						if (data.type !== 'audio-chunk') return;
						capture.frames += data.frames;
						for (const sample of data.channels[0]) capture.silentFrames = sample === 0 ? capture.silentFrames + 1 : 0;
					});
				}
				return node;
			},
		});
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(12_000);
	await page.evaluate(() => {
		const input = window.__nativeInputPeer.requests.findLast(request => request.direction === 'input');
		window.__nativeInputPeer.loseDevice(input.sessionId);
		// Keep the renderer busy while the helper and worklets process the loss.
		const until = performance.now() + 120;
		while (performance.now() < until) { /* renderer work */ }
	});
	await expect(record).toHaveAttribute('aria-pressed', 'false');
	await expect(editor.locator('[data-clip-id^="recording-preview-"]')).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const captured = await page.evaluate(() => window.__nativeCaptureTail);
	expect(captured.frames).toBeGreaterThan(8_000);
	expect(captured.silentFrames).toBeLessThan(128);
});

test('first-time ASIO selects a connected driver and honors a later explicit selection', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page);
	await page.addInitScript(() => {
		const api = window.soundscaperDesktop.v1;
		const availability = api.nativeAudioHelperAvailability, open = api.openNativeAudioSession;
		const disconnected = 'Focusrite Thunderbolt ASIO', connected = 'Focusrite USB ASIO';
		window.__asioOpenHandles = [];
		api.nativeAudioHelperAvailability = async () => ({ ...await availability(), backends: ['asio'] });
		api.describeNativeAudioBackend = async ({ backend }) => ({
			status: 'described', inventory: { backend, status: 'available', detail: '', devices: [disconnected, connected]
				.flatMap(handle => ['input', 'output'].map(direction => ({ handle, direction, label: handle, isDefault: handle === disconnected }))) },
		});
		api.openNativeAudioSession = async request => {
			const { deviceHandle } = request.candidates[0];
			window.__asioOpenHandles.push(deviceHandle);
			if (deviceHandle === disconnected) return { status: 'refused', code: 'format-refused', message: 'The ASIO driver has no connected device.', attempts: [] };
			return { ...await open(request), backend: 'asio', deviceHandle };
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'ASIO separate playback.wav', sampleRate: 48_000,
		frequency: 440, duration: 20, channelCount: 1 })]);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('asio');
	const microphone = setup.getByRole('combobox', { name: 'Microphone', exact: true });
	const speakers = setup.getByRole('combobox', { name: 'Speakers', exact: true });
	await expect(microphone).toHaveValue('native:asio:in:Focusrite USB ASIO');
	await expect(speakers).toHaveValue('native:asio:out:Focusrite USB ASIO');
	await expect(microphone).toBeEnabled();
	await expect(setup.getByRole('alert')).toHaveCount(0);
	const first = await page.evaluate(() => [...window.__asioOpenHandles]);
	expect(first).toEqual(['Focusrite Thunderbolt ASIO', 'Focusrite USB ASIO', 'Focusrite USB ASIO']);
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => Math.max(0, ...window.__nativeOutput.channelRms))).toBeGreaterThan(.05);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const before = await page.evaluate(() => window.__nativeOutput.fence());
	await microphone.selectOption('native:asio:in:Focusrite Thunderbolt ASIO');
	await expect(setup.getByRole('alert')).toContainText('The selected audio device could not be opened');
	await expect(microphone).toHaveValue('native:asio:in:Focusrite Thunderbolt ASIO');
	await expect(speakers).toHaveValue('native:asio:out:Focusrite USB ASIO');
	expect(await page.evaluate(() => [...window.__asioOpenHandles])).toEqual([...first, 'Focusrite Thunderbolt ASIO']);
	await expect.poll(() => page.evaluate(async ({ packet, sessionId }) => {
		const after = await window.__nativeOutput.fence();
		return after.sessionId === sessionId && after.packet.startFrame > packet.endFrame && Math.max(...after.packet.peaks) > .05;
	}, before)).toBe(true);
	const beforeRefresh = await page.evaluate(() => window.__nativeOutput.fence());
	await setup.getByRole('button', { name: 'Refresh devices', exact: true }).click();
	await expect.poll(() => page.evaluate(() => [...window.__asioOpenHandles])).toEqual([...first, 'Focusrite Thunderbolt ASIO', 'Focusrite Thunderbolt ASIO']);
	await expect(setup.getByRole('alert')).toContainText('The selected audio device could not be opened');
	await expect.poll(() => page.evaluate(async ({ packet, sessionId }) => {
		const after = await window.__nativeOutput.fence();
		return after.sessionId === sessionId && after.packet.startFrame > packet.endFrame && Math.max(...after.packet.peaks) > .05;
	}, beforeRefresh)).toBe(true);
	await microphone.selectOption('native:asio:in:Focusrite USB ASIO');
	await expect(microphone).toBeEnabled();
	await expect(setup.getByRole('alert')).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => [...window.__asioOpenHandles])).toEqual([...first, 'Focusrite Thunderbolt ASIO', 'Focusrite Thunderbolt ASIO', 'Focusrite USB ASIO']);
	expect(await page.evaluate(() => window.__nativeOutput.sessionId)).toBe(before.sessionId);
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});

for (const [channel, stereo] of [['0', false], ['1', false], ['1', true], ['2', false]]) {
	test(`an explicit native Mono ${Number(channel) + 1} pin records with global ${stereo ? 'Stereo' : 'Mono'}`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
		await installNativeInputPeer(page);
		await page.addInitScript(() => {
			const api = window.soundscaperDesktop.v1, describe = api.describeNativeAudioBackend;
			api.describeNativeAudioBackend = async request => {
				const result = await describe(request);
				for (const device of result.inventory.devices) if (device.direction === 'input') device.channelCount = 4;
				return result;
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
		const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
		await expect(setup.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toBeEnabled();
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		const row = editor.locator('[data-track-row]').first();
		const arm = row.getByRole('button', { name: /^Arm for recording:/u });
		if (await arm.getAttribute('aria-pressed') !== 'true') await arm.click();
		await row.getByRole('combobox', { name: /^Recording source:/u }).selectOption('device:native:alsa:in:microphone');
		await row.getByRole('combobox', { name: /^Track channels:/u }).selectOption('1');
		const input = row.getByRole('combobox', { name: /^Channel:/u });
		await input.selectOption(channel); await expect(input).toHaveValue(channel);
		if (stereo) {
			await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
			await setup.getByRole('radio', { name: 'Stereo', exact: true }).check();
			await expect(setup.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toBeEnabled();
			await page.keyboard.press('Escape');
			await expect(input).toHaveValue(channel);
		}
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(record).toBeEnabled(); await record.click();
		try {
			await expect(record).toHaveAttribute('aria-pressed', 'true');
			await expect(row.locator('[data-clip-id^="recording-preview-"]')).toBeVisible();
			const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
			await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(12_000);
			await expect.poll(() => page.evaluate(() => window.__nativeInputPeer.requests.filter(request => request.direction === 'input').at(-1)?.channelCount)).toBe(Math.max(Number(channel) + 1, stereo ? 2 : 1));
			await expect(editor.getByRole('alert').filter({ hasText: /None of the assigned recording inputs are available/u })).toHaveCount(0);
		} finally { await editor.getByRole('button', { name: 'Stop', exact: true }).click(); }
		if (channel === '2') {
			await expect(record).toHaveAttribute('aria-pressed', 'false');
			await expect(row.getByRole('status', { name: 'Input status: Open', exact: true })).toBeVisible();
		}
	});
}
