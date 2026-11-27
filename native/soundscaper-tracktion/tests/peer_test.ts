/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { countAlsaFrames, startAlsaCaptureFixture, startAlsaRoutingFixture, writeAlsaOutputFixture } from './alsa_fixture.ts';
import './paging_peer_test.ts';
import './pipewire_capture_peer_test.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the peer test through CTest.');

const asset = '0123456789abcdef'.repeat(2);

test('Tracktion publishes the installed Windows ASIO drivers as coupled audio devices', {
	skip: process.platform !== 'win32' || process.env.SOUNDSCAPER_TRACKTION_TEST_ASIO !== '1',
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-asio-'));
	try {
		const exchangeDirectory = join(root, 'exchange');
		await mkdir(exchangeDirectory);
		const peer = launchTracktionPeer({
			executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings'),
		});
		try {
			const { hosts } = await peer.request({ kind: 'audioHosts' });
			const asio = hosts.find(({ name }) => name === 'ASIO');
			assert.ok(asio, 'the Windows machine has at least one exposed ASIO driver');
			const devices = await peer.request({ kind: 'audioDevices', hostId: asio.id });
			assert.equal(devices.separateDevices, false);
			assert.ok(devices.outputs.length > 0);
			assert.deepEqual(devices.inputs, devices.outputs);
		} finally {
			await peer.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('the framed Tracktion peer owns edits and publishes output through opaque exchange slots', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-peer-'));
	const projectDirectory = join(root, 'project');
	const stateDirectory = join(root, 'settings');
	const exchangeDirectory = join(root, 'exchange');
	const launch = { executable, projectDirectory, stateDirectory, exchangeDirectory };
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await mkdir(join(exchangeDirectory, 'output'));
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture());

		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		try {
			const initial = await peer.request({ kind: 'project', offset: 0 });
			assert.equal(initial.revision, 0);
			assert.equal(initial.sampleRate, 48_000);
			assert.equal(initial.tracks.length, 1);
			const initialTrack = initial.tracks[0];
			assert.ok(initialTrack);
			assert.equal(initialTrack.clipCount, 0);
			const { revision, itemId } = await peer.request({
				kind: 'import', revision: 0, trackId: initialTrack.id,
				asset, name: 'Reference', start: 31, sourceOffset: 5, frames: 52,
			});
			assert.equal(revision, 1);
			assert.ok(itemId);

			await assert.rejects(peer.request({ kind: 'split', revision: 0, clipId: itemId, frame: 54 }), /revision/u);
			const page = await peer.request({ kind: 'clips', revision, trackId: initialTrack.id, offset: 0 });
			assert.deepEqual(page.clips, [{ id: itemId, name: 'Reference', start: 31, end: 83, sourceOffset: 5 }]);
			await assert.rejects(peer.request({
				kind: 'render', revision, start: 0, end: 87, asset: '../escape',
			}), /handle/u);
			const extraField = { kind: 'project', offset: 0, unexpected: true } as const;
			await assert.rejects(peer.request(extraField), /shape/u);

			const split = await peer.request({ kind: 'split', revision, clipId: itemId, frame: 54 });
			assert.equal(split.revision, 2);
			assert.ok(split.itemId);
			assert.equal((await peer.request({ kind: 'undo', revision: 2 })).revision, 3);
			assert.equal((await peer.request({ kind: 'clips', revision: 3, trackId: initialTrack.id, offset: 0 })).clips.length, 1);
			assert.equal((await peer.request({ kind: 'redo', revision: 3 })).revision, 4);
			await peer.request({ kind: 'save', revision: 4 });
			await peer.request({ kind: 'render', revision: 4, start: 0, end: 87, asset });

			const bytes = await readFile(join(exchangeDirectory, 'output', `${asset}.wav`));
			assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
			assert.equal(bytes.subarray(8, 12).toString(), 'WAVE');
			assert.ok(bytes.includes(Buffer.from([0, 16, 0, 248])), 'output contains independent expected PCM');
			const mix = { gainDb: -6, pan: 0.5, muted: true, solo: false } as const;
			await assert.rejects(peer.request({ kind: 'setTrackMix', revision: 4, trackId: initialTrack.id, ...mix, gainDb: 7 }), /range/u);
			const changed = await peer.request({ kind: 'setTrackMix', revision: 4, trackId: initialTrack.id, ...mix });
			assert.equal(changed.revision, 5);
			const trackMix = await peer.request({ kind: 'trackMix', revision: 5, trackId: initialTrack.id });
			assert.ok(Math.abs(trackMix.gainDb - mix.gainDb) < 0.01);
			assert.equal(trackMix.pan, mix.pan);
			assert.equal(trackMix.muted, true);
			assert.equal((await peer.request({ kind: 'setTrackMix', revision: 5, trackId: initialTrack.id, ...mix })).revision, 5);
			const mutedAsset = '1'.repeat(32);
			await peer.request({ kind: 'render', revision: 5, start: 0, end: 87, asset: mutedAsset });
			const mutedWave = await readFile(join(exchangeDirectory, 'output', `${mutedAsset}.wav`));
			const data = mutedWave.indexOf('data', 12, 'ascii');
			assert.ok(data >= 36);
			const pcm = mutedWave.subarray(data + 8, data + 8 + mutedWave.readUInt32LE(data + 4));
			assert.ok(pcm.length > 0 && pcm.every((byte) => byte === 0), 'muting the track renders silence');
			await peer.request({ kind: 'undo', revision: 5 });
			const originalMix = await peer.request({ kind: 'trackMix', revision: 6, trackId: initialTrack.id });
			assert.ok(Math.abs(originalMix.gainDb) < 0.01);
			assert.equal(originalMix.pan, 0);
			assert.equal(originalMix.muted, false);
			await peer.request({ kind: 'redo', revision: 6 });
			assert.deepEqual(await peer.request({ kind: 'trackMix', revision: 7, trackId: initialTrack.id }), trackMix);
		} finally {
			await peer.close();
		}

		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			const summary = await reopened.request({ kind: 'project', offset: 0 });
			assert.equal(summary.revision, 0);
			assert.equal(summary.tracks[0]?.clipCount, 2);
			assert.equal(summary.canUndo, false);

			for (let revision = 0; revision < 33; revision += 1) {
				await reopened.request({ kind: 'addTrack', revision, name: `Track ${String(revision)}` });
			}
			const firstPage = await reopened.request({ kind: 'project', offset: 0 });
			assert.equal(firstPage.tracks.length, 32);
			assert.equal(firstPage.nextOffset, 32);
			const lastPage = await reopened.request({ kind: 'project', offset: 32 });
			assert.equal(lastPage.revision, firstPage.revision);
			assert.equal(lastPage.tracks.length, 2);
			assert.equal(lastPage.nextOffset, null);

			const [origin, destination] = firstPage.tracks;
			assert.ok(origin && destination);
			const original = (await reopened.request({ kind: 'clips', revision: 33, trackId: origin.id, offset: 0 })).clips[0];
			assert.ok(original);
			const placement = { clipId: original.id, trackId: destination.id, start: 100 };
			await assert.rejects(reopened.request({ ...placement, kind: 'moveClip', revision: 33, trackId: '18446744073709551615' }), /unknown.*track/iu);
			const moved = await reopened.request({ ...placement, kind: 'moveClip', revision: 33 });
			assert.deepEqual(moved, { revision: 34, itemId: null });
			const copy = await reopened.request({ ...placement, kind: 'duplicateClip', revision: 34, trackId: origin.id, start: 200 });
			assert.ok(copy.itemId && copy.itemId !== original.id);
			const erased = await reopened.request({ kind: 'deleteClip', clipId: original.id, revision: 35 });
			assert.deepEqual(erased, { revision: 36, itemId: null });
			await reopened.request({ kind: 'undo', revision: 36 });
			const restored = await reopened.request({ kind: 'clips', revision: 37, trackId: destination.id, offset: 0 });
			const duration = original.end - original.start;
			assert.deepEqual(restored.clips, [{ ...original, start: 100, end: 100 + duration }]);
			const empty = await reopened.request({ kind: 'deleteRange', revision: 37, mode: 'track', trackId: destination.id, start: 10_000, end: 10_001 });
			assert.deepEqual(empty, { revision: 37, itemId: null });
		} finally {
			await reopened.close();
		}

		const cancelled = launchTracktionPeer({ ...launch, mode: 'open' });
		const pending = cancelled.request({ kind: 'project', offset: 0 });
		const rejection = assert.rejects(pending);
		await cancelled.close();
		await rejection;
		await assert.rejects(cancelled.request({ kind: 'project', offset: 0 }), /closed/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Tracktion sends live project audio to the Linux ALSA output', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-device-'));
	const config = join(root, 'alsa.conf');
	const output = join(root, 'device.raw');
	const previous = process.env.ALSA_CONFIG_PATH;
	const exchangeDirectory = join(root, 'exchange');
	try {
		await writeAlsaOutputFixture(config, output);
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(4096));
		process.env.ALSA_CONFIG_PATH = config;
		const peer = launchTracktionPeer({
			executable, mode: 'create', sampleRate: 48_000,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings'), exchangeDirectory,
		});
		try {
			assert.deepEqual(await peer.request({ kind: 'transportStatus' }), { ready: false, playing: false, recording: false, frame: 0 });
			const track = (await peer.request({ kind: 'project', offset: 0 })).tracks[0];
			assert.ok(track);
			await peer.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Output check', start: 0 });
			let transport = await peer.request({ kind: 'prepareOutput' });
			for (let attempt = 0; attempt < 100 && !transport.ready; attempt += 1) {
				await sleep(10);
				transport = await peer.request({ kind: 'transportStatus' });
			}
			assert.equal(transport.ready, true);
			assert.equal((await peer.request({ kind: 'play', frame: 0 })).playing, true);
			for (let attempt = 0; attempt < 100; attempt += 1) {
				transport = await peer.request({ kind: 'transportStatus' });
				if (transport.frame >= 4096) break;
				await sleep(5);
			}
			assert.ok(transport.frame >= 4096, 'the live device advances the Tracktion playhead');
			assert.equal((await peer.request({ kind: 'stop' })).playing, false);
			assert.equal((await peer.request({ kind: 'seek', frame: 10 })).frame, 10);
			assert.equal((await peer.request({ kind: 'project', offset: 0 })).revision, 1);
		} finally {
			await peer.close();
		}
		const matchingFrames = await countAlsaFrames(output, 2, 2048, (samples, offset) =>
			Math.abs(samples.readFloatLE(offset) - 0.125) < 0.001
			&& Math.abs(samples.readFloatLE(offset + 4) + 0.0625) < 0.001);
		assert.ok(matchingFrames >= 2048, 'ALSA output has the independent expected stereo PCM');
	} finally {
		if (previous === undefined) delete process.env.ALSA_CONFIG_PATH;
		else process.env.ALSA_CONFIG_PATH = previous;
		await rm(root, { recursive: true, force: true });
	}
});

