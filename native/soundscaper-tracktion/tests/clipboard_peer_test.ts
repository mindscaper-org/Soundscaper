/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';
import { wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion clipboard test through CTest.');

const longFrames = 524_288;
const shortStart = 32;
const longStart = 128;

async function prepareSizeLimitedClipboard(root: string, peerPath: string) {
	const projectDirectory = join(root, 'project');
	const exchangeDirectory = join(root, 'exchange');
	const clipboardDirectory = join(root, 'clipboard');
	const launch = { executable: peerPath, projectDirectory, exchangeDirectory, clipboardDirectory, stateDirectory: join(root, 'state') };
	const limitedPeer = join(root, 'limited-peer');
	await writeFileSizeLimitedPeer(limitedPeer);
	await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
	const large = 'a'.repeat(32);
	const small = 'b'.repeat(32);
	await writeFile(join(exchangeDirectory, 'input', `${large}.wav`), wavFixture(longFrames));
	await writeFile(join(exchangeDirectory, 'input', `${small}.wav`), wavFixture());
	const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
	try {
		const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
		assert.ok(track);
		const trackId = track.id;
		await peer.request({ kind: 'importFile', revision: 0, trackId, asset: large, name: 'Large', start: longStart });
		await peer.request({ kind: 'importFile', revision: 1, trackId, asset: small, name: 'Small', start: shortStart });
		await peer.request({ kind: 'save', revision: 2 });
		return { launch, limitedPeer, trackId };
	} finally { await peer.close(); }
}

test('Tracktion Cut keeps the source and prior clipboard if a media write fails', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-cut-limit-'));
	try {
		const { launch, limitedPeer, trackId } = await prepareSizeLimitedClipboard(root, executable);
		const peer = launchTracktionPeer({ ...launch, executable: limitedPeer, mode: 'open' });
		try {
			const page = { kind: 'project', offset: 0 } as const;
			const clips = { kind: 'clips', revision: 0, trackId, offset: 0 } as const;
			const before = await peer.request(page);
			const source = await peer.request(clips);
			await peer.request({ kind: 'copyRange', revision: 0, trackId, mode: 'leaveGap', start: shortStart, end: shortStart + 64 });
			const selection = join(launch.clipboardDirectory, 'selection.xml');
			const previousClipboard = await readFile(selection);
			const previousFiles = (await readdir(launch.clipboardDirectory)).sort();
			await assert.rejects(peer.request({ kind: 'cutRange', revision: 0, trackId, mode: 'leaveGap', start: longStart, end: longStart + longFrames }),
				/Cannot preserve Tracktion clipboard media/u);
			assert.deepEqual(await peer.request(page), before);
			assert.deepEqual(await peer.request(clips), source);
			assert.deepEqual(await readFile(selection), previousClipboard);
			assert.deepEqual((await readdir(launch.clipboardDirectory)).sort(), previousFiles);
			await peer.request({ kind: 'pasteRange', revision: 0, trackId, mode: 'overlap', start: 600_000 });
			const pasted = (await peer.request({ ...clips, revision: 1 })).clips.at(-1);
			assert.ok(pasted);
			assert.deepEqual([pasted.name, pasted.start, pasted.end], ['Small', 600_000, 600_064]);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion Paste rejects incomplete media without changing the destination', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-paste-limit-'));
	try {
		const { launch, limitedPeer, trackId } = await prepareSizeLimitedClipboard(root, executable);
		const source = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			await source.request({ kind: 'copyRange', revision: 0, trackId, mode: 'leaveGap', start: shortStart, end: longStart + longFrames });
		} finally { await source.close(); }
		const selection = join(launch.clipboardDirectory, 'selection.xml');
		const previousClipboard = await readFile(selection);
		const projectDirectory = join(root, 'destination');
		const peer = launchTracktionPeer({ ...launch, executable: limitedPeer, projectDirectory, mode: 'create', sampleRate: 48_000 });
		try {
			const page = { kind: 'project', offset: 0 } as const;
			const before = await peer.request(page);
			const [destination] = before.tracks;
			assert.ok(destination);
			await assert.rejects(peer.request({ kind: 'pasteRange', revision: 0, trackId: destination.id, mode: 'insertTracks', start: 9 }),
				/Cannot adopt the clipboard media/u);
			assert.deepEqual(await peer.request(page), before);
			assert.deepEqual(await readdir(join(projectDirectory, 'media')), []);
			assert.deepEqual(await readFile(selection), previousClipboard);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion cut and insert paste preserve source material across projects', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-clipboard-'));
	const clipboardDirectory = join(root, 'clipboard');
	const exchangeDirectory = join(root, 'exchange');
	const sourceDirectory = join(root, 'source');
	const destinationDirectory = join(root, 'destination');
	const asset = 'e'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(512));
		const launch = { executable, stateDirectory: join(root, 'state'), exchangeDirectory, clipboardDirectory };
		const source = launchTracktionPeer({ ...launch, projectDirectory: sourceDirectory, mode: 'create', sampleRate: 48_000 });
		try {
			const [track] = (await source.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await source.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Source', start: 30 });
			await source.request({ kind: 'cutRange', revision: 1, trackId: track.id, mode: 'track', start: 100, end: 201 });
			const { clips } = await source.request({ kind: 'clips', revision: 2, trackId: track.id, offset: 0 });
			assert.deepEqual(clips.map(({ start, end, sourceOffset }) => [start, end, sourceOffset]), [[30, 100, 0], [100, 441, 171]]);
			await assert.rejects(source.request({ kind: 'copyRange', revision: 2, trackId: track.id, mode: 'leaveGap', start: 700, end: 800 }), /no audio/iu);
		} finally { await source.close(); }

		await rm(sourceDirectory, { recursive: true });
		const destination = launchTracktionPeer({ ...launch, projectDirectory: destinationDirectory, mode: 'create', sampleRate: 48_000 });
		try {
			const [track] = (await destination.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await destination.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Destination', start: 0 });
			await destination.request({ kind: 'pasteRange', revision: 1, trackId: track.id, mode: 'insertTracks', start: 40 });
			const { clips } = await destination.request({ kind: 'clips', revision: 2, trackId: track.id, offset: 0 });
			assert.deepEqual(clips.map(({ name, start, end, sourceOffset }) => [name, start, end, sourceOffset]), [
				['Destination', 0, 40, 0], ['Source', 40, 141, 70], ['Destination', 141, 613, 40],
			]);
			await destination.request({ kind: 'undo', revision: 2 });
			assert.equal((await destination.request({ kind: 'project', offset: 0 })).tracks[0]?.clipCount, 1);
			await destination.request({ kind: 'pasteRange', revision: 3, trackId: track.id, mode: 'overlap', start: 600 });
			assert.equal((await readdir(join(destinationDirectory, 'media'))).length, 2, 'repeated paste keeps one copy of each media file');
			const { itemId: auxiliary } = await destination.request({ kind: 'addTrack', revision: 4, name: 'Auxiliary' });
			assert.ok(auxiliary);
			await destination.request({ kind: 'importFile', revision: 5, trackId: auxiliary, asset, name: 'Auxiliary', start: 100 });
			await destination.request({ kind: 'pasteRange', revision: 6, trackId: track.id, mode: 'insertAll', start: 500 });
			const shifted = await destination.request({ kind: 'clips', revision: 7, trackId: auxiliary, offset: 0 });
			assert.deepEqual(shifted.clips.map(({ start, end, sourceOffset }) => [start, end, sourceOffset]), [[100, 500, 0], [601, 713, 400]]);
		} finally { await destination.close(); }

		const lowerRate = launchTracktionPeer({ ...launch, projectDirectory: join(root, 'lower-rate'), mode: 'create', sampleRate: 44_100 });
		try {
			const [track] = (await lowerRate.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await lowerRate.request({ kind: 'pasteRange', revision: 0, trackId: track.id, mode: 'overlap', start: 17 });
			const { clips } = await lowerRate.request({ kind: 'clips', revision: 1, trackId: track.id, offset: 0 });
			assert.deepEqual(clips.map(({ start, end, sourceOffset }) => [start, end, sourceOffset]), [[17, 110, 64]]);
		} finally { await lowerRate.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});
