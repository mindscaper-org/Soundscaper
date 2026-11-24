/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { Download, Page } from 'playwright-core';

import { wavFixture } from '../../native/soundscaper-tracktion/tests/wave_fixture.ts';

type PlaybackWindow = Window & {
	tracktionTestAnalyser?: AnalyserNode;
	tracktionTestStarts?: number;
	tracktionTestCapture?: Int32Array;
	tracktionTestMicrophone?: MediaStreamTrack;
};

export async function verifyTracktionWebEditor(page: Page, origin: string): Promise<void> {
	const name = 'Tracktion browser project';
	const fileMenu = page.getByText('File', { exact: true });
	const button = (label: string) => page.getByRole('button', { name: label, exact: true });
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
	await page.goto(`${origin}/editor`);
	await page.evaluate(() => {
		const observed = window as PlaybackWindow;
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
	await mixer.getByRole('button', { name: 'Apply' }).click();
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
	await fileCommand('Save project');
	await page.getByRole('status').filter({ hasText: 'All changes saved locally' }).waitFor();
	await page.reload();
	await fileCommand('Open projects');
	await page.getByRole('dialog', { name: 'Local projects' }).getByRole('button', { name }).click();
	await clip.waitFor();
	const audio = await exportFile('Export mix (WAV)');
	assert.equal(audio.suggestedFilename().replaceAll('_', ' '), `${name}.wav`);
	assert.equal((await readFile(await audio.path())).subarray(0, 4).toString('ascii'), 'RIFF');
	const archive = await exportFile('Export project archive (ZIP)');
	assert.equal(archive.suggestedFilename().replaceAll('_', ' '), `${name}.zip`);
	const portable = await readFile(await archive.path());
	assert.equal(portable.readUInt32LE(0), 0x04034b50);
	const reopenArchive = page.waitForEvent('filechooser').then((chooser) => chooser.setFiles({
		name: 'Portable copy.zip', mimeType: 'application/zip', buffer: portable,
	}));
	await Promise.all([reopenArchive, fileCommand('Open project archive (ZIP)')]);
	await page.getByRole('heading', { name: 'Portable copy' }).waitFor();
	await clip.waitFor();
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
