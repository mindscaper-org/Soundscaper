/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { migrateDesktopProjectLibraries } from '../desktop/desktop-project-library-migration.ts';
import {
	createSoundscaperDesktopProjectLibraryHandshake,
	createSoundscaperDesktopProjectLibraryPaths,
} from '../desktop/soundscaper-project-library-contract.ts';
import { SoundscaperDesktopProjectLibraryMain } from '../desktop/soundscaper-project-library-main.ts';
import { createSoundscaperDesktopProjectLibraryTransferBodies } from
	'../desktop/soundscaper-project-library-transfer-contract.ts';
import { TemporaryProjectStorage } from '../desktop/temporary-project-storage.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('a migrated SQLite library reopens with its exact catalog, project and frozen PCM', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-library-migration-roundtrip-'));
	const hosts: SoundscaperDesktopProjectLibraryMain[] = [];
	context.after(async () => {
		for (const host of hosts.reverse()) await host.close();
		await rm(root, { recursive: true, force: true });
	});
	const legacyAppDataPath = join(root, 'config');
	const projectLibraryAppDataPath = join(root, 'data');
	const oldLibrary = join(legacyAppDataPath, 'kw.media', 'soundscaper-project-library', 'v1');
	const originalPaths = createSoundscaperDesktopProjectLibraryPaths(legacyAppDataPath);
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const original = await start(legacyAppDataPath, 'original-library');
	hosts.push(original);
	const originalSession = original.openSession(handshake);
	const pcm = Uint8Array.from({ length: 36 }, (_value, index) => index);
	const project = frozenProject(createHash('sha256').update(pcm).digest('hex'));
	const document = JSON.stringify(project);
	const bodies = createSoundscaperDesktopProjectLibraryTransferBodies(
		project, createHash('sha256').update(document).digest('hex'),
	);
	const publicationId = '1'.repeat(48);
	const admission = await originalSession.beginPublication({
		publicationId,
		expectedMetadataRevision: 0,
		expectedProject: null,
		project,
		bodies,
	});
	assert.deepEqual(admission.requiredBodyIndexes, [0]);
	await originalSession.writePublicationChunk({
		publicationId, bodyIndex: 0, offset: 0, bytes: pcm,
	});
	const committed = await originalSession.finishPublication({ publicationId });
	const catalog = await originalSession.listProjects();
	await originalSession.close();
	await original.close();

	// Close SQLite before any database or media files move.
	await assert.rejects(lstat(`${originalPaths.databasePath}-wal`), { code: 'ENOENT' });
	await assert.rejects(lstat(`${originalPaths.databasePath}-shm`), { code: 'ENOENT' });
	await mkdir(dirname(oldLibrary), { recursive: true });
	await rename(originalPaths.libraryRoot, oldLibrary);
	await migrateDesktopProjectLibraries({
		legacyAppDataPath, projectLibraryAppDataPath, appName: 'Soundscaper',
	});
	await assert.rejects(lstat(oldLibrary), { code: 'ENOENT' });
	const reopened = await start(projectLibraryAppDataPath, 'reopened-library');
	hosts.push(reopened);
	const session = reopened.openSession(handshake);
	assert.deepEqual(await session.listProjects(), catalog);
	const restored = await session.readProjectBundle(String(project.id));
	assert.deepEqual(restored, committed);
	assert.ok(restored);
	assert.equal(restored.document, document);
	const body = restored.bodies[0];
	assert.ok(body);
	assert.deepEqual(await session.readBodyChunk({
		projectId: project.id,
		metadataRevision: restored.metadataRevision,
		projectRevision: restored.project.projectRevision,
		projectSha256: restored.project.sha256,
		body,
		offset: 0,
		length: body.byteLength,
	}), pcm);
});

