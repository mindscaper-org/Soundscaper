/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { Download, Page } from 'playwright-core';

import { waveData, wavFixture } from '../../native/soundscaper-tracktion/tests/wave_fixture.ts';

type PlaybackWindow = Window & {
	tracktionTestAnalyser?: AnalyserNode;
	tracktionTestStarts?: number;
	tracktionTestCapture?: Int32Array;
	tracktionTestMicrophone?: MediaStreamTrack;
	tracktionTestCommands?: string[];
};

export async function verifyTracktionWebEditor(page: Page, origin: string, path = '/editor'): Promise<void> {
	const name = 'Tracktion browser project';
	const fileMenu = page.getByText('File', { exact: true });
	const button = (label: string) => page.getByRole('button', { name: label, exact: true });
	const commandsSince = (offset = 0) => page.evaluate((start) => (window as PlaybackWindow).tracktionTestCommands?.slice(start) ?? [], offset);
	async function fileCommand(label: string): Promise<void> {
		if (await fileMenu.locator('..').getAttribute('open') === null) await fileMenu.click();
		await button(label).click();
	}

	async function exportFile(label: string): Promise<Download> {
		try {
			const [download] = await Promise.all([page.waitForEvent('download'), fileCommand(label)]);
			return download;
		} catch (cause) {
			const busy = await page.locator('main').getAttribute('aria-busy');
			const details = await page.getByRole('alert').allTextContents();
			throw new Error(`${label} did not produce a download. Editor busy ${busy ?? 'unknown'}. ${details.join(' ')}`, { cause });
		}
	}
	await page.goto(new URL(path, origin).href);
	await page.evaluate(() => {
		const observed = window as PlaybackWindow;
		const commands: string[] = [];
		observed.tracktionTestCommands = commands;
		const post = Worker.prototype.postMessage;
		Worker.prototype.postMessage = {
			postMessage(this: Worker, message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
				const kind = (message as { request?: { kind?: unknown } } | null)?.request?.kind;
				if (typeof kind === 'string') commands.push(kind);
				Reflect.apply(post, this, options === undefined ? [message] : [message, options]);
			},
		}.postMessage;
		const devicePrototype = Object.getPrototypeOf(navigator.mediaDevices) as object;
		Object.defineProperty(devicePrototype, 'getUserMedia', {
			value: async () => {
				const context = new AudioContext({ sampleRate: 48_000 });
				const tone = context.createOscillator();
				const gain = context.createGain();
				gain.gain.value = 0.25;
				const destination = context.createMediaStreamDestination();
				tone.connect(gain).connect(destination);
				tone.start();
				await context.resume();
				const [microphone] = destination.stream.getAudioTracks();
				if (!microphone) throw new Error('The Tracktion microphone fixture could not produce a MediaStream');
				observed.tracktionTestMicrophone = microphone;
				const listen = microphone.addEventListener;
				microphone.addEventListener = (
					type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean,
				): void => {
					// Firefox requires wantsUntrusted for the fixture's synthetic ended event.
					Reflect.apply(listen, microphone, [type, listener, options, true]);
				};
				const stop = microphone.stop.bind(microphone);
				microphone.stop = () => {
					if (microphone.readyState === 'ended') return;
					stop();
					void context.close();
				};
				return destination.stream;
			},
		});
		class ObservedWorklet extends AudioWorkletNode {
			constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
				super(context, name, options);
				const analyser = context.createAnalyser();
				this.connect(analyser);
				const capture = (options?.processorOptions as { capture?: SharedArrayBuffer } | undefined)?.capture;
				if (capture) {
					observed.tracktionTestCapture = new Int32Array(capture, 0, 3);
					return;
				}
				observed.tracktionTestAnalyser = analyser;
				observed.tracktionTestStarts = (observed.tracktionTestStarts ?? 0) + 1;
			}
		}
		window.AudioWorkletNode = ObservedWorklet;
	});
	await page.getByRole('heading', { name: 'Soundscaper Tracktion' }).waitFor();
	const nameProject = page.waitForEvent('dialog').then((dialog) => dialog.accept(name));
	await Promise.all([nameProject, fileCommand('New project')]);
	await page.getByRole('heading', { name }).waitFor();
	const keepProject = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
	await Promise.all([keepProject, fileCommand('Close project')]);
	await page.getByRole('heading', { name }).waitFor();
	const editing = page.getByText('Editing tools', { exact: true });
	await editing.click();
	await button('Offline track effects').click();
	const effects = page.getByRole('dialog', { name: 'Offline track effects' });
	await effects.getByText('This track has no offline effects.').waitFor();
	assert.equal(await effects.getByRole('button', { name: 'Scan allowed plug-in folders' }).count(), 0);
	await effects.getByRole('button', { name: 'Close' }).click();
	const transport = page.getByText('Playback and recording', { exact: true });
	const recordingStatus = page.getByRole('status').filter({ hasText: /^Recording$/u });
	async function beginRecording(): Promise<void> {
		await page.evaluate(() => { (window as PlaybackWindow).tracktionTestCapture = undefined; });
		await transport.click();
		await button('Record onto the active track').click();
		try {
			await recordingStatus.waitFor({ timeout: 12_000 });
		} catch (cause) {
			throw new Error(`Tracktion microphone did not start. ${(await page.getByRole('alert').allTextContents()).join(' ')}`, { cause });
		}
		await page.waitForFunction(() => {
			const capture = (window as PlaybackWindow).tracktionTestCapture;
			return capture && Atomics.load(capture, 0) >= 8192;
		}, undefined, { timeout: 10_000 });
	}
	await beginRecording();
	await transport.click();
	await button('Stop').click();
	await page.getByText('1 clip', { exact: true }).waitFor();
	assert.equal(await page.evaluate(() => (window as PlaybackWindow).tracktionTestMicrophone?.readyState), 'ended');
	const take = await exportFile('Export mix (WAV)');
	verifyRecordedSignal(await readFile(await take.path()));
	await editing.click();
	await button('Undo').click();
	await page.getByText('0 clips', { exact: true }).waitFor();
	await editing.click();
	await button('Redo').click();
	await page.getByText('1 clip', { exact: true }).waitFor();
	await beginRecording();
	await transport.click();
	await button('Discard recording').click();
	await page.getByRole('status').filter({ hasText: 'Recording discarded' }).waitFor();
	await page.getByText('1 clip', { exact: true }).waitFor();
	assert.equal(await page.evaluate(() => (window as PlaybackWindow).tracktionTestMicrophone?.readyState), 'ended');
	await beginRecording();
	await page.evaluate(() => {
		const microphone = (window as PlaybackWindow).tracktionTestMicrophone;
		microphone?.dispatchEvent(new Event('ended'));
	});
	await page.getByRole('status').filter({ hasText: 'Recording added to the track' }).waitFor();
	await page.getByText('2 clips', { exact: true }).waitFor();
	assert.equal(await page.evaluate(() => (window as PlaybackWindow).tracktionTestMicrophone?.readyState), 'ended');
	await editing.click();
	await button('Undo').click();
	await page.getByText('1 clip', { exact: true }).waitFor();
	await editing.click();
	await button('Undo').click();
	await page.getByText('0 clips', { exact: true }).waitFor();
	await transport.click();
	await button('Jump to project start').click();
	await page.getByRole('status').filter({ hasText: 'Stopped' }).waitFor();

	const upload = page.waitForEvent('filechooser').then((chooser) => chooser.setFiles({
		name: 'Tracktion web media.wav', mimeType: 'audio/wav', buffer: wavFixture(96_000),
	}));
	await Promise.all([upload, fileCommand('Import audio')]);
	await page.getByText('Tracktion web media (0–96000)', { exact: true }).waitFor();
	await editing.click();
	await button('Mixer').click();
	const mixer = page.getByRole('dialog', { name: 'Mixer' });
	await mixer.getByRole('spinbutton', { name: /Gain/u }).fill('-6');
	await mixer.getByRole('spinbutton', { name: 'Pan' }).fill('0.5');
	await mixer.getByRole('checkbox', { name: 'Mute' }).check();
	await mixer.getByRole('checkbox', { name: 'Solo' }).check();
	const mixStart = (await commandsSince()).length;
	await mixer.getByRole('button', { name: 'Apply' }).click();
	await page.locator('main[aria-busy="false"]').waitFor();
	assert.deepEqual(await commandsSince(mixStart), ['setTrackMix', 'project']);
	await editing.click();
	await button('Mixer').click();
	assert.equal(await mixer.getByRole('spinbutton', { name: /Gain/u }).inputValue(), '-6');
	assert.equal(await mixer.getByRole('spinbutton', { name: 'Pan' }).inputValue(), '0.5');
	assert.equal(await mixer.getByRole('checkbox', { name: 'Mute' }).isChecked(), true);
	assert.equal(await mixer.getByRole('checkbox', { name: 'Solo' }).isChecked(), true);
	await mixer.getByRole('button', { name: 'Cancel' }).click();
	await editing.click();
	await button('Undo').click();

	await transport.click();
	await button('Play').click();
	try {
		await page.getByRole('status').filter({ hasText: 'Playing' }).waitFor({ timeout: 12_000 });
	} catch (cause) {
		const details = await page.getByRole('alert').allTextContents();
		throw new Error(`Tracktion browser playback did not start. ${details.join(' ')}`, { cause });
	}
	await page.waitForFunction(() => {
		const analyser = (window as PlaybackWindow).tracktionTestAnalyser;
		if (!analyser) return false;
		const samples = new Float32Array(analyser.fftSize);
		analyser.getFloatTimeDomainData(samples);
		return samples.some((sample) => Math.abs(sample) >= 0.025);
	}, undefined, { timeout: 5_000 });
	await transport.click();
	await button('Jump to project start').click();
	await page.waitForFunction(() => (window as PlaybackWindow).tracktionTestStarts === 2);
	await transport.click();
	await button('Stop').click();
	await page.getByRole('status').filter({ hasText: 'Stopped' }).waitFor();
	await editing.click();
	await button('Track automation').click();
	const automation = page.getByRole('dialog', { name: 'Track automation' });
	const point = automation.getByRole('combobox', { name: 'Automation point' });
	const frameField = automation.getByRole('spinbutton', { name: 'Frame' });
	const valueField = automation.getByRole('spinbutton', { name: 'Value' });
	const curveField = automation.getByRole('spinbutton', { name: /Curve to next point/u });
	await curveField.fill('1');
	const automationStart = (await commandsSince()).length;
	await automation.getByRole('button', { name: 'Add point' }).click();
	await point.getByRole('option', { name: '0 · 0.000', exact: true }).waitFor({ state: 'attached' });
	assert.deepEqual(await commandsSince(automationStart), ['setAutomationPoint', 'project', 'trackAutomation']);
	await frameField.fill('32768');
	await valueField.fill('-6');
	await automation.getByRole('button', { name: 'Add point' }).click();
	await point.selectOption({ label: '32768 · -6.000' });
	await valueField.fill('-12');
	await automation.getByRole('button', { name: 'Update point' }).click();
	await point.getByRole('option', { name: '32768 · -12.000', exact: true }).waitFor({ state: 'attached' });
	await automation.getByRole('button', { name: 'Close' }).click();
	const automatedDownload = page.waitForEvent('download');
	await fileCommand('Export mix (WAV)');
	const automatedPcm = waveData(await readFile(await (await automatedDownload).path()));
	assert.equal(automatedPcm.readInt16LE(4 * 4_096), 4096);
	assert.ok(Math.abs(automatedPcm.readInt16LE(4 * 48_000) - 1029) <= 2);
	await transport.click();
	await button('Jump to project start').click();
	await page.getByRole('status').filter({ hasText: 'Stopped' }).waitFor();
	await transport.click();
	await button('Play').click();
	await page.waitForFunction(() => (window as PlaybackWindow).tracktionTestStarts === 3);
	const peaks = await page.evaluate(async () => {
		const analyser = (window as PlaybackWindow).tracktionTestAnalyser;
		if (!analyser) throw new Error('Tracktion playback analyser is unavailable');
		const samples = new Float32Array(analyser.fftSize);
		const peaks: number[] = [];
		for (let poll = 0; poll < 120; poll += 1) {
			await new Promise(requestAnimationFrame);
			analyser.getFloatTimeDomainData(samples);
			peaks.push(samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0));
		}
		return peaks;
	});
	const peak = Math.max(...peaks);
	assert.ok(peak >= 0.025 && peaks.filter((sample) => sample > 0 && Math.abs(sample / peak - 0.2512) < 0.002).length >= 3,
		`Tracktion playback did not reach the -12 dB plateau. Observed peaks ${[...new Set(peaks)].join(', ')}`);
	await transport.click();
	await button('Stop').click();
	await page.getByRole('status').filter({ hasText: 'Stopped' }).waitFor();
	await editing.click();
	await button('Duplicate track').click();
	const track = page.getByRole('combobox', { name: 'Track', exact: true });
	const copiedTrack = track.getByRole('option', { name: / copy$/u });
	await copiedTrack.waitFor({ state: 'attached' });
	assert.equal(await track.inputValue(), await copiedTrack.getAttribute('value'));
	const duplicatePcm = waveData(await readFile(await (await exportFile('Export mix (WAV)')).path()));
	assert.equal(duplicatePcm.readInt16LE(4 * 4_096), 8192);
	assert.ok(Math.abs(duplicatePcm.readInt16LE(4 * 48_000) - 2058) <= 4);
	await editing.click();
	await button('Undo').click();
	await copiedTrack.waitFor({ state: 'detached' });
	await fileCommand('Save project');
	await page.getByRole('status').filter({ hasText: 'All changes saved locally' }).waitFor();
	const undonePcm = waveData(await readFile(await (await exportFile('Export mix (WAV)')).path()));
	assert.equal(undonePcm.readInt16LE(4 * 4_096), 4096);
	await editing.click();
	await button('Redo').click();
	await copiedTrack.waitFor({ state: 'attached' });
	await editing.click();
	await button('Undo').click();
	await copiedTrack.waitFor({ state: 'detached' });
	await editing.click();
	await button('Track automation').click();
	await automation.getByRole('button', { name: 'Clear curve' }).click();
	await point.getByRole('option', { name: '32768 · -12.000', exact: true }).waitFor({ state: 'detached' });
	await automation.getByRole('button', { name: 'Close' }).click();
	await editing.click();
	await button('Split clip').click();
	const split = page.getByRole('dialog', { name: 'Split clip' });
	await split.getByRole('spinbutton', { name: 'Split frame' }).fill('512');
	await split.getByRole('button', { name: 'Apply' }).click();
	await page.getByText('2 clips', { exact: true }).waitFor();
	await editing.click();
	await button('Undo').click();
	await page.getByText('1 clip', { exact: true }).waitFor();
	await editing.click();
	await button('Trim clip').click();
	const trim = page.getByRole('dialog', { name: 'Trim clip' });
	await trim.getByRole('spinbutton', { name: 'Start frame' }).fill('128');
	await trim.getByRole('spinbutton', { name: 'End frame' }).fill('896');
	await trim.getByRole('button', { name: 'Apply' }).click();
	const clip = page.getByText('Tracktion web media (128–896)', { exact: true });
	await clip.waitFor();
	await editing.click();
	await button('Add track').click();
	const list = page.getByRole('list', { name: 'Audio clips' });
	await page.getByText('0 clips', { exact: true }).waitFor();
	await track.selectOption({ index: 0 });
	await clip.waitFor();
	await editing.click();
	await button('Duplicate clip').click();
	const duplicate = page.getByRole('dialog', { name: 'Duplicate clip' });
	await duplicate.getByRole('spinbutton', { name: 'Start frame' }).fill('1200');
	await duplicate.getByRole('button', { name: 'Apply' }).click();
	await list.getByText('Tracktion web media (1200–1968)', { exact: true }).waitFor();
	await editing.click();
	await button('Move clip').click();
	const move = page.getByRole('dialog', { name: 'Move clip' });
	await move.getByRole('combobox', { name: 'Clip', exact: true }).selectOption({ label: 'Tracktion web media (1200–1968)' });
	await move.getByRole('combobox', { name: 'Destination track' }).selectOption({ label: 'Audio track 2' });
	await move.getByRole('spinbutton', { name: 'Start frame' }).fill('1600');
	await move.getByRole('button', { name: 'Apply' }).click();
	const placed = list.getByText('Tracktion web media (1600–2368)', { exact: true });
	await placed.waitFor();
	await editing.click();
	await button('Delete and leave gap').click();
	await page.getByRole('dialog', { name: 'Delete and leave gap' }).getByRole('button', { name: 'Apply' }).click();
	await page.getByText('0 clips', { exact: true }).waitFor();
	await editing.click();
	await button('Undo').click();
	await placed.waitFor();
	await editing.click();
	await button('Delete time range').click();
	const range = page.getByRole('dialog', { name: 'Delete time range' });
	await range.getByRole('spinbutton', { name: 'Start frame' }).fill('332');
	await range.getByRole('spinbutton', { name: 'End frame' }).fill('332');
	await range.getByRole('button', { name: 'Apply' }).click();
	await range.getByRole('alert').filter({ hasText: 'Enter a start frame before the end frame.' }).waitFor();
	await range.getByRole('spinbutton', { name: 'End frame' }).fill('333');
	await range.getByRole('combobox', { name: 'Delete mode' }).selectOption('allTracks');
	await range.getByRole('button', { name: 'Apply' }).click();
	const shifted = list.getByText('Tracktion web media (1599–2367)', { exact: true });
	await shifted.waitFor();
	await track.selectOption({ index: 0 });
	const left = list.getByText('Tracktion web media (128–332)', { exact: true });
	const right = list.getByText('Tracktion web media (332–895)', { exact: true });
	await left.waitFor();
	await right.waitFor();
	await editing.click();
	await button('Undo').click();
	await clip.waitFor();
	await editing.click();
	await button('Redo').click();
	await right.waitFor();
	await fileCommand('Save project');
	await page.getByRole('status').filter({ hasText: 'All changes saved locally' }).waitFor();
	await page.reload();
	await fileCommand('Open projects');
	await page.getByRole('dialog', { name: 'Local projects' }).getByRole('button', { name }).click();
	await right.waitFor();
	await track.selectOption({ label: 'Audio track 2' });
	await shifted.waitFor();
	const audio = await exportFile('Export mix (WAV)');
	assert.equal(audio.suggestedFilename().replaceAll('_', ' '), `${name}.wav`);
	const mix = waveData(await readFile(await audio.path()));
	assert.equal(mix.length, 2367 * 4);
	assert.equal(mix.readInt16LE(1598 * 4), 0);
	assert.deepEqual([mix.readInt16LE(1599 * 4), mix.readInt16LE(1599 * 4 + 2)], [4096, -2048]);
	const archive = await exportFile('Export project archive (ZIP)');
	assert.equal(archive.suggestedFilename().replaceAll('_', ' '), `${name}.zip`);
	const portable = await readFile(await archive.path());
	assert.equal(portable.readUInt32LE(0), 0x04034b50);
	const reopenArchive = page.waitForEvent('filechooser').then((chooser) => chooser.setFiles({
		name: 'Portable copy.zip', mimeType: 'application/zip', buffer: portable,
	}));
	await Promise.all([reopenArchive, fileCommand('Open project archive (ZIP)')]);
	await page.getByRole('heading', { name: 'Portable copy' }).waitFor();
	await right.waitFor();
	await track.selectOption({ label: 'Audio track 2' });
	await shifted.waitFor();

	await editing.click();
	await button('Copy').click();
	const copy = page.getByRole('dialog', { name: 'Copy' });
	await copy.getByRole('spinbutton', { name: 'Start frame' }).fill('0');
	await copy.getByRole('spinbutton', { name: 'End frame' }).fill('1');
	await copy.getByRole('button', { name: 'Apply' }).click();
	await page.getByRole('alert').filter({ hasText: 'The selected time range contains no audio' }).waitFor();
	assert.equal(await copy.isVisible(), true, 'a rejected copy leaves the range editor open');
	assert.equal(await copy.getByRole('alert').count(), 1);
	assert.equal(await copy.getByRole('spinbutton', { name: 'End frame' }).inputValue(), '1');
	await copy.getByRole('spinbutton', { name: 'Start frame' }).fill('1599');
	await copy.getByRole('spinbutton', { name: 'End frame' }).fill('1600');
	await copy.getByRole('button', { name: 'Apply' }).click();
	await copy.waitFor({ state: 'detached' });
	await shifted.waitFor();
	await editing.click();
	await button('Cut').click();
	const cut = page.getByRole('dialog', { name: 'Cut' });
	await cut.getByRole('spinbutton', { name: 'Start frame' }).fill('200');
	await cut.getByRole('spinbutton', { name: 'End frame' }).fill('1700');
	await cut.getByRole('combobox', { name: 'Cut mode' }).selectOption('allTracks');
	await cut.getByRole('button', { name: 'Apply' }).click();
	await list.getByText('Tracktion web media (200–867)', { exact: true }).waitFor();
	await fileCommand('Save project');
	await page.getByRole('status').filter({ hasText: 'All changes saved locally' }).waitFor();
	const nameDestination = page.waitForEvent('dialog').then((dialog) => dialog.accept('Clipboard destination'));
	await Promise.all([nameDestination, fileCommand('New project')]);
	await page.getByRole('heading', { name: 'Clipboard destination' }).waitFor();
	await editing.click();
	await button('Paste').click();
	const paste = page.getByRole('dialog', { name: 'Paste' });
	await paste.getByRole('spinbutton', { name: 'Start frame' }).fill('40');
	await paste.getByRole('button', { name: 'Apply' }).click();
	await list.getByText('Tracktion web media (40–172)', { exact: true }).waitFor();
	await list.getByText('Tracktion web media (172–735)', { exact: true }).waitFor();
	await track.selectOption({ label: 'Audio track 2' });
	await list.getByText('Tracktion web media (1439–1540)', { exact: true }).waitFor();
	const trackReturnStart = (await commandsSince()).length;
	await track.selectOption({ index: 0 });
	await list.getByText('Tracktion web media (40–172)', { exact: true }).waitFor();
	await track.selectOption({ label: 'Audio track 2' });
	await list.getByText('Tracktion web media (1439–1540)', { exact: true }).waitFor();
	assert.deepEqual(await commandsSince(trackReturnStart), []);
	const pasted = waveData(await readFile(await (await exportFile('Export mix (WAV)')).path()));
	assert.equal(pasted.length, 1540 * 4);
	assert.equal(pasted.readInt16LE(1438 * 4), 0);
	assert.equal(pasted.readInt16LE(1439 * 4), 4096);
	await transport.click();
	await button('Play').click();
	await page.getByRole('status').filter({ hasText: /^Playing$/u }).waitFor();
	await page.evaluate(() => new Promise<void>((resolve) => {
		requestAnimationFrame(() => { requestAnimationFrame(() => resolve()); });
	}));
	await editing.click();
	await button('Paste').click();
	assert.ok(Number(await paste.getByRole('spinbutton', { name: 'Start frame' }).inputValue()) > 0);
	await paste.getByRole('button', { name: 'Cancel' }).click();
	await transport.click();
	await button('Stop').click();
	await fileCommand('Save project');
	await page.getByRole('status').filter({ hasText: 'All changes saved locally' }).waitFor();
	await page.reload();
	await fileCommand('Open projects');
	await page.getByRole('dialog', { name: 'Local projects' }).getByRole('button', { name: 'Clipboard destination' }).click();
	await list.getByText('Tracktion web media (40–172)', { exact: true }).waitFor();
}


function verifyRecordedSignal(wave: Buffer): void {
	assert.equal(wave.subarray(0, 4).toString('ascii'), 'RIFF');
	let offset = 12;
	while (offset + 8 <= wave.length) {
		const kind = wave.subarray(offset, offset + 4).toString('ascii');
		const length = wave.readUInt32LE(offset + 4);
		offset += 8;
		if (kind === 'fmt ') assert.equal(wave.readUInt16LE(offset + 14), 16);
		if (kind === 'data') {
			assert.ok(length >= 8192 * 2 * 2);
			const pcm = wave.subarray(offset, offset + length);
			let peak = 0;
			for (let sample = 0; sample + 2 <= pcm.length; sample += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(sample)));
			assert.ok(peak > 3000 && peak < 10000, `the exported microphone tone peaked at ${peak}`);
			return;
		}
		offset += length + (length % 2);
	}
	assert.fail('Tracktion WAV export did not contain recorded samples');
}
