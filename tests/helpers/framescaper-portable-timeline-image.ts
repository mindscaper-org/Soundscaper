/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, normalizeFramescaperImageSourceV1 } from '../../src/common/editor/timeline-image-model.ts';
import { applyFramescaperProjectCommand } from '../../src/framescaper/editor-project-commands.ts';
import { createFramescaperEditorProjectEnvironment, type FramescaperEditorProjectEnvironment } from '../../src/framescaper/editor-project-environment.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { ordinaryImageResourceFixture } from './ordinary-image-resource-fixture.ts';

export function openFramescaperImageFixtureLibrary(indexedDB = createInstrumentedIndexedDB()) {
	return createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 4 * 1024 ** 3 }) },
	} });
}

export async function saveFramescaperImageFixtureArchive(
	directory: string,
	library: FramescaperEditorProjectEnvironment,
	fixture: Awaited<ReturnType<typeof framescaperPortableTimelineImage>>,
): Promise<File> {
	const { base, project, bytes } = fixture;
	assert.ok(await library.createProjectIfAbsent(base));
	assert.ok(await library.timelineImages.publishIfCurrent({ expected: base, project, bytes }));
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const { blob } = await archive.exportScapeProject(project, library.store);
	assert.ok(blob);
	const fileName = 'Poster layout.fscape';
	const archivePath = join(directory, fileName);
	await writeFile(archivePath, new Uint8Array(await blob.arrayBuffer()));
	return new File([await openAsBlob(archivePath)], fileName);
}

export async function framescaperPortableTimelineImage(directory: string) {
	const pngPath = join(directory, 'poster.png');
	await writeFile(pngPath, ordinaryImageResourceFixture('png-small'));
	const original = new Uint8Array(await (await openAsBlob(pngPath)).arrayBuffer());
	const pixels = new Uint8Array(16 * 16 * 4);
	for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([33, 99, 181, 255], offset);
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, decoder: { id: 'known-png-fixture', version: '1' } },
		width: 16, height: 16, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: pixels }] });
	const source = normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: 'image', id: 'poster', name: 'Poster',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: 'poster', contentSha256: pack.contentSha256,
		assetByteLength: pack.assetByteLength, original: { fileName: 'poster.png', mimeType: 'image/png', recognizedFormat: 'png',
			byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width: 16, height: 16, hasAlpha: false, frameCount: 1, durationTicks: '5000000', timingMode: 'fallback' },
		conversionReceiptSha256: pack.conversionReceiptSha256 });
	const base = createFramescaperProject(PROFILE, { id: 'poster-layout', title: 'Poster layout',
		tracks: [{ id: 'pictures', type: 'video', clipIds: [] }], sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const clip = { schemaVersion: 1, kind: 'image', id: 'poster-clip', sourceId: 'poster', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceStartTicks: '0' };
	const project = applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement: { scope: 'timeline', trackId: 'pictures' } },
	] });
	return { base, project, source, original, pixels, bytes: pack.bytes };
}
