/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { writeAlsaOutputFixture } from './alsa_fixture.ts';
import { wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the peer test through CTest.');

const asset = '0123456789abcdef'.repeat(2);

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
			assert.equal((await peer.request({ kind: 'redo', revision: 3 })).revision, 4);
			await peer.request({ kind: 'save', revision: 4 });
			await peer.request({ kind: 'render', revision: 4, start: 0, end: 87, asset });

			const bytes = await readFile(join(exchangeDirectory, 'output', `${asset}.wav`));
			assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
			assert.equal(bytes.subarray(8, 12).toString(), 'WAVE');
			assert.ok(bytes.includes(Buffer.from([0, 16, 0, 248])), 'output contains independent expected PCM');
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
			assert.deepEqual(await peer.request({ kind: 'transportStatus' }), { ready: false, playing: false, frame: 0 });
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
		const file = await open(output, 'r');
		try {
			const sample = Buffer.alloc(4 * 1024 * 1024);
			const { bytesRead } = await file.read(sample);
			let matchingFrames = 0;
			for (let offset = 0; offset + 8 <= bytesRead; offset += 8) {
				const left = sample.readFloatLE(offset);
				const right = sample.readFloatLE(offset + 4);
				if (Math.abs(left - 0.125) < 0.001 && Math.abs(right + 0.0625) < 0.001) matchingFrames += 1;
			}
			assert.ok(matchingFrames >= 2048, 'ALSA output has the independent expected stereo PCM');
		} finally {
			await file.close();
		}
	} finally {
		if (previous === undefined) delete process.env.ALSA_CONFIG_PATH;
		else process.env.ALSA_CONFIG_PATH = previous;
		await rm(root, { recursive: true, force: true });
	}
});
