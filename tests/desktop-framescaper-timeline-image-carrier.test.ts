/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createFramescaperDesktopProjectLibraryPaths } from '../desktop/framescaper-project-library-contract.ts';
import { framescaperNativeProjectBody } from '../desktop/native-services-project-body-custody.ts';
import { framescaperDesktopExactMediaPath } from '../desktop/project-library-exact-generation-storage.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { validateFramescaperDesktopBodyDescriptor } from '../src/framescaper/desktop-project-library-body-contract.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { startFramescaperDesktopProjectSession as startDesktop } from './helpers/framescaper-desktop-project-session.ts';
import { framescaperPortableTimelineImage, openFramescaperImageFixtureLibrary, saveFramescaperImageFixtureArchive } from './helpers/framescaper-portable-timeline-image.ts';

test('a desktop Scape import keeps its timeline image after restarting with an empty renderer store', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-desktop-archive-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const fixture = await framescaperPortableTimelineImage(directory);
	const { project, source, bytes, original, pixels } = fixture;
	const sender = await openFramescaperImageFixtureLibrary();
	const input = await saveFramescaperImageFixtureArchive(directory, sender, fixture).finally(() => sender.close());
	const first = await startDesktop(directory);
	try {
		await first.controller.actions.project.openScapeFile(input, () => assert.fail('A fresh desktop library requires no collision choice.'));
		assert.equal(first.controller.project?.id, project.id);
		assert.ok(await first.environment.store.loadMediaAsset(source.storageKey));
	} finally { await first.close(); }

	const paths = createFramescaperDesktopProjectLibraryPaths(directory);
	const database = new DatabaseSync(paths.databasePath, { readOnly: true });
	let declared: unknown[];
	try {
		const row = database.prepare('SELECT bodies_json FROM projects WHERE project_id = ?').get(project.id);
		assert.ok(typeof row?.bodies_json === 'string');
		declared = JSON.parse(row.bodies_json) as unknown[];
	} finally { database.close(); }

	const reopened = await startDesktop(directory);
	try {
		assert.equal(await reopened.environment.store.loadMediaAsset(source.storageKey), null);
		await reopened.controller.actions.project.openById(project.id);
		assert.equal(reopened.controller.project?.id, project.id);
		const body = await reopened.environment.store.loadMediaAsset(source.storageKey);
		assert.ok(body, `The SQLite project listed ${declared.length} image bodies and a fresh renderer could not recover its timeline image.`);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
		const reader = await openFramescaperImageFramePackV1({ source,
			read: async (offset, length) => new Uint8Array(await body.slice(offset, offset + length).arrayBuffer()),
		});
		assert.deepEqual(await reader.readOriginal(), original);
		assert.deepEqual(await reader.readFrame(0), pixels);
		assert.equal(declared.length, 1);
		const descriptor = validateFramescaperDesktopBodyDescriptor(declared[0]);
		assert.equal(descriptor.kind, 'framescaper-image-asset');
		assert.equal(descriptor.storageKey, source.storageKey);
		assert.equal(descriptor.sha256, source.contentSha256);
		assert.deepEqual(framescaperNativeProjectBody(descriptor), descriptor);
		const hostBytes = await readFile(framescaperDesktopExactMediaPath(paths, descriptor));
		assert.deepEqual(Uint8Array.from(hostBytes), bytes);
	} finally { await reopened.close(); }
});

test('desktop image publication requires exact bodies and journals identical bytes under both image identities', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-desktop-alias-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const { project, source, bytes } = await framescaperPortableTimelineImage(directory);
	const second = { ...source, id: 'second-poster', storageKey: 'second-poster' };
	const twoImages = applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: second.id, expectedSource: null, source: second },
		{ type: 'image-clip/set', clipId: 'second-clip', expectedClip: null, expectedPlacement: null,
			clip: { schemaVersion: 1, kind: 'image', id: 'second-clip', sourceId: second.id, sequenceId: 'main',
				sequenceStartFrame: 150, sequenceFrameCount: 150, sourceStartTicks: '0' },
			placement: { scope: 'timeline', trackId: 'pictures' } },
	] });
	const desktop = await startDesktop(directory);
	try {
		const catalog = await desktop.session.listProjects();
		assert.ok(catalog && typeof catalog === 'object' && 'metadataRevision' in catalog);
		const request = { publicationId: 'af'.repeat(24), expectedMetadataRevision: catalog.metadataRevision,
			expectedProject: null, project: twoImages };
		const bodies = [source, second].map(image => validateFramescaperDesktopBodyDescriptor({
			kind: 'framescaper-image-asset', encoding: 'framescaper-image-asset-v1',
			sourceId: image.storageKey, storageKey: image.storageKey, mimeType: image.mimeType,
			byteLength: image.assetByteLength, sha256: image.contentSha256,
		}));
		await assert.rejects(desktop.session.beginPublication({ ...request, bodies: [] }), /image-asset body is missing/u);
		await assert.rejects(desktop.session.beginPublication({ ...request, bodies: bodies.slice(0, 1) }), /image-asset body is missing/u);
		await desktop.session.beginPublication({ ...request, bodies });
		for (const bodyIndex of bodies.keys()) {
			await desktop.session.writePublicationChunk({ publicationId: request.publicationId, bodyIndex, offset: 0, bytes });
		}
		await desktop.session.finishPublication({ publicationId: request.publicationId });
		const paths = createFramescaperDesktopProjectLibraryPaths(directory);
		const files = bodies.map(body => framescaperDesktopExactMediaPath(paths, body));
		assert.equal(new Set(files).size, bodies.length);
		for (const file of files) assert.deepEqual(Uint8Array.from(await readFile(file)), bytes);
	} finally { await desktop.close(); }
});

test('desktop reads a legacy image project whose catalog omitted every timeline image body', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-desktop-legacy-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const fixture = await framescaperPortableTimelineImage(directory);
	const sender = await openFramescaperImageFixtureLibrary();
	const input = await saveFramescaperImageFixtureArchive(directory, sender, fixture).finally(() => sender.close());
	const desktop = await startDesktop(directory);
	try { await desktop.controller.actions.project.openScapeFile(input, () => assert.fail('Expected a fresh desktop library.')); }
	finally { await desktop.close(); }
	const database = new DatabaseSync(createFramescaperDesktopProjectLibraryPaths(directory).databasePath);
	try {
		const updated = database.prepare("UPDATE projects SET bodies_json = '[]' WHERE project_id = ?").run(fixture.project.id);
		assert.equal(updated.changes, 1);
	} finally { database.close(); }
	const reopened = await startDesktop(directory);
	try {
		await reopened.controller.actions.project.openById(fixture.project.id);
		assert.equal(reopened.controller.project?.id, fixture.project.id);
		assert.equal(reopened.controller.project?.clips[0]?.id, fixture.project.clips[0]?.id);
		assert.equal(await reopened.environment.store.loadMediaAsset(fixture.source.storageKey), null);
	} finally { await reopened.close(); }
});
