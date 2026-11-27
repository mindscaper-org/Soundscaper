/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import { wavFixture } from './wave_fixture.ts';

export async function exerciseInterruptedExport(executable: string, kind: 'render' | 'archive') {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-interrupted-export-'));
	const owner = {};
	const project = join(root, 'project');
	const media = join(project, 'media');
	const offline = join(root, 'offline-media');
	const sourcePath = join(root, 'source.wav');
	const extension = kind === 'render' ? 'wav' : 'zip';
	const source = wavFixture(4800);
	const output = join(root, `output.${extension}`);
	let destination = join(root, `reference.${extension}`);
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'),
		isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => project,
		chooseOpenProject: async () => null,
		chooseWave: async () => sourcePath,
		chooseExport: async () => destination,
		startPeer: async (options) => launchTracktionPeer({ ...options, executable }),
	});
	try {
		await mkdir(project);
		await writeFile(sourcePath, source);
		const created = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
		assert.ok(created && 'sessionId' in created);
		const { sessionId } = created;
		const [track] = created.project.tracks;
		assert.ok(track);
		const imported = await service.request(owner, { kind: 'import', sessionId, revision: 0, trackId: track.id, start: 64 });
		assert.ok(imported && 'itemId' in imported && imported.itemId);
		await service.request(owner, { kind: 'addTrack', sessionId, revision: imported.revision, name: 'Redo witness' });
		await service.request(owner, { kind: 'undo', sessionId, revision: imported.revision + 1 });
		const status = { kind: 'project', sessionId, offset: 0 } as const;
		const before = await service.request(owner, status);
		assert.ok(before && 'tracks' in before && before.canUndo && before.canRedo);
		const files = await readdir(media);
		assert.equal(files.length, 1);
		const [mediaFile] = files;
		assert.ok(mediaFile);
		const exportProject = { kind, sessionId, revision: before.revision } as const;
		await service.request(owner, exportProject);
		const reference = await readFile(destination);

		await rename(media, offline);
		try {
			destination = output;
			await assert.rejects(service.request(owner, exportProject), /Tracktion (?:project media|session)/u);
			await assert.rejects(readFile(output), { code: 'ENOENT' });
			assert.deepEqual(await service.request(owner, status), before);
		} finally { await rename(offline, media); }

		await service.request(owner, exportProject);
		const retried = await readFile(output);
		const redone = await service.request(owner, { kind: 'redo', sessionId, revision: before.revision });
		assert.deepEqual(redone, { revision: before.revision + 1, itemId: null });
		const after = await service.request(owner, status);
		assert.ok(after && 'tracks' in after);
		assert.equal(after.tracks[1]?.name, 'Redo witness');
		return { reference, retried, source, mediaPath: `media/${mediaFile}` };
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
}
