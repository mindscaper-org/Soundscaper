/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { unzipSync } from 'fflate';

import { TracktionRejectedCommand } from '../../../desktop/tracktion-peer-contract.ts';
import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import { exerciseInterruptedExport } from './export_peer_fixture.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';
import { wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion archive test through CTest.');

test('desktop Tracktion ZIP export refuses unavailable project media and retries with the exact entries', async () => {
	const { reference, retried, source, mediaPath } = await exerciseInterruptedExport(executable, 'archive');
	const entries = unzipSync(retried);
	assert.deepEqual(entries, unzipSync(reference));
	assert.deepEqual(Object.keys(entries).sort(), [mediaPath, 'project.tracktionedit', 'project_info.json']);
	assert.deepEqual(entries[mediaPath], Uint8Array.from(source));
});

test('a short Tracktion ZIP write preserves the previous archive and the live Edit', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-short-archive-'));
	const project = join(root, 'project');
	const limited = join(root, 'limited-peer');
	const edit = join(project, 'project.tracktionedit');
	const output = join(root, 'project.zip');
	const owner = {};
	let nextPeer = limited;
	let source = '';
	let exchange: string | undefined;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'), isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => project, chooseOpenProject: async () => edit,
		chooseWave: async () => source, chooseExport: async () => output,
		startPeer: async (options) => {
			exchange = options.exchangeDirectory;
			return launchTracktionPeer({ ...options, executable: nextPeer });
		},
	});
	try {
		await mkdir(project);
		await writeFileSizeLimitedPeer(limited, 8);
		const opened = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
		assert.ok(opened && 'sessionId' in opened && exchange);
		const { sessionId } = opened;
		const [track] = opened.project.tracks;
		assert.ok(track);
		let revision = 0;
		let previous: Buffer = Buffer.alloc(0);
		for (let index = 0; index < 3; index += 1) {
			const wave = randomFillSync(wavFixture(1000), 44);
			source = join(root, `Source ${index + 1}.wav`);
			await writeFile(source, wave);
			const imported = await service.request(owner, { kind: 'import', sessionId, trackId: track.id, revision, start: index * 1000 });
			assert.ok(imported && 'itemId' in imported && imported.itemId);
			revision = imported.revision;
			if (index === 0) {
				await service.request(owner, { kind: 'archive', sessionId, revision });
				previous = await readFile(output);
				const prior = unzipSync(previous);
				const mediaPath = Object.keys(prior).find((path) => path.startsWith('media/'));
				assert.ok(mediaPath);
				assert.deepEqual(prior[mediaPath], Uint8Array.from(wave));
			}
		}
		const witness = await service.request(owner, { kind: 'addTrack', sessionId, revision, name: 'Redo witness' });
		assert.ok(witness && 'itemId' in witness);
		await service.request(owner, { kind: 'undo', sessionId, revision: witness.revision });
		const page = { kind: 'project', sessionId, offset: 0 } as const;
		const before = await service.request(owner, page);
		assert.ok(before && 'tracks' in before && before.canUndo && before.canRedo);
		assert.equal(before.tracks[0]?.clipCount, 3);
		let refusal: unknown;
		await service.request(owner, { kind: 'archive', sessionId, revision: before.revision }).catch((error: unknown) => { refusal = error; });
		assert.equal((await readFile(output)).length, previous.length, 'A short ZIP write must preserve the previous archive.');
		assert.deepEqual(await readFile(output), previous);
		assert.ok(refusal instanceof TracktionRejectedCommand);
		assert.match(refusal.message, /complete Tracktion archive/u);
		assert.deepEqual(await readdir(join(exchange, 'output')), []);
		assert.deepEqual(await service.request(owner, page), before);
		await service.request(owner, { kind: 'redo', sessionId, revision: before.revision });
		const after = await service.request(owner, page);
		assert.ok(after && 'tracks' in after);
		assert.equal(after.tracks[1]?.name, 'Redo witness');
		await service.request(owner, { kind: 'save', sessionId, revision: after.revision });
		await service.request(owner, { kind: 'close', sessionId });

		nextPeer = executable;
		const reopened = await service.request(owner, { kind: 'open' });
		assert.ok(reopened && 'sessionId' in reopened);
		assert.deepEqual(reopened.project.tracks, after.tracks);
		await service.request(owner, { kind: 'archive', sessionId: reopened.sessionId, revision: reopened.project.revision });
		const entries = unzipSync(await readFile(output));
		const media = join(project, 'media');
		const files = await readdir(media);
		assert.equal(files.length, 3);
		assert.deepEqual(Object.keys(entries).sort(), [...files.map((file) => `media/${file}`), 'project.tracktionedit', 'project_info.json'].sort());
		for (const file of files) assert.deepEqual(entries[`media/${file}`], Uint8Array.from(await readFile(join(media, file))));
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});
