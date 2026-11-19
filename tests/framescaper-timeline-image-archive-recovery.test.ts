/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MEDIA_ASSET_CHUNK_STORE_NAME } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { framescaperPortableTimelineImage, openFramescaperImageFixtureLibrary, saveFramescaperImageFixtureArchive } from './helpers/framescaper-portable-timeline-image.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('File Open offers an intact Scape copy when the working timeline image is damaged', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-archive-recovery-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const db = createInstrumentedIndexedDB();
	const library = await openFramescaperImageFixtureLibrary(db);
	try {
		const fixture = await framescaperPortableTimelineImage(directory);
		const { project, source, original, pixels, bytes } = fixture;
		const input = await saveFramescaperImageFixtureArchive(directory, library, fixture);
		const controller = await createFramescaperFixtureController(library, project.id);
		try {
			await controller.ready;
			const healthy = await controller.actions.project.openScapeFile(input, () => assert.fail('A healthy project should reopen directly.'));
			assert.equal(healthy?.collision, 'reuse');
			const { databaseName } = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE);
			const row = db.records(databaseName, MEDIA_ASSET_CHUNK_STORE_NAME).find(record => record.sourceId === source.storageKey);
			assert.ok(row && typeof row.key === 'string');
			const damaged = bytes.slice();
			damaged[0] ^= 1;
			db.seedRecord(databaseName, MEDIA_ASSET_CHUNK_STORE_NAME, { ...row, payloadBytes: damaged.buffer }, row.key);
			const metadata = await library.store.getMediaAssetMetadata(source.storageKey);
			assert.equal(metadata?.sha256, source.contentSha256);
			await assert.rejects(library.store.loadMediaAsset(source.storageKey), /local media asset is missing/u);
			const offered: string[] = [];
			const reopened = await controller.actions.project.openScapeFile(input, decision => { offered.push(decision.kind); return 'copy'; });
			assert.deepEqual(offered, ['collision']);
			assert.equal(reopened?.collision, 'copy');
			assert.notEqual(controller.project?.id, project.id);
			assert.equal(controller.project?.id, reopened?.project.id);
			const restored = normalizeFramescaperImageSourceV1(controller.project?.sources[0]);
			assert.notEqual(restored.storageKey, source.storageKey);
			const body = await library.store.loadMediaAsset(restored.storageKey);
			assert.ok(body);
			const reader = await openFramescaperImageFramePackV1({ source: restored,
				read: async (offset, length) => new Uint8Array(await body.slice(offset, offset + length).arrayBuffer()),
			});
			assert.deepEqual(await reader.readOriginal(), original);
			assert.deepEqual(await reader.readFrame(0), pixels);
			assert.equal((await library.store.loadProject(project.id))?.id, project.id);
			await assert.rejects(library.store.loadMediaAsset(source.storageKey), /local media asset is missing/u);
		} finally { controller.blockStoreClose(); await controller.dispose(); }
	} finally { await library.close(); }
});
