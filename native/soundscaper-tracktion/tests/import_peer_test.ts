/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';
import './project_persistence_peer_test.ts';
import { wavFixture } from './wave_fixture.ts';

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
