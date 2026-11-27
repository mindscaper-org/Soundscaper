/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import type { TracktionEditResult } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the peer test through CTest.');

const asset = '0123456789abcdef'.repeat(2);

test('Tracktion fits 64 tracks with fully escaped names in one reply', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-track-pages-'));
	try {
		const exchangeDirectory = join(root, 'exchange');
		await mkdir(exchangeDirectory);
		const peer = launchTracktionPeer({ executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') });
		try {
			const tracks = [];
			for (let revision = 0; revision < 65; revision += 1) {
				const name = '\u0001'.repeat(61) + String(revision).padStart(3, '0');
				const { itemId } = await peer.request({ kind: 'addTrack', revision, name });
				assert.ok(itemId);
				tracks.push({ id: itemId, name, clipCount: 0 });
			}
			const first = await peer.request({ kind: 'project', offset: 1 });
			assert.equal(first.revision, 65);
			assert.equal(first.tracks.length, 64);
			assert.deepEqual(first.tracks, tracks.slice(0, 64));
			assert.equal(first.nextOffset, 65);
			const last = await peer.request({ kind: 'project', offset: 65 });
			assert.equal(last.revision, first.revision);
			assert.deepEqual(last.tracks, tracks.slice(64));
			assert.equal(last.nextOffset, null);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion returns stable clip pages and rejects offsets beyond their end', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-page-'));
	const exchangeDirectory = join(root, 'exchange');
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture());
		const peer = launchTracktionPeer({ executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') });
		try {
			const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			const trackId = track.id;
			const { itemId: clipId } = await peer.request({ kind: 'import', revision: 0, trackId, asset,
				name: 'Paged clip', start: 0, sourceOffset: 5, frames: 52 });
			assert.ok(clipId);
			const clipIds = [clipId];
			for (let index = 1; index <= 32; index += 1) {
				const duplicate: TracktionEditResult = await peer.request({ kind: 'duplicateClip', revision: index, trackId, clipId, start: index * 64 });
				assert.ok(duplicate.itemId);
				clipIds.push(duplicate.itemId);
			}
			const revision = 33;
			const summary = await peer.request({ kind: 'project', offset: 0 });
			assert.deepEqual(summary.tracks, [{ ...track, clipCount: revision }]);
			const clipPage = { kind: 'clips', revision, trackId } as const;
			const first = await peer.request({ ...clipPage, offset: 0 });
			assert.equal(first.revision, revision);
			assert.equal(first.nextOffset, 32);
			const last = await peer.request({ ...clipPage, offset: 32 });
			assert.equal(last.revision, revision);
			assert.equal(last.nextOffset, null);
			assert.deepEqual([...first.clips, ...last.clips], clipIds.map((id, index) => ({
				id, name: 'Paged clip', start: index * 64, end: index * 64 + 52, sourceOffset: 5,
			})));
			assert.deepEqual(await peer.request({ ...clipPage, offset: revision }), { revision, clips: [], nextOffset: null });
			await assert.rejects(peer.request({ ...clipPage, offset: revision + 1 }), /clip page/u);
			await assert.rejects(peer.request({ ...clipPage, trackId: '18446744073709551615', offset: 0 }), /clip page/u);
			await assert.rejects(peer.request({ ...clipPage, revision: revision - 1, offset: 32 }), /revision/u);
			assert.deepEqual((await peer.request({ kind: 'project', offset: 1 })).tracks, []);
			await assert.rejects(peer.request({ kind: 'project', offset: 2 }), /track page/u);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});
