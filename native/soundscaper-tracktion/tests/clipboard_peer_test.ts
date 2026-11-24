/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion clipboard test through CTest.');

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
