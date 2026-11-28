/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { TracktionRejectedCommand } from '../../../desktop/tracktion-peer-contract.ts';
import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import type { TracktionClipView } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';
import './mixed_rate_peer_test.ts';
import './project_persistence_peer_test.ts';
import './rf64_peer_test.ts';
import { wavFixture } from './wave_fixture.ts';

test('desktop WAV import survives a temporary project media outage and keeps the unsaved Edit', async () => {
	const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
	assert.ok(executable, 'build the Tracktion peer first');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-media-outage-'));
	const owner = {};
	const project = join(root, 'project');
	const media = join(project, 'media');
	const offline = join(root, 'offline-media');
	const original = join(root, 'original.wav');
	const incoming = join(root, 'incoming.wav');
	const source = wavFixture(96);
	let selected = original;
	let exchange: string | undefined;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'), isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => project, chooseOpenProject: async () => join(project, 'project.tracktionedit'),
		chooseWave: async () => selected, chooseExport: async () => null,
		startPeer: async (options) => {
			exchange = options.exchangeDirectory;
			return launchTracktionPeer({ ...options, executable });
		},
	});
	try {
		await mkdir(project);
		await Promise.all([writeFile(original, wavFixture()), writeFile(incoming, source)]);
		const opened = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
		assert.ok(opened && 'sessionId' in opened && exchange);
		const { sessionId } = opened;
		const [track] = opened.project.tracks;
		assert.ok(track);
		const trackId = track.id;
		const imported = await service.request(owner, { kind: 'import', sessionId, trackId, revision: 0, start: 0 });
		assert.ok(imported && 'itemId' in imported && imported.itemId);
		await service.request(owner, { kind: 'save', sessionId, revision: imported.revision });
		const duplicate = await service.request(owner, { kind: 'duplicateClip', sessionId, trackId,
			revision: imported.revision, clipId: imported.itemId, start: 128 });
		assert.ok(duplicate && 'itemId' in duplicate);
		const witness = await service.request(owner, { kind: 'addTrack', sessionId, revision: duplicate.revision, name: 'Redo witness' });
		assert.ok(witness && 'itemId' in witness);
		await service.request(owner, { kind: 'undo', sessionId, revision: witness.revision });
		const projectPage = { kind: 'project', sessionId, offset: 0 } as const;
		const before = await service.request(owner, projectPage);
		assert.ok(before && 'tracks' in before && before.canUndo && before.canRedo);
		assert.equal(before.tracks[0]?.clipCount, 2);
		const clips = { kind: 'clips', sessionId, trackId, revision: before.revision, offset: 0 } as const;
		const beforeClips = await service.request(owner, clips);
		assert.ok(beforeClips && 'clips' in beforeClips);
		const existing = await readdir(media);
		const command = { kind: 'import', sessionId, trackId, start: 256 } as const;

		selected = incoming;
		await rename(media, offline);
		try {
			await assert.rejects(service.request(owner, { ...command, revision: before.revision }),
				(error: unknown) => error instanceof TracktionRejectedCommand && /project media directory is unavailable/u.test(error.message));
			assert.deepEqual(await service.request(owner, projectPage), before);
			assert.deepEqual(await service.request(owner, clips), beforeClips);
			assert.deepEqual(await readdir(join(exchange, 'input')), []);
		} finally { await rename(offline, media); }

		assert.deepEqual(await readdir(media), existing);
		const redone = await service.request(owner, { kind: 'redo', sessionId, revision: before.revision });
		assert.ok(redone && 'itemId' in redone);
		const retried = await service.request(owner, { ...command, revision: redone.revision });
		assert.ok(retried && 'itemId' in retried && retried.itemId);
		const adopted = (await readdir(media)).find((file) => !existing.includes(file));
		assert.ok(adopted);
		assert.deepEqual(await readFile(join(media, adopted)), source);
		await service.request(owner, { kind: 'save', sessionId, revision: retried.revision });
		await service.request(owner, { kind: 'close', sessionId });
		const reopened = await service.request(owner, { kind: 'open' });
		assert.ok(reopened && 'sessionId' in reopened);
		assert.equal(reopened.project.tracks[1]?.name, 'Redo witness');
		const reopenedClips = await service.request(owner, { ...clips, sessionId: reopened.sessionId, revision: reopened.project.revision });
		assert.ok(reopenedClips && 'clips' in reopenedClips);
		assert.deepEqual(reopenedClips.clips, [...beforeClips.clips,
			{ id: retried.itemId, name: 'incoming', start: 256, end: 352, sourceOffset: 0 }]);
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});

