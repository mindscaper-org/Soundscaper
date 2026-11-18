/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

const audio = createWavFixture({ name: 'timecode-program.wav', frequency: 330, duration: 12, channelCount: 1 });

async function openSync(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Tools', ['Timecode synchronization']);
	return page.getByRole('dialog', { name: 'Timecode synchronization', exact: true });
}
async function installMidi(page, { holdOutput = false, holdInputClose = false } = {}) {
	await page.addInitScript(({ holdOutput, holdInputClose }) => {
		const input = new EventTarget(), output = new EventTarget();
		const probe = { messages: [], requests: [], closed: 0, openingOutput: false, closingInput: false };
		let admitOutput = () => {};
		const outputAdmission = new Promise(resolve => { admitOutput = resolve; });
		if (!holdOutput) admitOutput();
		let releaseInput = () => {};
		const inputRetirement = new Promise(resolve => { releaseInput = resolve; });
		if (!holdInputClose) releaseInput();
		Object.assign(input, { id: 'tc-in', name: 'Timecode input', state: 'connected', connection: 'closed',
			open: async () => { input.connection = 'open'; return input; }, close: async () => {
				probe.closingInput = true;
				await inputRetirement;
				input.connection = 'closed'; probe.closed++; return input;
			} });
		Object.assign(output, { id: 'tc-out', name: 'Timecode output', state: 'connected', connection: 'closed',
			open: async () => {
				probe.openingOutput = true;
				await outputAdmission;
				output.connection = 'open';
				return output;
			}, close: async () => { output.connection = 'closed'; probe.closed++; return output; },
			send: (bytes, timestamp) => { probe.messages.push({ bytes, timestamp }); }, clear: () => {} });
		const access = Object.assign(new EventTarget(), { sysexEnabled: true, inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]) });
		Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async options => { probe.requests.push(options); return access; } });
		globalThis.__timecode = { probe, admitOutput, releaseInput,
			emit: bytes => {
				if (input.connection !== 'open') return;
				const event = new Event('midimessage');
				Object.assign(event, { data: Uint8Array.from(bytes) });
				input.dispatchEvent(event);
			} };
	}, { holdOutput, holdInputClose });
}

test('menu opt-in sends MTC through the selected port, survives closing its dialog, and releases on disable', async ({ page }) => {
	await installMidi(page);
	const timecodeChunks = [];
	page.on('request', request => {
		if (/\/assets\/editor-timecode-[^/]+\.js$/u.test(new URL(request.url()).pathname)) timecodeChunks.push(request.url());
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	await expect(editor.getByRole('button', { name: 'Timecode synchronization', exact: true })).toHaveCount(0);
	expect(timecodeChunks).toHaveLength(0);
	const dialog = await openSync(page, editor);
	await expect(dialog.getByRole('status')).toHaveText('Synchronization is off.');
	expect(timecodeChunks.length).toBeGreaterThan(0);
	expect(await page.evaluate(() => globalThis.__timecode.probe.requests)).toEqual([]);
	await dialog.getByRole('checkbox', { name: 'Send MTC', exact: true }).check();
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await dialog.getByLabel('MTC MIDI output', { exact: true }).selectOption('tc-out');
	await dialog.getByLabel('Timecode at timeline zero (seconds)').fill('3600');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Sending timecode with playback.');
	expect(await page.evaluate(() => globalThis.__timecode.probe.messages[0].bytes)).toEqual([240, 127, 127, 1, 1, 33, 0, 0, 0, 247]);
	await dialog.press('Escape');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__timecode.probe.messages.filter(message => message.bytes[0] === 241).length)).toBeGreaterThan(8);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await openSync(page, editor);
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Synchronization is off.');
	expect(await page.evaluate(() => globalThis.__timecode.probe.closed)).toBe(1);
});

test('MTC input locates, chases quarter frames, and pauses on signal loss', async ({ page }) => {
	await installMidi(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('mtc');
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await dialog.getByLabel('MTC MIDI input', { exact: true }).selectOption('tc-in');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Waiting for timecode.');
	await page.evaluate(() => globalThis.__timecode.emit([240, 127, 127, 1, 1, 32, 0, 2, 0, 247]));
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBe(96000);
	await page.evaluate(() => { for (const byte of [0, 16, 34, 48, 64, 80, 96, 114]) globalThis.__timecode.emit([241, byte]); });
	await expect(dialog.getByRole('status')).toHaveText('Receiving timecode.');
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(100000);
	await expect(dialog.getByRole('status')).toHaveText('Waiting for timecode.');
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
});

test('MTC receives a one-shot locate while the selected send port opens', async ({ page }) => {
	await installMidi(page, { holdOutput: true });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('mtc');
	await dialog.getByRole('checkbox', { name: 'Send MTC', exact: true }).check();
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await dialog.getByLabel('MTC MIDI input', { exact: true }).selectOption('tc-in');
	await dialog.getByLabel('MTC MIDI output', { exact: true }).selectOption('tc-out');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__timecode.probe.openingOutput)).toBe(true);
	await page.evaluate(() => globalThis.__timecode.emit([240, 127, 127, 1, 1, 32, 0, 2, 0, 247]));
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	await page.evaluate(() => globalThis.__timecode.admitOutput());
	await expect(playhead).toHaveAttribute('aria-valuenow', '96000');
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('disabling MTC pauses playback while the input port is still closing', async ({ page }) => {
	await installMidi(page, { holdInputClose: true });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('mtc');
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await dialog.getByLabel('MTC MIDI input', { exact: true }).selectOption('tc-in');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Waiting for timecode.');
	await page.evaluate(() => { for (const byte of [0, 16, 34, 48, 64, 80, 96, 114]) globalThis.__timecode.emit([241, byte]); });
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	try {
		await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__timecode.probe.closingInput)).toBe(true);
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(await page.evaluate(() => globalThis.__timecode.probe.closed)).toBe(0);
	} finally { await page.evaluate(() => globalThis.__timecode.releaseInput()); }
	await expect.poll(() => page.evaluate(() => globalThis.__timecode.probe.closed)).toBe(1);
});

