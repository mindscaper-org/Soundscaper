/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import type { TracktionTransportView } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { removePipeWireFixtureSink, restorePipeWireFixtureSink } from './pipewire_fixture.ts';
import { waveData } from './wave_fixture.ts';

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
			let audibleFrames = 0;
			for (let offset = 0; offset + 4 <= samples.length; offset += 4)
				if (Math.abs(samples.readInt16LE(offset)) > 1024) audibleFrames += 1;
			assert.ok(audibleFrames > 1024, 'the take contains microphone audio captured after sink loss');
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
		} finally {
			await peer.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

async function waitForTransport(
	read: () => Promise<TracktionTransportView>,
	accept: (view: TracktionTransportView) => boolean,
): Promise<TracktionTransportView> {
	const deadline = performance.now() + 3000;
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