test('desktop WAV import into a full Tracktion track preserves the Edit and retries after freeing a slot', async () => {
	const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
	assert.ok(executable, 'build the Tracktion peer first');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-full-import-'));
	const owner = {};
	const project = join(root, 'project');
	const media = join(project, 'media');
	const original = join(root, 'original.wav');
	const incoming = join(root, 'incoming.wav');
	const originalAudio = wavFixture();
	const incomingAudio = wavFixture(96);
	let selected = original;
	let exchange: string | undefined;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'), isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => project,
		chooseOpenProject: async () => join(project, 'project.tracktionedit'),
		chooseWave: async () => selected, chooseExport: async () => null,
		startPeer: async (options) => {
			exchange = options.exchangeDirectory;
			return launchTracktionPeer({ ...options, executable });
		},
	});
	try {
		await mkdir(project);
		await Promise.all([writeFile(original, originalAudio), writeFile(incoming, incomingAudio)]);
		const opened = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
		assert.ok(opened && 'sessionId' in opened && exchange);
		const { sessionId } = opened;
		const [track] = opened.project.tracks;
		assert.ok(track);
		const trackId = track.id;
		const readClips = async (activeSession: string, revision: number): Promise<TracktionClipView[]> => {
			const clips: TracktionClipView[] = [];
			for (let offset: number | null = 0; offset !== null;) {
				const page = await service.request(owner, { kind: 'clips', sessionId: activeSession, trackId, revision, offset });
				assert.ok(page && 'clips' in page);
				clips.push(...page.clips);
				offset = page.nextOffset;
			}
			return clips;
		};
		const imported = await service.request(owner, { kind: 'import', sessionId, revision: 0, trackId, start: 0 });
		assert.ok(imported && 'itemId' in imported && imported.itemId);
		const clips = [{ id: imported.itemId, name: 'original', start: 0, end: 64, sourceOffset: 0 }];
		let revision = imported.revision;
		for (let index = 1; index < 1500; index += 1) {
			const copy = await service.request(owner, { kind: 'duplicateClip', sessionId, revision, trackId,
				clipId: imported.itemId, start: index * 64 });
			assert.ok(copy && 'itemId' in copy && copy.itemId);
			clips.push({ id: copy.itemId, name: 'original', start: index * 64, end: (index + 1) * 64, sourceOffset: 0 });
			revision = copy.revision;
		}
		const witness = await service.request(owner, { kind: 'addTrack', sessionId, revision, name: 'Redo witness' });
		assert.ok(witness && 'itemId' in witness);
		await service.request(owner, { kind: 'undo', sessionId, revision: witness.revision });
		const status = { kind: 'project', sessionId, offset: 0 } as const;
		const before = await service.request(owner, status);
		assert.ok(before && 'tracks' in before && before.canUndo && before.canRedo);
		assert.equal(before.tracks[0]?.clipCount, clips.length);
		const previousMedia = await readdir(media);
		assert.equal(previousMedia.length, 1);
		const [storedOriginal] = previousMedia;
		assert.ok(storedOriginal);

		selected = incoming;
		const command = { kind: 'import', sessionId, trackId, start: 96_000 } as const;
		await assert.rejects(service.request(owner, { ...command, revision: before.revision }), /Tracktion (?:refused the audio clip|session)/u);
		assert.deepEqual(await readdir(media), previousMedia);
		assert.deepEqual(await readFile(join(media, storedOriginal)), originalAudio);
		assert.deepEqual(await readFile(incoming), incomingAudio);
		assert.deepEqual(await readdir(join(exchange, 'input')), []);
		assert.deepEqual(await service.request(owner, status), before);
		assert.deepEqual(await readClips(sessionId, before.revision), clips);

		const redone = await service.request(owner, { kind: 'redo', sessionId, revision: before.revision });
		assert.ok(redone && 'itemId' in redone);
		const afterRedo = await service.request(owner, status);
		assert.ok(afterRedo && 'tracks' in afterRedo);
		assert.equal(afterRedo.tracks[1]?.name, 'Redo witness');
		const last = clips.at(-1);
		assert.ok(last);
		const removed = await service.request(owner, { kind: 'deleteClip', sessionId, revision: redone.revision, clipId: last.id });
		assert.ok(removed && 'itemId' in removed);
		const retried = await service.request(owner, { ...command, revision: removed.revision });
		assert.ok(retried && 'itemId' in retried && retried.itemId);
		const expected = [...clips.slice(0, -1), { id: retried.itemId, name: 'incoming', start: 96_000, end: 96_096, sourceOffset: 0 }];
		assert.deepEqual(await readClips(sessionId, retried.revision), expected);
		const storedIncoming = (await readdir(media)).find((file) => file !== storedOriginal);
		assert.ok(storedIncoming);
		assert.deepEqual(await readFile(join(media, storedIncoming)), incomingAudio);
		assert.deepEqual(await readdir(join(exchange, 'input')), []);
		await service.request(owner, { kind: 'save', sessionId, revision: retried.revision });
		await service.request(owner, { kind: 'close', sessionId });
		const reopened = await service.request(owner, { kind: 'open' });
		assert.ok(reopened && 'sessionId' in reopened);
		assert.deepEqual(await readClips(reopened.sessionId, reopened.project.revision), expected);
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});