test('Tracktion records native input as an undoable project clip', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-capture-'));
	const config = join(root, 'alsa.conf');
	const previous = process.env.ALSA_CONFIG_PATH;
	const projectDirectory = join(root, 'project');
	const exchangeDirectory = join(root, 'exchange');
	const launch = { executable, projectDirectory, stateDirectory: join(root, 'settings'), exchangeDirectory };
	let stopInput: (() => Promise<void>) | undefined;
	try {
		stopInput = await startAlsaCaptureFixture(config, join(root, 'input.raw'));
		await mkdir(join(exchangeDirectory, 'output'), { recursive: true });
		process.env.ALSA_CONFIG_PATH = config;
		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		try {
			const track = (await peer.request({ kind: 'project', offset: 0 })).tracks[0];
			assert.ok(track);
			await peer.request({ kind: 'save', revision: 0 });
			await peer.request({ kind: 'prepareOutput' });
			const start = { kind: 'startRecording', revision: 0, trackId: track.id, frame: 144 } as const;
			assert.equal((await peer.request(start)).recording, true);
			await assert.rejects(peer.request({ kind: 'save', revision: 0 }), /recording/u);
			const deadline = performance.now() + 3000;
			let transport = await peer.request({ kind: 'transportStatus' });
			while (transport.frame < 8192 && performance.now() < deadline) {
				await sleep(10);
				transport = await peer.request({ kind: 'transportStatus' });
			}
			assert.ok(transport.frame >= 8192, `the ALSA recording playhead only reached frame ${String(transport.frame)}`);
			const take = await peer.request({ kind: 'finishRecording', revision: 0, discard: false });
			assert.equal(take.revision, 1);
			assert.ok(take.itemId);
			const { clips } = await peer.request({ kind: 'clips', revision: 1, trackId: track.id, offset: 0 });
			assert.equal(clips.length, 1);
			assert.equal(clips[0]?.id, take.itemId);
			assert.equal(clips[0]?.start, 144);
			assert.ok((clips[0]?.end ?? 0) >= 2048);
			await peer.request({ kind: 'undo', revision: 1 });
			assert.equal((await peer.request({ kind: 'project', offset: 0 })).tracks[0]?.clipCount, 0);
			await peer.request({ kind: 'redo', revision: 2 });
			await peer.request({ ...start, revision: 3 });
			assert.deepEqual(await peer.request({ kind: 'finishRecording', revision: 3, discard: true }), { revision: 3, itemId: null });
			const media = await readdir(join(projectDirectory, 'media'));
			assert.equal(media.length, 1);
			assert.match(media[0] ?? '', /^[0-9a-f]{32}\.wav$/u);
			await peer.request({ kind: 'save', revision: 3 });
			await peer.request({ ...start, revision: 3 });
			await peer.close();
			assert.deepEqual(await readdir(join(projectDirectory, 'media')), media, 'closing discards the unfinished take');
		} finally {
			await peer.close();
		}

		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			assert.equal((await reopened.request({ kind: 'project', offset: 0 })).tracks[0]?.clipCount, 1);
			await reopened.request({ kind: 'render', revision: 0, asset, start: 144, end: 2048 });
			const rendered = await readFile(join(exchangeDirectory, 'output', `${asset}.wav`));
			assert.equal(rendered.subarray(0, 4).toString(), 'RIFF');
			const pcm = waveData(rendered);
			let matchingFrames = 0;
			for (let offset = 0; offset + 4 <= pcm.length; offset += 4) {
				if (Math.abs(pcm.readInt16LE(offset) - 8192) <= 1
					&& Math.abs(pcm.readInt16LE(offset + 2) - 8192) <= 1) matchingFrames += 1;
			}
			assert.ok(matchingFrames >= 1024, 'captured 0.25-amplitude input survives stereo rendering');
		} finally {
			await reopened.close();
		}
	} finally {
		if (previous === undefined) delete process.env.ALSA_CONFIG_PATH;
		else process.env.ALSA_CONFIG_PATH = previous;
		try { await stopInput?.(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});

test('Tracktion applies a named ALSA route and preserves it when a replacement is refused', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-route-'));
	const config = join(root, 'alsa.conf');
	const outputFile = join(root, 'output.raw');
	const previous = process.env.ALSA_CONFIG_PATH;
	let stopInput: (() => Promise<void>) | undefined;
	try {
		stopInput = await startAlsaRoutingFixture(config, join(root, 'input.raw'), outputFile);
		await mkdir(join(root, 'exchange', 'output'), { recursive: true });
		process.env.ALSA_CONFIG_PATH = config;
		const peer = launchTracktionPeer({
			executable, mode: 'create', sampleRate: 48_000, projectDirectory: join(root, 'project'),
			stateDirectory: join(root, 'settings'), exchangeDirectory: join(root, 'exchange'),
		});
		try {
			const initial = await peer.request({ kind: 'audioHosts' });
			assert.equal(initial.selected, null);
			assert.equal((await peer.request({ kind: 'transportStatus' })).ready, false);
			const host = initial.hosts.find((entry) => entry.name === 'ALSA');
			assert.ok(host);
			const devices = await peer.request({ kind: 'audioDevices', hostId: host.id });
			const input = devices.inputs.find((entry) => entry.name.includes('Selected duplex'));
			const output = devices.outputs.find((entry) => entry.name.includes('Selected duplex'));
			assert.ok(input && output, JSON.stringify(devices));
			const route = {
				hostId: host.id, inputId: input.id, outputId: output.id, inputChannel: 1, outputChannel: 2,
				sampleRate: 48_000, blockSize: 0,
			} as const;
			const selected = await peer.request({ kind: 'setAudioSetup', ...route });
			assert.equal(selected.actualSampleRate, 48_000);
			assert.ok(selected.actualBlockSize > 0);
			assert.deepEqual(selected.setup, route);
			await assert.rejects(peer.request({ kind: 'setAudioSetup', ...route, outputId: 'deaf000000000000' }), /unavailable/u);
			await assert.rejects(peer.request({ kind: 'setAudioSetup', ...route, sampleRate: 47_000 }), /sample rate/u);
			assert.deepEqual((await peer.request({ kind: 'audioHosts' })).selected, selected);
			const track = (await peer.request({ kind: 'project', offset: 0 })).tracks[0];
			assert.ok(track);
			await peer.request({ kind: 'startRecording', revision: 0, trackId: track.id, frame: 0 });
			await assert.rejects(peer.request({ kind: 'setAudioSetup', ...route }), /recording/u);
			const deadline = performance.now() + 2500;
			let transport = await peer.request({ kind: 'transportStatus' });
			while (transport.frame < 4096 && performance.now() < deadline) {
				await sleep(10);
				transport = await peer.request({ kind: 'transportStatus' });
			}
			assert.ok(transport.frame >= 4096);
			const take = await peer.request({ kind: 'finishRecording', revision: 0, discard: false });
			assert.ok(take.itemId);
			assert.deepEqual((await peer.request({ kind: 'audioHosts' })).selected, selected);
			await peer.request({ kind: 'render', revision: 1, asset, start: 0, end: 4096 });
			const pcm = waveData(await readFile(join(root, 'exchange', 'output', `${asset}.wav`)));
			let matchingFrames = 0;
			for (let offset = 0; offset + 4 <= pcm.length; offset += 4)
				if (Math.abs(pcm.readInt16LE(offset) - 12288) <= 1 && Math.abs(pcm.readInt16LE(offset + 2) - 12288) <= 1) matchingFrames += 1;
			assert.ok(matchingFrames > 1024, 'the take contains the selected second hardware channel');
			const playbackDeadline = performance.now() + 2500;
			while (!(await peer.request({ kind: 'transportStatus' })).ready && performance.now() < playbackDeadline) await sleep(10);
			assert.equal((await peer.request({ kind: 'play', frame: 0 })).playing, true);
			let playback = await peer.request({ kind: 'transportStatus' });
			while (playback.frame < 4096 && performance.now() < playbackDeadline) {
				await sleep(10);
				playback = await peer.request({ kind: 'transportStatus' });
			}
			assert.ok(playback.frame >= 4096);
		} finally {
			await peer.close();
		}
		const found = await countAlsaFrames(outputFile, 4, 1024, (samples, offset) => {
			if (Math.abs(samples.readFloatLE(offset + 8) - 0.375) >= 0.001
				|| Math.abs(samples.readFloatLE(offset + 12) - 0.375) >= 0.001) return false;
			assert.equal(samples.readFloatLE(offset), 0);
			assert.equal(samples.readFloatLE(offset + 4), 0);
			return true;
		});
		assert.ok(found >= 1024, 'expected PCM on the third and fourth channels');
	} finally {
		if (previous === undefined) delete process.env.ALSA_CONFIG_PATH;
		else process.env.ALSA_CONFIG_PATH = previous;
		try { await stopInput?.(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});
