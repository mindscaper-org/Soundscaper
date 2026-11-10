/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

import { createFramescaperImageFramePackV1, openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, normalizeFramescaperImageSourceV1 } from '../../src/common/editor/timeline-image-model.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { normalizeVideoGeneratorClipV1 } from '../../src/common/editor/video-visual-model-v24.ts';
import { applyFramescaperProjectCommand } from '../../src/framescaper/editor-project-commands.ts';
import { createFramescaperEditorProjectEnvironment } from '../../src/framescaper/editor-project-environment.ts';
import { cloneFramescaperProject, createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createFramescaperFixtureController } from './framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { createPngFixture } from './png-fixture.mjs';

/** Native PNG decoding remains in the retained browser workflow. This begins at authenticated post-decode publication. */
export async function framescaperAttributionCustody(context: TestContext, addTitle: boolean) {
	const original = Uint8Array.from(createPngFixture(16));
	const pixels = new Uint8Array(16 * 16 * 4); // The independently authored PNG fixture is transparent black.
	const publication = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, decoder: { id: 'known-png-fixture', version: '1' } },
		width: 16, height: 16, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: pixels }] });
	const source = normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: 'image', id: 'poster', name: 'poster',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: 'poster', contentSha256: publication.contentSha256,
		assetByteLength: publication.assetByteLength, original: { fileName: 'poster.png', mimeType: 'image/png', recognizedFormat: 'png',
			byteLength: original.byteLength, sha256: publication.originalSha256 },
		canonical: { width: 16, height: 16, hasAlpha: true, frameCount: 1, durationTicks: '5000000', timingMode: 'fallback' },
		conversionReceiptSha256: publication.conversionReceiptSha256 });
	const base = createFramescaperProject(PROFILE, { id: crypto.randomUUID(), title: 'Attribution custody',
		tracks: [{ id: 'pictures', type: 'video', clipIds: [] }], sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const clip = { schemaVersion: 1, kind: 'image', id: 'poster-clip', sourceId: 'poster', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceStartTicks: '0' };
	const authored = applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement: { scope: 'timeline', trackId: 'pictures' } },
	] });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = await (async () => {
		try {
			assert.ok(await environment.createProjectIfAbsent(base));
			assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: publication.bytes }));
			return await createFramescaperFixtureController(environment, base.id);
		} catch (error) { await environment.close(); throw error; }
	})();
	context.after(async () => { try { await controller.dispose(); } finally { await environment.close(); } });
	await controller.ready;
	if (addTitle) {
		const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(runtime);
		await runtime.run('video-title');
		const generated = normalizeVideoGeneratorClipV1(controller.project?.clips.find(value => value.id !== clip.id));
		assert.equal(generated.sequenceFrameCount, 150); assert.equal(generated.sourceInFrame, 0);
	}
	await controller.actions.project.flush();
	const current = cloneFramescaperProject(PROFILE, controller.project);
	assert.deepEqual(cloneFramescaperProject(PROFILE, await environment.store.loadProject(base.id)), current);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const exported = await archive.exportScapeProject(current, environment.store); assert.ok(exported.blob);
	// Reopen the actual ZIP independently. Product-store image import currently requires an atomic publisher unavailable at this boundary.
	const zip = new ZipReader(new BlobReader(exported.blob), { useWebWorkers: false });
	try {
		const entries = await zip.getEntries();
		const document = entries.find(value => value.filename === 'project.json'); assert.ok(document && !document.directory);
		const projectBody = await document.getData(new BlobWriter());
		const reopened = cloneFramescaperProject(PROFILE, JSON.parse(await projectBody.text()) as unknown);
		assert.deepEqual(reopened, current);
		const restored = normalizeFramescaperImageSourceV1(reopened.sources.find(value => value.kind === 'image'));
		const image = entries.find(value => value.filename === 'framescaper/timelineImage/image/poster/body'); assert.ok(image && !image.directory);
		const body = await image.getData(new BlobWriter());
		const reader = await openFramescaperImageFramePackV1({ source: restored, read: async (offset, length) => new Uint8Array(await body.slice(offset, offset + length).arrayBuffer()) });
		assert.deepEqual(await reader.readOriginal(), original); assert.deepEqual(await reader.readFrame(0), pixels);
		return { project: reopened, runtime: environment.runtime, original };
	} finally { await zip.close(); }
}