test('reusing an MTC input waits for a canceled admission to release that port', async ({ page }) => {
	await installMidi(page, { holdOutput: true, holdInputClose: true });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	const receive = dialog.getByLabel('Receive timecode', { exact: true });
	const input = dialog.getByLabel('MTC MIDI input', { exact: true });
	const apply = dialog.getByRole('button', { name: 'Apply synchronization' });
	await receive.selectOption('mtc');
	await dialog.getByRole('checkbox', { name: 'Send MTC', exact: true }).check();
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await input.selectOption('tc-in');
	await dialog.getByLabel('MTC MIDI output', { exact: true }).selectOption('tc-out');
	await apply.click();
	await expect.poll(() => page.evaluate(() => globalThis.__timecode.probe.openingOutput)).toBe(true);
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__timecode.probe.closingInput)).toBe(true);
	await receive.selectOption('mtc');
	await input.selectOption('tc-in');
	await apply.click();
	try {
		await page.evaluate(() => globalThis.__timecode.releaseInput());
		await expect.poll(() => page.evaluate(() => globalThis.__timecode.probe.closed)).toBeGreaterThan(0);
		await expect(dialog.getByRole('status')).toHaveText('Waiting for timecode.');
		await page.evaluate(() => globalThis.__timecode.emit([240, 127, 127, 1, 1, 32, 0, 2, 0, 247]));
		await expect(editor.getByRole('slider', { name: 'Playhead', exact: true })).toHaveAttribute('aria-valuenow', '96000');
	} finally { await page.evaluate(() => globalThis.__timecode.admitOutput()); }
});

test('disabling synchronization dismisses a pending MIDI permission result', async ({ page }) => {
	await page.addInitScript(() => {
		const permission = { requested: false, deny: () => {} };
		Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: () => new Promise((_resolve, reject) => {
			permission.requested = true;
			permission.deny = () => reject(new DOMException('MIDI permission was denied.', 'NotAllowedError'));
		}) });
		globalThis.__midiPermission = permission;
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('mtc');
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__midiPermission.requested)).toBe(true);
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
	await expect(dialog.getByLabel('Receive timecode', { exact: true })).toHaveValue('off');
	await page.evaluate(async () => {
		globalThis.__midiPermission.deny();
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await expect(dialog.getByRole('status')).toHaveText('Synchronization is off.');
	await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('MTC receive locates timeline zero with a negative offset across midnight', async ({ page }) => {
	await installMidi(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('mtc');
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await dialog.getByLabel('MTC MIDI input', { exact: true }).selectOption('tc-in');
	await dialog.getByLabel('Timecode at timeline zero (seconds)').fill('-1');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Waiting for timecode.');
	await page.evaluate(() => globalThis.__timecode.emit([240, 127, 127, 1, 1, 55, 59, 59, 0, 247]));
	await expect(dialog.getByRole('status')).toHaveText('Receiving timecode.');
	await expect.poll(async () => Number(await editor.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow'))).toBe(0);
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
});

test('LTC uses the selected discrete output channel and stops its real audio worklet on disable', async ({ page }) => {
	await page.addInitScript(() => {
		const NativeNode = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeNode {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'scape-timecode-ltc') return;
				const splitter = context.createChannelSplitter(2), mute = context.createGain();
				mute.gain.value = 0;
				const meters = [context.createAnalyser(), context.createAnalyser()];
				this.connect(splitter);
				meters.forEach((meter, index) => { splitter.connect(meter, index); meter.connect(mute); });
				mute.connect(context.destination);
				globalThis.__ltcOutput = { context, peak: index => { const data = new Float32Array(2048); meters[index].getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); } };
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	const availableChannels = await page.evaluate(async () => { const context = new AudioContext(); const count = context.destination.maxChannelCount; await context.close(); return count; });
	await dialog.getByRole('checkbox', { name: 'Send LTC', exact: true }).check();
	await dialog.getByLabel('LTC output channel', { exact: true }).fill('2');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	if (availableChannels < 2) {
		await expect(dialog.getByRole('alert')).toHaveText('The selected LTC output channel is unavailable.');
		await expect(dialog.getByRole('status')).toHaveText('Synchronization is off.');
		return;
	}
	await expect(dialog.getByRole('status')).toHaveText('Sending timecode with playback.');
	await dialog.press('Escape');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__ltcOutput.peak(1))).toBeGreaterThan(0.2);
	expect(await page.evaluate(() => globalThis.__ltcOutput.peak(0))).toBe(0);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__ltcOutput.peak(1))).toBe(0);
	await openSync(page, editor);
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__ltcOutput.context.state)).toBe('closed');
});

