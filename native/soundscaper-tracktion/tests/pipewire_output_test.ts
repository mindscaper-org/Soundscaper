/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import type { TracktionTransportView } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { removePipeWireFixtureSink, restorePipeWireFixtureSink } from './pipewire_fixture.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

test('Tracktion sustains PipeWire playback and can restart from the stopped playhead', {
	skip: process.platform !== 'linux' || process.env.SOUNDSCAPER_TRACKTION_TEST_PIPEWIRE_OUTPUT !== '1',
}, async () => {
	const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
	assert.ok(executable, 'build the Tracktion peer first');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-pipewire-playback-'));
	const exchangeDirectory = join(root, 'exchange');
	const options = { executable, exchangeDirectory, projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') };
	const asset = 'a'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(8 * 48_000));
		const creator = launchTracktionPeer({ ...options, mode: 'create', sampleRate: 48_000 });
		try {
			const [track] = (await creator.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track, 'the project has an audio track');
			await creator.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Sustained output', start: 0 });
			await creator.request({ kind: 'save', revision: 1 });
		} finally {
			await creator.close();
		}
		const peer = launchTracktionPeer({ ...options, mode: 'open' });
		const monitor = spawn('pw-record', ['--target', 'tracktion.test.speakers', '--properties', '{"stream.capture.sink":true}',
			'--rate', '48000', '--channels', '2', '--format', 'f32', '--latency', '256', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
		const monitorClosed = new Promise<void>((resolve) => { monitor.once('close', () => resolve()); });
		let frames = 0;
		let partial: Buffer = Buffer.alloc(0);
		monitor.stdout.on('data', (samples: Buffer) => {
			const data = partial.length ? Buffer.concat([partial, samples]) : samples;
			const completeBytes = data.length - data.length % 8;
			for (let offset = 0; offset < completeBytes; offset += 8)
				if (data.readFloatLE(offset) > 0.02) frames += 1;
			partial = data.subarray(completeBytes);
		});
		try {
			const { hosts } = await peer.request({ kind: 'audioHosts' });
			const host = hosts.find(({ name }) => name === 'PipeWire');
			assert.ok(host, 'the fixture exposes the PipeWire host');
			const status = () => peer.request({ kind: 'transportStatus' });
			for (const blockSize of [256, 512]) {
				await peer.request({ kind: 'setAudioSetup', hostId: host.id, inputId: '', outputId: '',
					inputChannel: 0, outputChannel: 0, sampleRate: 48_000, blockSize });
				await peer.request({ kind: 'prepareOutput' });
				await waitForTransport(status, (snapshot) => snapshot.ready);
				assert.equal((await peer.request({ kind: 'seek', frame: 0 })).frame, 0);
				assert.equal((await peer.request({ kind: 'play', frame: 0 })).playing, true);
				await waitForTransport(status, (snapshot) => snapshot.playing && snapshot.frame >= 24_000);
				const before = frames;
				// Cross the old four-second MIDI scan interval on a fresh route.
				await waitForTransport(status, (snapshot) => snapshot.playing && snapshot.frame >= 216_000, 6_000);
				assert.ok(frames - before > 153_600, `the ${blockSize}-frame stream carries sustained audio`);
				const stopped = await peer.request({ kind: 'stop' });
				assert.equal(stopped.playing, false);
				if (blockSize === 256) await verifyProjectMediaReadiness(peer, options.projectDirectory);
				await peer.request({ kind: 'prepareOutput' });
				await waitForTransport(status, (snapshot) => snapshot.ready);
				const beforeRestart = frames;
				assert.equal((await peer.request({ kind: 'play', frame: stopped.frame })).playing, true);
				await waitForTransport(status, (snapshot) => snapshot.playing && snapshot.frame >= stopped.frame + 8_192);
				assert.ok(frames - beforeRestart > 4_096, 'audio resumes from the stopped playhead');
				await peer.request({ kind: 'stop' });
			}
		} finally {
			monitor.kill('SIGTERM');
			await monitorClosed;
			await peer.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

async function verifyProjectMediaReadiness(peer: ReturnType<typeof launchTracktionPeer>, projectDirectory: string): Promise<void> {
	const media = join(projectDirectory, 'media');
	const [name] = await readdir(media);
	assert.ok(name);
	const file = join(media, name);
	const moved = `${file}.moved`;
	const status = () => peer.request({ kind: 'transportStatus' });
	await rename(file, moved);
	assert.equal((await status()).ready, false, 'readiness notices a missing cached source');
	await symlink(moved, file);
	assert.equal((await status()).ready, false, 'readiness refuses a symlink in place of the cached source');
	assert.equal((await peer.request({ kind: 'play', frame: 0 })).playing, false);
	await unlink(file);
	await rename(moved, file);
	await waitForTransport(status, (snapshot) => snapshot.ready);

	const movedMedia = `${media}.moved`;
	await rename(media, movedMedia);
	await symlink(movedMedia, media, 'dir');
	assert.equal((await status()).ready, false, 'readiness refuses a substituted project media directory');
	await unlink(media);
	await rename(movedMedia, media);
	await waitForTransport(status, (snapshot) => snapshot.ready);
}

test('Tracktion keeps capture and playback independent when the named PipeWire sink disappears', {
	skip: process.platform !== 'linux' || process.env.SOUNDSCAPER_TRACKTION_TEST_PIPEWIRE_OUTPUT !== '1',
}, async () => {
	const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
	assert.ok(executable, 'build the Tracktion peer first');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-pipewire-output-'));
	try {
		const exchangeDirectory = join(root, 'exchange');
		await mkdir(join(exchangeDirectory, 'output'), { recursive: true });
		const peer = launchTracktionPeer({
			executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings'),
		});
		try {
			const status = () => peer.request({ kind: 'transportStatus' });
			const { hosts } = await peer.request({ kind: 'audioHosts' });
			const host = hosts.find(({ name }) => name === 'PipeWire');
			assert.ok(host);
			const devices = await peer.request({ kind: 'audioDevices', hostId: host.id });
			const output = devices.outputs.find(({ name }) => name === 'tracktion.test.speakers');
			const input = devices.inputs.find(({ name }) => name === 'tracktion.test.microphone');
			assert.ok(output && input);
			const setup = { hostId: host.id, inputId: input.id, outputId: output.id, inputChannel: 0,
				outputChannel: 0, sampleRate: 48_000, blockSize: 256 };
			const applied = await peer.request({ kind: 'setAudioSetup', ...setup });
			const track = (await peer.request({ kind: 'project', offset: 0 })).tracks[0];
			assert.ok(track);
			assert.equal((await peer.request({ kind: 'startRecording', revision: 0, trackId: track.id, frame: 0 })).recording, true);
			const beforeLoss = await waitForTransport(status, (snapshot) => snapshot.recording && snapshot.frame > 4096);
			removePipeWireFixtureSink();
			const duringLoss = await waitForTransport(status, (snapshot) => snapshot.outputInterrupted === true
				&& snapshot.frame > beforeLoss.frame + 4096);
			assert.equal(duringLoss.recording, true);
			assert.equal(duringLoss.ready, false);
			const take = await peer.request({ kind: 'finishRecording', revision: 0, discard: false });
			assert.ok(take.itemId, 'finishing after sink loss still publishes real input');
			assert.equal((await peer.request({ kind: 'clips', revision: 1, trackId: track.id, offset: 0 })).clips[0]?.id, take.itemId);
			const asset = 'a'.repeat(32);
			await peer.request({ kind: 'render', revision: 1, asset, start: beforeLoss.frame + 2048, end: beforeLoss.frame + 4096 });
			const samples = waveData(await readFile(join(exchangeDirectory, 'output', `${asset}.wav`)));
			assert.ok(audibleFrames(samples) > 1024, 'the take contains microphone audio captured after sink loss');
			await assert.rejects(peer.request({ kind: 'prepareOutput' }), /unavailable/u);
			assert.deepEqual((await peer.request({ kind: 'audioHosts' })).selected, applied);

			restorePipeWireFixtureSink();
			await waitForOutput(peer, host.id, output.id);
			await peer.request({ kind: 'prepareOutput' });
			await waitForTransport(status, (snapshot) => snapshot.ready && !snapshot.outputInterrupted);
			assert.equal((await peer.request({ kind: 'seek', frame: 0 })).frame, 0);
			assert.equal((await peer.request({ kind: 'play', frame: 0 })).playing, true);
			const heard = await waitForTransport(status, (snapshot) => snapshot.playing && snapshot.frame > 2048 && snapshot.frame < 8192);
			removePipeWireFixtureSink();
			const stopped = await waitForTransport(status, (snapshot) => snapshot.outputInterrupted === true && !snapshot.playing);
			assert.equal(stopped.ready, false);
			assert.ok(stopped.frame >= heard.frame, `playback stopped at ${stopped.frame} after frame ${heard.frame}`);
			await sleep(100);
			assert.deepEqual(await status(), stopped, 'the playhead stays put while output is unavailable');
			await assert.rejects(peer.request({ kind: 'prepareOutput' }), /unavailable/u);
			assert.deepEqual((await peer.request({ kind: 'audioHosts' })).selected, applied);

			restorePipeWireFixtureSink();
			await waitForOutput(peer, host.id, output.id);
			await peer.request({ kind: 'prepareOutput' });
			const rebound = await waitForTransport(status, (snapshot) => snapshot.ready && !snapshot.outputInterrupted);
			assert.equal(rebound.frame, stopped.frame);
			await peer.request({ kind: 'play', frame: rebound.frame });
			await waitForTransport(status, (snapshot) => snapshot.playing && snapshot.frame > rebound.frame + 2048);
			await peer.request({ kind: 'stop' });
			const secondInput = devices.inputs.find(({ name }) => name === 'tracktion.test.recovery-microphone');
			assert.ok(secondInput);
			const secondSetup = await peer.request({ kind: 'setAudioSetup', ...setup, inputId: secondInput.id });
			removePipeWireFixtureSink();
			const start = 24_000;
			const inputOnly = await peer.request({ kind: 'startRecording', revision: 1, trackId: track.id, frame: start });
			assert.equal(inputOnly.recording, true);
			assert.equal(inputOnly.ready, false);
			await waitForTransport(status, (snapshot) => snapshot.recording && snapshot.frame > start + 4096);
			const inputOnlyTake = await peer.request({ kind: 'finishRecording', revision: 1, discard: false });
			assert.ok(inputOnlyTake.itemId);
			const inputOnlyAsset = 'b'.repeat(32);
			await peer.request({ kind: 'render', revision: 2, asset: inputOnlyAsset, start, end: start + 4096 });
			const inputOnlySamples = waveData(await readFile(join(exchangeDirectory, 'output', `${inputOnlyAsset}.wav`)));
			assert.ok(audibleFrames(inputOnlySamples) > 2048, 'the input-only take contains audio');
			assert.deepEqual((await peer.request({ kind: 'audioHosts' })).selected, secondSetup);
			await assert.rejects(peer.request({ kind: 'prepareOutput' }), /unavailable/u);
		} finally {
			await peer.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function audibleFrames(samples: Buffer): number {
	let frames = 0;
	for (let offset = 0; offset + 4 <= samples.length; offset += 4)
		if (Math.abs(samples.readInt16LE(offset)) > 1024) frames += 1;
	return frames;
}

async function waitForTransport(
	read: () => Promise<TracktionTransportView>,
	accept: (view: TracktionTransportView) => boolean,
	timeout = 3_000,
): Promise<TracktionTransportView> {
	const deadline = performance.now() + timeout;
	let view = await read();
	while (!accept(view) && performance.now() < deadline) {
		await sleep(20);
		view = await read();
	}
	assert.ok(accept(view), JSON.stringify(view));
	return view;
}

async function waitForOutput(peer: ReturnType<typeof launchTracktionPeer>, hostId: string, outputId: string): Promise<void> {
	const deadline = performance.now() + 3000;
	do {
		const { outputs } = await peer.request({ kind: 'audioDevices', hostId });
		if (outputs.some(({ id }) => id === outputId)) return;
		await sleep(40);
	} while (performance.now() < deadline);
	assert.fail('the named PipeWire fixture sink did not return');
}
