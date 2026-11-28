/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { TracktionRejectedCommand } from '../../../desktop/tracktion-peer-contract.ts';
import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import type { TracktionProjectPage } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';
import { wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion persistence tests through CTest.');

test('Tracktion preserves a reopenable Edit when Save or ZIP exceeds the Edit limit', {
	skip: process.env.SOUNDSCAPER_TRACKTION_TEST_PROJECT_SIZE !== '1',
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-oversized-save-'));
	const projectDirectory = join(root, 'project');
	const exchangeDirectory = join(root, 'exchange');
	const edit = join(projectDirectory, 'project.tracktionedit');
	const launch = { executable, projectDirectory, exchangeDirectory, stateDirectory: join(root, 'settings') };
	const project = { kind: 'project', offset: 0 } as const;
	const output = join(exchangeDirectory, 'output');
	const limit = 16 * 1024 * 1024;
	const archive = { kind: 'archive', asset: 'b'.repeat(32) } as const;
	try {
		const asset = 'a'.repeat(32);
		const input = join(exchangeDirectory, 'input');
		await Promise.all([mkdir(input, { recursive: true }), mkdir(output, { recursive: true })]);
		await writeFile(join(input, `${asset}.wav`), wavFixture());
		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		let savedTracks: TracktionProjectPage['tracks'];
		try {
			const [track] = (await peer.request(project)).tracks;
			assert.ok(track);
			const audio = await peer.request({ kind: 'importFile', trackId: track.id, revision: 0, asset, name: '&'.repeat(128), start: 0 });
			assert.ok(audio.itemId);
			let revision = audio.revision;
			for (let index = 1; index < 1500; index += 1) {
				({ revision } = await peer.request({ kind: 'duplicateClip', revision, trackId: track.id, clipId: audio.itemId, start: index * 64 }));
			}
			await peer.request({ kind: 'save', revision });
			let previous = await readFile(edit);
			let rejected = false;
			for (let index = 0; index < 30; index += 1) {
				({ revision } = await peer.request({ kind: 'duplicateTrack', revision, trackId: track.id }));
				const before = await peer.request(project);
				let refusal: unknown;
				await peer.request({ kind: 'save', revision }).catch((error: unknown) => { refusal = error; });
				const attempted = await readFile(edit);
				assert.ok(attempted.length <= limit, `Save published an Edit of ${attempted.length} bytes that Open cannot read.`);
				if (!refusal) {
					previous = attempted;
					continue;
				}
				assert.ok(refusal instanceof TracktionRejectedCommand);
				assert.match(refusal.message, /Tracktion Edit exceeds the 16 MiB limit/u);
				assert.deepEqual(attempted, previous);
				await assert.rejects(peer.request({ ...archive, revision }), /Tracktion Edit exceeds the 16 MiB limit/u);
				assert.deepEqual(await readdir(output), []);
				assert.deepEqual(await peer.request(project), before);
				rejected = true;
				break;
			}
			assert.ok(rejected, 'The fixture exceeded the Edit size limit.');
			({ revision } = await peer.request({ kind: 'undo', revision }));
			const restored = await peer.request(project);
			assert.equal(restored.canRedo, true);
			savedTracks = restored.tracks;
			await peer.request({ kind: 'save', revision });
			await peer.request({ ...archive, revision });
			assert.ok((await readFile(join(output, `${archive.asset}.zip`))).length > 0);
		} finally { await peer.close(); }
		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			assert.deepEqual((await reopened.request(project)).tracks, savedTracks);
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('a short Tracktion Save preserves the existing file and the unsaved Edit', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-short-save-'));
	const limited = join(root, 'limited-peer');
	const exchangeDirectory = join(root, 'exchange');
	const projectDirectory = join(root, 'project');
	const edit = join(projectDirectory, 'project.tracktionedit');
	const launch = { projectDirectory, exchangeDirectory, stateDirectory: join(root, 'state') };
	const project = { kind: 'project', offset: 0 } as const;
	try {
		await mkdir(exchangeDirectory);
		await writeFileSizeLimitedPeer(limited, 2);
		const peer = launchTracktionPeer({ ...launch, executable: limited, mode: 'create', sampleRate: 48_000 });
		try {
			await peer.request({ kind: 'save', revision: 0 });
			const saved = await readFile(edit);
			assert.ok(saved.length < 2048);
			let revision = 0;
			for (let index = 0; index < 5; index += 1) {
				({ revision } = await peer.request({ kind: 'addTrack', revision, name: `Added ${index + 1}` }));
			}
			const before = await peer.request(project);
			let refusal: unknown;
			await peer.request({ kind: 'save', revision }).catch((error: unknown) => { refusal = error; });
			const afterSave = await readFile(edit);
			assert.equal(afterSave.length, saved.length, 'The short write must leave the complete prior Edit on disk.');
			assert.deepEqual(afterSave, saved);
			assert.ok(refusal instanceof TracktionRejectedCommand);
			assert.match(refusal.message, /Cannot save the Tracktion Edit/u);
			assert.deepEqual(await peer.request(project), before);
			for (let index = 0; index < 4; index += 1) {
				({ revision } = await peer.request({ kind: 'undo', revision }));
			}
			await peer.request({ kind: 'save', revision });
			assert.equal((await peer.request(project)).canRedo, true);
		} finally { await peer.close(); }
		const reopened = launchTracktionPeer({ ...launch, executable, mode: 'open' });
		try {
			assert.deepEqual((await reopened.request(project)).tracks.map(({ name }) => name), ['Track 1', 'Added 1']);
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('a short initial Tracktion Save preserves the prior desktop Edit and leaves Create retryable', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-short-create-'));
	const original = join(root, 'original');
	const next = join(root, 'next');
	const nonempty = join(root, 'nonempty');
	const limited = join(root, 'limited-peer');
	const owner = {};
	let selected = original;
	let peerExecutable = executable;
	const create = { kind: 'create', sampleRate: 48_000 } as const;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'),
		isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => selected,
		chooseOpenProject: async () => join(selected, 'project.tracktionedit'),
		chooseWave: async () => null,
		chooseExport: async () => null,
		startPeer: async (options) => launchTracktionPeer({ ...options, executable: peerExecutable }),
	});
	try {
		await Promise.all([mkdir(original), mkdir(next), mkdir(join(nonempty, 'media'), { recursive: true })]);
		await writeFileSizeLimitedPeer(limited, 1);
		const opened = await service.request(owner, create);
		assert.ok(opened && 'sessionId' in opened);
		const { sessionId } = opened;
		await service.request(owner, { kind: 'addTrack', sessionId, revision: 0, name: 'Unsaved witness' });
		const current = { kind: 'project', sessionId, offset: 0 } as const;
		const before = await service.request(owner, current);
		assert.ok(before && 'tracks' in before && before.canUndo);

		selected = nonempty;
		await assert.rejects(service.request(owner, create));
		assert.deepEqual(await readdir(nonempty), ['media']);
		assert.deepEqual(await service.request(owner, current), before);

		selected = next;
		peerExecutable = limited;
		await assert.rejects(service.request(owner, create), /Cannot save the Tracktion Edit/u);
		assert.deepEqual(await service.request(owner, current), before);
		assert.deepEqual(await readdir(next), []);

		await service.request(owner, { kind: 'save', sessionId, revision: before.revision });
		peerExecutable = executable;
		const replacement = await service.request(owner, create);
		assert.ok(replacement && 'sessionId' in replacement && replacement.sessionId !== sessionId);
		await service.request(owner, { kind: 'close', sessionId: replacement.sessionId });
		const reopened = await service.request(owner, { kind: 'open' });
		assert.ok(reopened && 'sessionId' in reopened);
		assert.deepEqual(reopened.project, replacement.project);
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});

for (const command of ['open', 'save'] as const) {
	test(`desktop Tracktion ${command} detects a saved Edit replaced outside the editor`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-external-edit-'));
		const projectDirectory = join(root, 'current');
		const mirror = join(root, 'external');
		const edit = join(projectDirectory, 'project.tracktionedit');
		const externalEdit = join(mirror, 'project.tracktionedit');
		const owner = {};
		const service = new TracktionProjectService({
			scratchRoot: join(root, 'scratch'), isOwnerCurrent: (caller) => caller === owner,
			chooseCreateDirectory: async () => projectDirectory, chooseOpenProject: async () => edit,
			chooseWave: async () => null, chooseExport: async () => null,
			startPeer: async (options) => launchTracktionPeer({ ...options, executable }),
		});
		try {
			await mkdir(projectDirectory);
			const original = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
			assert.ok(original && 'sessionId' in original);
			const { sessionId } = original;
			const saved = await service.request(owner, { kind: 'addTrack', sessionId, revision: 0, name: 'Saved track' });
			assert.ok(saved && 'itemId' in saved);
			await service.request(owner, { kind: 'save', sessionId, revision: saved.revision });
			const same = await service.request(owner, { kind: 'open' });
			assert.ok(same && 'sessionId' in same);
			assert.equal(same.sessionId, sessionId, 'an unchanged saved file keeps the current Edit and history');
			assert.equal(same.project.canUndo, true);
			if (command === 'save') {
				await service.request(owner, { kind: 'addTrack', sessionId, revision: saved.revision, name: 'Unsaved track' });
			}
			const project = { kind: 'project', sessionId, offset: 0 } as const;
			const before = await service.request(owner, project);
			assert.ok(before && 'tracks' in before);

			await cp(projectDirectory, mirror, { recursive: true });
			const exchangeDirectory = join(root, 'external-exchange');
			await mkdir(exchangeDirectory);
			const external = launchTracktionPeer({ executable, mode: 'open', projectDirectory: mirror,
				exchangeDirectory, stateDirectory: join(root, 'external-state') });
			try {
				const updated = await external.request({ kind: 'addTrack', revision: 0, name: 'External track' });
				await external.request({ kind: 'save', revision: updated.revision });
			} finally { await external.close(); }
			const replacement = await readFile(externalEdit);
			await rename(externalEdit, edit);
			if (command === 'save') {
				await assert.rejects(service.request(owner, { kind: 'save', sessionId, revision: before.revision }), /changed on disk/u);
				assert.deepEqual(await readFile(edit), replacement);
				assert.deepEqual(await service.request(owner, project), before);
			}

			const refreshed = await service.request(owner, { kind: 'open' });
			assert.ok(refreshed && 'sessionId' in refreshed);
			assert.notEqual(refreshed.sessionId, sessionId);
			assert.deepEqual(refreshed.project.tracks.map(({ name }) => name), ['Track 1', 'Saved track', 'External track']);
			await assert.rejects(service.request(owner, project), /handle has expired/u);
			assert.deepEqual(await readFile(edit), replacement);
			if (command === 'open') {
				await rename(edit, externalEdit);
				await service.request(owner, { kind: 'save', sessionId: refreshed.sessionId, revision: refreshed.project.revision });
				const restored = await service.request(owner, { kind: 'open' });
				assert.ok(restored && 'sessionId' in restored);
				assert.equal(restored.sessionId, refreshed.sessionId, 'Save recreates a missing Edit and updates its stored identity');
			}
		} finally {
			try { await service.dispose(); }
			finally { await rm(root, { recursive: true, force: true }); }
		}
	});
}
