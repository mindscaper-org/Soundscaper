/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { unzipSync } from 'fflate';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

function waveAtRate(rate: number, frames: number): Buffer {
	const wave = wavFixture(frames);
	wave.writeUInt32LE(rate, 24);
	wave.writeUInt32LE(rate * 4, 28);
	return wave;
}

function toneAtRate(rate: number): Buffer {
	const wave = waveAtRate(rate, rate);
	const pcm = waveData(wave);
	for (let frame = 0; frame < rate; frame += 1) {
		const sample = Math.sin(frame * 2 * Math.PI * 440 / rate);
		pcm.writeInt16LE(Math.round(16_000 * sample), frame * 4);
		pcm.writeInt16LE(Math.round(8_000 * sample), frame * 4 + 2);
	}
	return wave;
}

function risingCrossings(pcm: Buffer): number {
	let crossings = 0;
	let previous = 0;
	for (let offset = 0; offset < pcm.length; offset += 4) {
		const sample = pcm.readInt16LE(offset);
		if (previous <= 0 && sample > 0) crossings += 1;
		previous = sample;
	}
	return crossings;
}

test('Tracktion imports mixed-rate WAVs using project frames and preserves their source bytes', async () => {
	const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
	assert.ok(executable, 'Run the Tracktion mixed-rate import test through CTest.');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-mixed-rate-'));
	const projectDirectory = join(root, 'project');
	const exchangeDirectory = join(root, 'exchange');
	const input = join(exchangeDirectory, 'input');
	const output = join(exchangeDirectory, 'output');
	const media = join(projectDirectory, 'media');
	const launch = { executable, projectDirectory, exchangeDirectory, stateDirectory: join(root, 'settings') };
	const assetId = () => randomUUID().replaceAll('-', '');
	async function stage(wav: Buffer): Promise<string> {
		const id = assetId();
		await writeFile(join(input, `${id}.wav`), wav);
		return id;
	}
	try {
		await mkdir(input, { recursive: true });
		await mkdir(output);
		const mixed = toneAtRate(44_100);
		const rounded = waveAtRate(96_000, 97);
		const source = await stage(mixed);
		const roundedSource = await stage(rounded);
		const sameRate = wavFixture();
		const sameRateSource = await stage(sameRate);
		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		const archive = assetId();
		let beforeReopen: Buffer;
		try {
			const before = await peer.request({ kind: 'project', offset: 0 });
			const [track] = before.tracks;
			assert.ok(track);
			const importFile = { kind: 'importFile', revision: before.revision, trackId: track.id, start: 17 } as const;
			const whole = await peer.request({ ...importFile, asset: source, name: 'Imported tone' });
			const afterImport = await peer.request({ kind: 'project', offset: 0 });
			const savedMedia = await readdir(media);
			assert.equal(savedMedia.length, 1);
			const checkImport = { ...importFile, revision: whole.revision };
			for (const unsupportedRate of [4_000, 192_001]) {
				const unsupported = await stage(waveAtRate(unsupportedRate, 64));
				await assert.rejects(peer.request({ ...checkImport, name: 'Unsupported', asset: unsupported }), /supported sample rate/u);
			}
			const shorterThanOneFrame = await stage(waveAtRate(192_000, 1));
			await assert.rejects(peer.request({ ...checkImport, name: 'Too short', asset: shorterThanOneFrame }), /source interval/u);
			const partial = { kind: 'import', revision: whole.revision, trackId: track.id, asset: source, name: 'Tail',
				start: 50_000, sourceOffset: 47_989, frames: 11 } as const;
			await assert.rejects(peer.request({ ...partial, frames: 12 }), /source interval/u);
			assert.deepEqual(await peer.request({ kind: 'project', offset: 0 }), afterImport);
			assert.deepEqual(await readdir(media), savedMedia);

			const short = await peer.request({ ...checkImport, asset: roundedSource, name: 'Rounded', start: 49_000 });
			const tail = await peer.request({ ...partial, revision: short.revision });
			const unchanged = await peer.request({ ...importFile, revision: tail.revision, asset: sameRateSource, name: 'Same rate', start: 51_000 });
			const { revision } = unchanged;
			const page = await peer.request({ kind: 'clips', revision, trackId: track.id, offset: 0 });
			assert.deepEqual(page.clips, [
				{ id: whole.itemId, name: 'Imported tone', start: 17, end: 48_017, sourceOffset: 0 },
				{ id: short.itemId, name: 'Rounded', start: 49_000, end: 49_049, sourceOffset: 0 },
				{ id: tail.itemId, name: 'Tail', start: 50_000, end: 50_011, sourceOffset: 47_989 },
				{ id: unchanged.itemId, name: 'Same rate', start: 51_000, end: 51_064, sourceOffset: 0 },
			]);
			await peer.request({ kind: 'save', revision });
			await peer.request({ kind: 'archive', revision, asset: archive });
			const render = assetId();
			await peer.request({ kind: 'render', revision, start: 0, end: 51_064, asset: render });
			beforeReopen = waveData(await readFile(join(output, `${render}.wav`)));
			assert.equal(beforeReopen.length, 51_064 * 4);
			assert.ok(Math.abs(risingCrossings(beforeReopen.subarray(17 * 4, 48_017 * 4)) - 440) <= 1);
			assert.deepEqual(beforeReopen.subarray(51_000 * 4), waveData(sameRate));
		} finally {
			await peer.close();
		}
		const entries = unzipSync(await readFile(join(output, `${archive}.zip`)));
		const stored = await readdir(media);
		assert.equal(stored.length, 4);
		const sources = await Promise.all(stored.map(async (name) => {
			const bytes = await readFile(join(media, name));
			assert.deepEqual(entries[`media/${name}`], Uint8Array.from(bytes));
			return bytes;
		}));
		assert.deepEqual(sources.sort(Buffer.compare), [mixed, mixed, rounded, sameRate].sort(Buffer.compare));
		assert.deepEqual(await readFile(join(input, `${source}.wav`)), mixed);

		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			const { revision } = await reopened.request({ kind: 'project', offset: 0 });
			const render = assetId();
			await reopened.request({ kind: 'render', revision, start: 0, end: 51_064, asset: render });
			assert.deepEqual(waveData(await readFile(join(output, `${render}.wav`))), beforeReopen);
		} finally {
			await reopened.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
