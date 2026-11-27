/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import type { TracktionClipPage, TracktionEditResult, TracktionProjectPage } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the peer test through CTest.');

const asset = '0123456789abcdef'.repeat(2);

test('a full Tracktion clip lane survives a refused split and can split after freeing a slot', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-clip-limit-'));
	const exchangeDirectory = join(root, 'exchange');
	const launch = { executable, exchangeDirectory, projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') };
	const source = wavFixture();
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await mkdir(join(exchangeDirectory, 'output'));
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), source);
		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		let trackId: string;
		let expected: TracktionClipPage['clips'];
		try {
			const project = { kind: 'project', offset: 0 } as const;
			const [track] = (await peer.request(project)).tracks;
			assert.ok(track);
			trackId = track.id;
			await peer.request({ kind: 'save', revision: 0 });
			const imported = await peer.request({ kind: 'importFile', trackId, revision: 0, asset, name: 'Unsaved audio', start: 0 });
			assert.ok(imported.itemId);
			const clipId = imported.itemId;
			let revision = imported.revision;
			for (let index = 1; index < 1500; index += 1) {
				({ revision } = await peer.request({ kind: 'duplicateClip', revision, trackId, clipId, start: index * 64 }));
			}
			({ revision } = await peer.request({ kind: 'addTrack', revision, name: 'Redo witness' }));
			({ revision } = await peer.request({ kind: 'undo', revision }));
			const before = await peer.request(project);
			assert.ok(before.canUndo && before.canRedo);
			const clips = await readClipPages(peer, trackId, revision);
			assert.equal(clips.length, 1500);
			const split = { kind: 'split', clipId, frame: 32 } as const;
			await assert.rejects(peer.request({ ...split, revision }), /Tracktion (?:refused|session)/u);
			assert.deepEqual(await peer.request(project), before);
			assert.deepEqual(await readClipPages(peer, trackId, revision), clips);

			({ revision } = await peer.request({ kind: 'redo', revision }));
			assert.equal((await peer.request(project)).tracks[1]?.name, 'Redo witness');
			({ revision } = await peer.request({ kind: 'undo', revision }));
			const last = clips.at(-1);
			assert.ok(last);
			({ revision } = await peer.request({ kind: 'deleteClip', revision, clipId: last.id }));
			const applied = await peer.request({ ...split, revision });
			assert.ok(applied.itemId);
			expected = await readClipPages(peer, trackId, applied.revision);
			assert.deepEqual(expected.slice(0, 2), [
				{ id: clipId, name: 'Unsaved audio', start: 0, end: 32, sourceOffset: 0 },
				{ id: applied.itemId, name: 'Unsaved audio', start: 32, end: 64, sourceOffset: 32 },
			]);
			assert.deepEqual(expected.slice(2), clips.slice(1, -1));
			await peer.request({ kind: 'save', revision: applied.revision });
		} finally { await peer.close(); }

		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			assert.deepEqual(await readClipPages(reopened, trackId, 0), expected);
			await reopened.request({ kind: 'render', revision: 0, asset, start: 0, end: 64 });
			const pcm = waveData(await readFile(join(exchangeDirectory, 'output', `${asset}.wav`)));
			assert.deepEqual(pcm, waveData(source));
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

async function readClipPages(peer: ReturnType<typeof launchTracktionPeer>, trackId: string, revision: number) {
	const clips: TracktionClipPage['clips'][number][] = [];
	for (let offset: number | null = 0; offset !== null;) {
		const page: TracktionClipPage = await peer.request({ kind: 'clips', trackId, revision, offset });
		clips.push(...page.clips);
		offset = page.nextOffset;
	}
	return clips;
}

test('Tracktion trim acknowledges the revised clip and its ordered position', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-trim-reply-'));
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
			const { itemId: clipId } = await peer.request({ kind: 'importFile', revision: 0, trackId, asset, name: 'Earlier', start: 0 });
			assert.ok(clipId);
			await peer.request({ kind: 'duplicateClip', revision: 1, trackId, clipId, start: 16 });
			const before = await readClipPages(peer, trackId, 2);
			const trim = { kind: 'trim', clipId, start: 32, end: 63 } as const;
			const result = await peer.request({ ...trim, revision: 2 });
			const clip = { id: clipId, name: 'Earlier', start: 32, end: 63, sourceOffset: 32 };
			assert.deepEqual(result, { revision: 3, itemId: null, history: { canUndo: true, canRedo: false }, trimmedClip: { clip, index: 1 } });
			assert.deepEqual(await readClipPages(peer, trackId, 3), [before[1], clip]);
			assert.deepEqual(await peer.request({ ...trim, revision: 3 }), { revision: 3, itemId: null });
			await peer.request({ kind: 'undo', revision: 3 });
			assert.deepEqual(await readClipPages(peer, trackId, 4), before);
			await peer.request({ kind: 'redo', revision: 4 });
			assert.deepEqual(await readClipPages(peer, trackId, 5), [before[1], clip]);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('a full Tracktion Edit survives a refused Add Track with its audio and history', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-track-limit-'));
	const exchangeDirectory = join(root, 'exchange');
	const launch = { executable, exchangeDirectory, projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') };
	const source = wavFixture();
	const output = 'f'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await mkdir(join(exchangeDirectory, 'output'));
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), source);
		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		let expected: TracktionProjectPage['tracks'];
		try {
			const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await peer.request({ kind: 'save', revision: 0 });
			const imported = await peer.request({ kind: 'import', trackId: track.id, revision: 0, asset,
				name: 'Unsaved audio', start: 37, sourceOffset: 5, frames: 52 });
			let revision = imported.revision;
			// The pinned Tracktion limit of 400 includes five internal tracks.
			for (let index = 1; index <= 394; index += 1) {
				({ revision } = await peer.request({ kind: 'addTrack', revision, name: `Unsaved ${index}` }));
			}
			({ revision } = await peer.request({ kind: 'setTrackMix', revision, trackId: track.id,
				gainDb: 0, pan: 0, muted: true, solo: false }));
			({ revision } = await peer.request({ kind: 'undo', revision }));
			const before = await readTrackPages(peer);
			assert.ok(before[0]?.canUndo && before[0].canRedo);
			expected = before.flatMap((page) => page.tracks);
			assert.equal(expected.length, 395);

			await assert.rejects(peer.request({ kind: 'addTrack', revision, name: 'Beyond the limit' }), /Tracktion (?:refused|session)/u);
			assert.deepEqual(await readTrackPages(peer), before);
			({ revision } = await peer.request({ kind: 'redo', revision }));
			assert.equal((await peer.request({ kind: 'trackMix', revision, trackId: track.id })).muted, true);
			({ revision } = await peer.request({ kind: 'undo', revision }));
			await peer.request({ kind: 'save', revision });
		} finally { await peer.close(); }

		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			assert.deepEqual((await readTrackPages(reopened)).flatMap((page) => page.tracks), expected);
			await reopened.request({ kind: 'render', revision: 0, asset: output });
			const pcm = waveData(await readFile(join(exchangeDirectory, 'output', `${output}.wav`)));
			assert.deepEqual(pcm, Buffer.concat([Buffer.alloc(37 * 4), waveData(source).subarray(5 * 4, 57 * 4)]));
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

async function readTrackPages(peer: ReturnType<typeof launchTracktionPeer>): Promise<TracktionProjectPage[]> {
	const pages: TracktionProjectPage[] = [];
	for (let offset: number | null = 0; offset !== null;) {
		const page: TracktionProjectPage = await peer.request({ kind: 'project', offset });
		pages.push(page);
		offset = page.nextOffset;
	}
	return pages;
}

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