test('LTC receives an independent biphase signal on channel two without input processing, then releases the microphone', async ({ page }) => {
	await page.addInitScript(() => {
		// Give the independent test-signal clock its own user gesture, as Safari requires.
		document.addEventListener('pointerdown', () => {
			const context = new AudioContext({ sampleRate: 48000 });
			globalThis.__ltcFixtureClock = { context, ready: context.resume() };
		}, { once: true });
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: async () => [], getUserMedia: async constraints => {
			const { context, ready } = globalThis.__ltcFixtureClock;
			await ready;
			const buffer = context.createBuffer(2, 96000, 48000), pcm = buffer.getChannelData(1);
			// Independent SMPTE vector source: 25 fps, starting at 00:00:02:00.
			let polarity = 0.25, previous = -1;
			for (let sample = 0; sample < pcm.length; sample++) {
				const half = Math.floor(sample / 12), frame = 50 + Math.floor(half / 160);
				const bits = Array(80).fill(0), fields = [frame % 25, Math.floor(frame / 25), 0, 0];
				[0, 16, 32, 48].forEach((start, index) => {
					for (let bit = 0; bit < 4; bit++) bits[start + bit] = ((fields[index] % 10) >> bit) & 1;
					for (let bit = 0; bit < 3; bit++) bits[start + 8 + bit] = (Math.floor(fields[index] / 10) >> bit) & 1;
				});
				bits.splice(64, 16, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1);
				bits[59] = bits.reduce((parity, value) => parity ^ value, 0);
				if (half !== previous && (half % 2 === 0 || bits[Math.floor(half / 2) % 80])) polarity = -polarity;
				pcm[sample] = polarity; previous = half;
			}
			const source = context.createBufferSource(), destination = context.createMediaStreamDestination();
			source.buffer = buffer; source.loop = true; source.connect(destination); source.start();
			globalThis.__ltcInput = { constraints, source, context, stream: destination.stream };
			return destination.stream;
		} } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('ltc');
	await dialog.getByLabel('LTC input channel', { exact: true }).fill('2');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Receiving timecode.');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(96000);
	expect(await page.evaluate(() => globalThis.__ltcInput.constraints.audio)).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } });
	await page.evaluate(() => globalThis.__ltcInput.source.stop());
	await expect(dialog.getByRole('status')).toHaveText('Waiting for timecode.');
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__ltcInput.stream.getTracks()[0].readyState)).toBe('ended');
	await page.evaluate(() => globalThis.__ltcInput.context.close());
});

test('disable cancels pending LTC device permission and stops a late microphone stream', async ({ page }) => {
	await page.addInitScript(() => {
		const NativeNode = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeNode {
			constructor(context, name, options) { super(context, name, options); if (name === 'scape-timecode-ltc') globalThis.__ltcPendingContext = context; }
		};
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
			enumerateDevices: async () => [],
			getUserMedia: () => new Promise(resolve => {
				globalThis.__ltcLateStream = globalThis.__ltcPendingContext.createMediaStreamDestination().stream;
				globalThis.__finishLtcPermission = () => resolve(globalThis.__ltcLateStream);
			}),
		} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('ltc');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect.poll(() => page.evaluate(() => typeof globalThis.__finishLtcPermission)).toBe('function');
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__ltcPendingContext.state)).toBe('closed');
	await page.evaluate(() => globalThis.__finishLtcPermission());
	await expect.poll(() => page.evaluate(() => globalThis.__ltcLateStream.getTracks()[0].readyState)).toBe('ended');
	await expect(dialog.getByRole('status')).toHaveText('Synchronization is off.');
	await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('MTC receive refuses a stopped transport whose chosen playback speed is not normal', async ({ page }) => {
	await installMidi(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [audio]);
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill('0.5');
	await page.keyboard.press('Escape');
	const dialog = await openSync(page, editor);
	await dialog.getByLabel('Receive timecode', { exact: true }).selectOption('mtc');
	await dialog.getByRole('button', { name: 'Connect MIDI devices' }).click();
	await dialog.getByLabel('MTC MIDI input', { exact: true }).selectOption('tc-in');
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect(dialog.getByRole('alert')).toContainText('normal playback');
	await expect(dialog.getByRole('status')).toHaveText('Synchronization is off.');
	await dialog.press('Escape');
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill('1');
	await page.keyboard.press('Escape');
	await openSync(page, editor);
	await dialog.getByRole('button', { name: 'Apply synchronization' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Waiting for timecode.');
	await dialog.getByRole('button', { name: 'Disable synchronization' }).click();
});