test('desktop WAV import rejects incomplete media and can retry with its Edit history intact', {
	skip: process.platform !== 'linux',
}, async () => {
	assert.ok(process.env.SOUNDSCAPER_TRACKTION_TEST_PEER, 'build the Tracktion peer first');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-import-'));
	const owner = {};
	const project = join(root, 'project');
	const media = join(project, 'media');
	const limitedPeer = join(root, 'limited-peer');
	const oversizedPath = join(root, 'large.wav');
	const validPath = join(root, 'short.wav');
	let selected = oversizedPath;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'),
		isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => project,
		chooseOpenProject: async () => null,
		chooseWave: async () => selected,
		chooseExport: async () => null,
		startPeer: async (options) => launchTracktionPeer({ ...options, executable: limitedPeer }),
	});
	try {
		await writeFileSizeLimitedPeer(limitedPeer);
		await mkdir(project);
		const oversized = wavFixture(524_288);
		const valid = wavFixture();
		await writeFile(oversizedPath, oversized);
		await writeFile(validPath, valid);
		const created = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
		assert.ok(created && 'sessionId' in created);
		const { sessionId } = created;
		const [track] = created.project.tracks;
		assert.ok(track);
		await service.request(owner, { kind: 'addTrack', sessionId, revision: 0, name: 'Redo witness' });
		await service.request(owner, { kind: 'undo', sessionId, revision: 1 });
		const page = { kind: 'project', sessionId, offset: 0 } as const;
		const before = await service.request(owner, page);
		assert.ok(before && 'tracks' in before && before.canRedo);
		const importWave = { kind: 'import', sessionId, revision: before.revision, trackId: track.id, start: 23 } as const;
		await assert.rejects(service.request(owner, importWave), /Cannot copy the audio into the project/u);
		assert.deepEqual(await service.request(owner, page), before);
		assert.deepEqual(await readdir(media), []);
		assert.deepEqual(await readFile(oversizedPath), oversized);

		selected = validPath;
		const imported = await service.request(owner, importWave);
		assert.ok(imported && 'itemId' in imported && imported.itemId);
		assert.equal(imported.revision, before.revision + 1);
		const [stored] = await readdir(media);
		assert.ok(stored);
		assert.deepEqual(await readFile(join(media, stored)), valid);
		assert.deepEqual(await service.request(owner, { kind: 'clips', sessionId, revision: imported.revision, trackId: track.id, offset: 0 }), {
			revision: imported.revision, nextOffset: null,
			clips: [{ id: imported.itemId, name: 'short', start: 23, end: 87, sourceOffset: 0 }],
		});
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});