test('a disconnected active temporary folder preserves its migrated SQLite catalog', async context => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-library-active-disconnected-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const defaultRoot = join(root, 'default'), activeRoot = join(root, 'selected'), offlineRoot = join(root, 'disconnected');
	const configuration = join(root, 'settings.json');
	const temporaryStorage = () => new TemporaryProjectStorage(configuration, defaultRoot, 'Soundscaper');
	await assert.rejects(lstat(defaultRoot), { code: 'ENOENT' });
	const original = await start(await temporaryStorage().prepare(), 'original-library');
	const project = createSoundscaperProject({ id: 'custom-folder-project', title: 'Local work' });
	try {
		const session = original.openSession(createSoundscaperDesktopProjectLibraryHandshake());
		const publicationId = 'a'.repeat(48);
		await session.beginPublication({ publicationId, expectedMetadataRevision: 0, expectedProject: null, project, bodies: [] });
		await session.finishPublication({ publicationId });
		await session.close();
	} finally { await original.close(); }
	await temporaryStorage().select(activeRoot);
	const catalog = await catalogOnStartup('migrated-library');
	assert.deepEqual(catalog.projects.map(row => row.id), [project.id]);
	await rename(activeRoot, offlineRoot);

	await assert.rejects(catalogOnStartup('disconnected-library'), /reconnect the current temporary data folder/iu);
	await assert.rejects(lstat(activeRoot), { code: 'ENOENT' });

	await mkdir(activeRoot);
	await assert.rejects(catalogOnStartup('empty-mountpoint'), /reconnect the current temporary data folder/iu);
	assert.deepEqual(await readdir(activeRoot), []);

	await writeFile(configuration, JSON.stringify({ active: activeRoot, selected: activeRoot, moveStarted: false }));
	await assert.rejects(catalogOnStartup('legacy-empty-mountpoint'), /reconnect the current temporary data folder/iu);
	assert.deepEqual(await readdir(activeRoot), []);
	await rmdir(activeRoot);

	await rename(offlineRoot, activeRoot);
	assert.deepEqual(await catalogOnStartup('reconnected-library'), catalog);

	const nextRoot = join(root, 'next-selection');
	const activePaths = createSoundscaperDesktopProjectLibraryPaths(activeRoot);
	const nextPaths = createSoundscaperDesktopProjectLibraryPaths(nextRoot);
	await mkdir(nextPaths.libraryRoot, { recursive: true });
	await rename(activePaths.databasePath, nextPaths.databasePath);
	await writeFile(configuration, JSON.stringify({ active: activeRoot, selected: nextRoot, moveStarted: true }));
	assert.deepEqual(await catalogOnStartup('legacy-move-resumed'), catalog);

	async function catalogOnStartup(instanceId: string) {
		const host = await start(await temporaryStorage().prepare(), instanceId);
		try {
			const session = host.openSession(createSoundscaperDesktopProjectLibraryHandshake());
			try { return await session.listProjects(); } finally { await session.close(); }
		} finally { await host.close(); }
	}
});

test('temporary library relocation refuses while another profile owns the library', async context => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-library-live-relocation-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const shared = join(root, 'shared'), selected = join(root, 'selected');
	const settings = join(root, 'relocating-profile.json');
	const relocatingProfile = () => new TemporaryProjectStorage(settings, shared, 'Soundscaper');
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const project = createSoundscaperProject({ id: 'shared-project', title: 'Shared library project' });
	const firstOwner = await start(shared, 'profile-selecting-relocation');
	try {
		const session = firstOwner.openSession(handshake);
		try {
			const publicationId = 'b'.repeat(48);
			await session.beginPublication({ publicationId, expectedMetadataRevision: 0, expectedProject: null, project, bodies: [] });
			await session.finishPublication({ publicationId });
			await relocatingProfile().select(selected);
		} finally { await session.close(); }
	} finally { await firstOwner.close(); }

	const liveOwner = await start(shared, 'profile-still-editing');
	try {
		const session = liveOwner.openSession(handshake);
		try {
			await assert.rejects(relocatingProfile().prepare(), /project library is in use/iu);
			await assert.rejects(lstat(createSoundscaperDesktopProjectLibraryPaths(selected).databasePath), { code: 'ENOENT' });
			assert.equal((await session.readProjectBundle(project.id))?.project.projectId, project.id);
		} finally { await session.close(); }
	} finally { await liveOwner.close(); }

	assert.equal(await relocatingProfile().prepare(), selected);
	const reopened = await start(selected, 'relocation-after-close');
	try {
		const session = reopened.openSession(handshake);
		try { assert.equal((await session.readProjectBundle(project.id))?.project.projectId, project.id); }
		finally { await session.close(); }
	} finally { await reopened.close(); }
});

function start(appDataPath: string, instanceId: string): Promise<SoundscaperDesktopProjectLibraryMain> {
	return SoundscaperDesktopProjectLibraryMain.start({
		appDataPath,
		owner: { product: 'soundscaper', processId: 931, instanceId },
		handshake: createSoundscaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		testControl: null,
	});
}

function frozenProject(contentSha256: string) {
	const live = createAudioSource({
		id: 'live-source', storageKey: 'live-storage', contentSha256: 'b'.repeat(64),
		frameCount: 4, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const source = createAudioSource({
		id: 'freeze-source', storageKey: 'freeze-storage', contentSha256,
		frameCount: 4, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'live-clip', sourceId: live.id, title: 'Editable clip',
		timelineStartFrame: 0, durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4,
	});
	const track = createAudioTrack({
		id: 'frozen-track', name: 'Frozen track', clipIds: [clip.id],
		audioFreeze: {
			schemaVersion: 1,
			derivedSourceId: source.id,
			inputDigestSha256: '1'.repeat(64), rackDigestSha256: '2'.repeat(64),
			automationDigestSha256: '3'.repeat(64), freshnessDigestSha256: '4'.repeat(64),
			renderStartFrame: 0, renderFrameCount: 4, capturePosition: 'post-insert-pre-strip',
		},
	});
	return createSoundscaperProject({
		id: 'migrated-soundscaper-project', title: 'Migrated frozen project',
		sources: [live, source], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }],
		primarySequenceId: 'main-sequence',
	});
}
