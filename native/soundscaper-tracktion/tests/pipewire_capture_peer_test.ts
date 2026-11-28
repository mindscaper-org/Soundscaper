/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import type { TracktionTransportObservation } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { removePipeWireFixtureSource } from './pipewire_fixture.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the peer test through CTest.');

const asset = '0123456789abcdef'.repeat(2);

test('Tracktion streams through the named PipeWire source and sink', {
	skip: process.platform !== 'linux' || process.env.SOUNDSCAPER_TRACKTION_TEST_PIPEWIRE !== '1',
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-pipewire-'));
	try {
		const exchangeDirectory = join(root, 'exchange');
		await mkdir(join(exchangeDirectory, 'output'), { recursive: true });
		const peer = launchTracktionPeer({
			executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings'),
		});
		try {
			const { hosts } = await peer.request({ kind: 'audioHosts' });
			const host = hosts.find(({ name }) => name === 'PipeWire');
			assert.ok(host, 'Tracktion exposes the running PipeWire host');
			const devices = await peer.request({ kind: 'audioDevices', hostId: host.id });
			const output = devices.outputs.find(({ name }) => name === 'tracktion.test.speakers');
			const input = devices.inputs.find(({ name }) => name === 'tracktion.test.microphone');
			assert.ok(output && input, JSON.stringify(devices));
			const setup = { hostId: host.id, inputId: input.id, outputId: output.id, inputChannel: 1,
				outputChannel: 0, sampleRate: 48_000, blockSize: 256 };
			const applied = await peer.request({ kind: 'setAudioSetup', ...setup });
			assert.deepEqual(applied.setup, setup);
			assert.equal(applied.actualSampleRate, 48_000);
			assert.equal(applied.actualBlockSize, 256);
			const track = (await peer.request({ kind: 'project', offset: 0 })).tracks[0];
			assert.ok(track);
			assert.equal((await peer.request({ kind: 'startRecording', revision: 0, trackId: track.id, frame: 0 })).recording, true);
			const deadline = performance.now() + 3000;
			let transport = await peer.request({ kind: 'transportStatus' });
			while (transport.frame < 8192 && performance.now() < deadline) {
				await sleep(20);
				transport = await peer.request({ kind: 'transportStatus' });
			}
			assert.ok(transport.frame >= 8192 && transport.recording, JSON.stringify(transport));
			const take = await peer.request({ kind: 'finishRecording', revision: 0, discard: false });
			assert.ok(take.itemId);
			assert.deepEqual((await peer.request({ kind: 'audioHosts' })).selected, applied);
			await peer.request({ kind: 'render', revision: 1, asset, start: 0, end: 8192 });
			const pcm = waveData(await readFile(join(exchangeDirectory, 'output', `${asset}.wav`)));
			let audibleFrames = 0;
			for (let offset = 0; offset + 4 <= pcm.length; offset += 4)
				if (Math.abs(pcm.readInt16LE(offset)) > 1024) audibleFrames += 1;
			assert.ok(audibleFrames > 4096, 'Tracktion captured the virtual PipeWire generator');
			const monitorFile = join(root, 'speaker-monitor.wav');
			const monitor = spawn('pw-record', [
				'--target=tracktion.test.speakers', '--properties=stream.capture.sink=true',
				'--rate=48000', '--channels=2', '--format=s16', monitorFile,
			], { stdio: ['ignore', 'ignore', 'pipe'] });
			let diagnostics = '';
			monitor.stderr.setEncoding('utf8').on('data', (chunk: string) => { diagnostics = (diagnostics + chunk).slice(-4096); });
			let stoppingMonitor = false;
			const monitorClosed = new Promise<Error | null>((resolve) => {
				monitor.once('close', (code) => {
					// PipeWire 1.0's CLI can return 1 after an orderly SIGINT.
					const expected = code === 0 || (stoppingMonitor && code === 1 && !diagnostics.trim());
					resolve(expected ? null : new Error(`PipeWire monitor exited with ${code}. ${diagnostics}`));
				});
				monitor.once('error', resolve);
			});
			try {
				const cacheDeadline = performance.now() + 3000;
				let ready = false;
				while (!ready && performance.now() < cacheDeadline) {
					const monitorSize = await stat(monitorFile).then((file) => file.size, () => 0);
					ready = monitorSize > 44 && (await peer.request({ kind: 'transportStatus' })).ready;
					if (!ready) await sleep(20);
				}
				assert.ok(ready, 'the speaker monitor and Tracktion playback are both ready');
				assert.equal((await peer.request({ kind: 'play', frame: 0 })).playing, true);
				// Wait for the monitor to capture fresh output before stopping.
				const beforePlayback = (await stat(monitorFile)).size;
				const speakerDeadline = performance.now() + 3000;
				while ((await stat(monitorFile)).size < beforePlayback + 12_288 * 4 && performance.now() < speakerDeadline) await sleep(20);
				assert.ok((await stat(monitorFile)).size >= beforePlayback + 12_288 * 4);
				await peer.request({ kind: 'stop' });
			} finally {
				stoppingMonitor = monitor.kill('SIGINT');
				await monitorClosed;
			}
			const monitorError = await monitorClosed;
			if (monitorError) throw monitorError;
			const played = waveData(await readFile(monitorFile));
			let stereoFrames = 0;
			let peak = 0;
			for (let offset = 0; offset + 4 <= played.length; offset += 4) {
				const left = Math.abs(played.readInt16LE(offset));
				const right = Math.abs(played.readInt16LE(offset + 2));
				peak = Math.max(peak, left, right);
				if (left > 1024 && right > 1024) stereoFrames += 1;
			}
			assert.ok(stereoFrames > 2048, `the named sink received ${stereoFrames} audible stereo frames, peak ${peak} in ${played.length} bytes`);

			const recoveryInput = devices.inputs.find(({ name }) => name === 'tracktion.test.recovery-microphone');
			assert.ok(recoveryInput, JSON.stringify(devices));
			await peer.request({ kind: 'setAudioSetup', ...setup, inputId: recoveryInput.id });
			const secondStart = 24_000;
			let capture = await peer.request({ kind: 'startRecording', revision: 1, trackId: track.id, frame: secondStart });
			const captureDeadline = performance.now() + 3000;
			while (capture.recording && capture.frame < secondStart + 8192 && performance.now() < captureDeadline) {
				await sleep(20);
				capture = await peer.request({ kind: 'transportStatus' });
			}
			assert.ok(capture.recording && capture.frame >= secondStart + 8192, JSON.stringify(capture));
			removePipeWireFixtureSource('tracktion.test.recovery-microphone');

			const recoveryDeadline = performance.now() + 3000;
			let recovered = await peer.request({ kind: 'transportStatus' });
			while (recovered.recording && performance.now() < recoveryDeadline) {
				await sleep(20);
				recovered = await peer.request({ kind: 'transportStatus' });
			}
			assert.equal(recovered.recording, false, 'a removed source ends the take');
			assert.ok(recovered.interruptedTake?.itemId, 'the captured audio is committed before reporting input loss');
			assert.equal(recovered.interruptedTake.revision, 2);
			const replayedStop = await peer.request({ kind: 'finishRecording', revision: 1, discard: false });
			assert.deepEqual(replayedStop, recovered.interruptedTake, 'a racing Stop can read the same take');
			const recoveredProject = await peer.request({ kind: 'project', offset: 0 });
			assert.equal(recoveredProject.tracks[0]?.clipCount, 2);
			assert.equal((await peer.request({ kind: 'undo', revision: 2 })).revision, 3);
			const afterUndo = await peer.request({ kind: 'clips', revision: 3, trackId: track.id, offset: 0 });
			assert.deepEqual(afterUndo.clips.map(({ id }) => id), [take.itemId]);
			assert.equal((await peer.request({ kind: 'redo', revision: 3 })).revision, 4);
			const afterRedo = await peer.request({ kind: 'clips', revision: 4, trackId: track.id, offset: 0 });
			const redoneTake = afterRedo.clips.find(({ id }) => id === recovered.interruptedTake?.itemId);
			assert.ok(redoneTake && redoneTake.start === secondStart && redoneTake.end > redoneTake.start);
			const readyDeadline = performance.now() + 3000;
			let outputStatus = await peer.request({ kind: 'prepareOutput' });
			while (!outputStatus.ready && performance.now() < readyDeadline) {
				await sleep(20);
				outputStatus = await peer.request({ kind: 'transportStatus' });
			}
			assert.equal(outputStatus.ready, true, 'the recovered take is playable on the same sink');
			const recoveredAsset = 'd'.repeat(32);
			await peer.request({ kind: 'render', revision: 4, asset: recoveredAsset, start: secondStart, end: secondStart + 8192 });
			const recoveredPcm = waveData(await readFile(join(exchangeDirectory, 'output', `${recoveredAsset}.wav`)));
			let recoveredFrames = 0;
			for (let offset = 0; offset + 4 <= recoveredPcm.length; offset += 4)
				if (Math.abs(recoveredPcm.readInt16LE(offset)) > 1024) recoveredFrames += 1;
			assert.ok(recoveredFrames > 4096, 'undo and redo retain the audible captured prefix');
		} finally {
			await peer.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Tracktion discards the recovered take when Discard races PipeWire input loss', {
	skip: process.platform !== 'linux' || process.env.SOUNDSCAPER_TRACKTION_TEST_PIPEWIRE !== '1',
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-pipewire-discard-'));
	const exchangeDirectory = join(root, 'exchange');
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture());
		const peer = launchTracktionPeer({ executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') });
		try {
			const { hosts } = await peer.request({ kind: 'audioHosts' });
			const host = hosts.find(({ name }) => name === 'PipeWire');
			assert.ok(host);
			const devices = await peer.request({ kind: 'audioDevices', hostId: host.id });
			const input = devices.inputs.find(({ name }) => name === 'tracktion.test.microphone');
			const output = devices.outputs.find(({ name }) => name === 'tracktion.test.speakers');
			assert.ok(input && output, JSON.stringify(devices));
			await peer.request({ kind: 'setAudioSetup', hostId: host.id, inputId: input.id, outputId: output.id,
				inputChannel: 0, outputChannel: 0, sampleRate: 48_000, blockSize: 256 });
			const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await peer.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, start: 0, name: 'Earlier clip' });
			const original = await peer.request({ kind: 'clips', revision: 1, trackId: track.id, offset: 0 });
			let discarded: TracktionTransportObservation = await peer.request({ kind: 'startRecording', revision: 1, trackId: track.id, frame: 0 });
			const discardCaptureDeadline = performance.now() + 3000;
			while (discarded.recording && discarded.frame < 8192 && performance.now() < discardCaptureDeadline) {
				await sleep(20);
				discarded = await peer.request({ kind: 'transportObservation' });
			}
			assert.ok(discarded.recording && discarded.frame >= 8192, JSON.stringify(discarded));
			removePipeWireFixtureSource();
			const discardRecoveryDeadline = performance.now() + 3000;
			while (discarded.recording && performance.now() < discardRecoveryDeadline) {
				await sleep(20);
				discarded = await peer.request({ kind: 'transportObservation' });
			}
			assert.ok(discarded.interruptedTake?.itemId, 'the last take was auto-recovered before Discard arrived');
			assert.equal(discarded.interruptedTake.revision, 2);
			assert.equal(Object.hasOwn(discarded, 'ready'), false);
			await assert.rejects(peer.request({ kind: 'finishRecording', revision: 0, discard: true }), /revision/u);
			assert.deepEqual(await peer.request({ kind: 'finishRecording', revision: 1, discard: true }), { revision: 3, itemId: null });
			assert.deepEqual(await peer.request({ kind: 'clips', revision: 3, trackId: track.id, offset: 0 }), { ...original, revision: 3 });
			assert.equal((await peer.request({ kind: 'transportStatus' })).interruptedTake, undefined);
		} finally {
			await peer.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
