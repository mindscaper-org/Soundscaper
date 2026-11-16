/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { canonicalMediaContentBlob } from '../src/common/media/content-digest.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import type { FramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { ordinaryImageResourceFixture } from './helpers/ordinary-image-resource-fixture.ts';
import { singleFramePosterApng, twoFramePosterApng } from './helpers/single-frame-poster-apng.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createPngFixture } from './helpers/png-fixture.mjs';

const fixtures = [
	...(['png', 'jpeg', 'gif', 'webp', 'bmp'] as const).map(format => ({ name: `ordinary.${format}`, format,
		bytes: ordinaryImageResourceFixture(`${format}-small`), size: 16, frames: [[33, 99, 181, 255]], animated: false })),
	{ name: 'ordinary-rgba.png', format: 'png', bytes: createPngFixture(16), size: 16, frames: [[0, 0, 0, 0]], animated: false },
	...['jfif', 'jpe'].map(suffix => ({ name: `Photo.${suffix}`, format: 'jpeg',
		bytes: ordinaryImageResourceFixture('jpeg-small'), size: 16, frames: [[33, 99, 181, 255]], animated: false })),
	...[1, 2].map(count => ({ name: `animation-${count}.png`, format: 'png',
		bytes: count === 1 ? singleFramePosterApng() : twoFramePosterApng(), size: 1,
		frames: [[0, 0, 255, 255], ...(count === 2 ? [[0, 255, 0, 255]] : [])], animated: true })),
];
type Fixture = typeof fixtures[number];

for (const fixture of fixtures) test(`decoded ${fixture.name} retains original, timing, pixels and history across independent Scape reopening`, async context => {
	// Only the platform pixel port is supplied. Browser tests retain actual decoding of every format.
	const observations = installDecodedFrames(context, fixture);
	const file = new File([Uint8Array.from(fixture.bytes)], fixture.name, { type: `image/${fixture.format}` });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const recipient = createProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false, databaseName: context.name });
	const controller = createFramescaperAudioEditorController(environment, { fileService: {
		...createAudioEditorFileService(), isDesktop: true, chooseFiles: async () => [{ id: 'selected-image' }],
		async withReadDescriptors<Result>(_descriptors: readonly unknown[], _request: unknown,
			consume: (files: readonly File[]) => PromiseLike<Result> | Result): Promise<Result> { return await consume([file]); },
	} });
	try {
		await controller.ready;
		const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(runtime);
		await runtime.run('video-still'); await controller.actions.project.flush();
		const project = cloneFramescaperProject(PROFILE, controller.project);
		assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
		const source = project.sources[0], clip = project.clips[0]; assert.ok(source?.kind === 'image' && clip?.kind === 'image');
		assert.deepEqual(source.original, { fileName: fixture.name, mimeType: file.type, recognizedFormat: fixture.format,
			byteLength: fixture.bytes.length, sha256: createHash('sha256').update(fixture.bytes).digest('hex') });
		const duration = fixture.animated ? fixture.frames.length * 500_000 : 5_000_000;
		assert.deepEqual(source.canonical, { width: fixture.size, height: fixture.size, hasAlpha: fixture.frames.some(pixel => pixel[3] !== 255),
			frameCount: fixture.frames.length, durationTicks: String(duration), timingMode: fixture.animated ? 'embedded' : 'fallback' });
		assert.equal(clip.sourceId, source.id); assert.equal(clip.sourceStartTicks, '0'); assert.equal(clip.sequenceStartFrame, 0);
		const sequence = project.sequences.find(sequence => sequence.id === clip.sequenceId); assert.ok(sequence);
		const denominator = 1_000_000n * BigInt(sequence.rate.den);
		assert.equal(clip.sequenceFrameCount, Number((BigInt(duration) * BigInt(sequence.rate.num) + denominator - 1n) / denominator));
		assert.ok(project.tracks.some(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)));
		assert.deepEqual(observations(), { opened: 1, closed: 1, framesClosed: fixture.frames.length });
		await assertBody(environment.controllerStore, source, fixture);
		controller.actions.edit.undo();
		assert.equal(controller.project?.clips.length, 0); assert.equal(controller.project?.sources.length, 0);
		controller.actions.edit.redo(); await controller.actions.project.flush();
		const restored = cloneFramescaperProject(PROFILE, controller.project);
		assert.deepEqual(restored.sources, project.sources); assert.deepEqual(restored.clips, project.clips);
		assert.deepEqual(await environment.store.loadProject(restored.id), restored);
		const archive = createFramescaperScapeNativeRuntime(PROFILE), saved = await archive.exportScapeProject(restored, environment.controllerStore);
		assert.ok(saved.blob); const imported = await archive.importScapeProject(saved.blob, recipient);
		assert.equal(imported.readOnly, false); assert.deepEqual(imported.project, restored);
		const reopened = cloneFramescaperProject(PROFILE, imported.project), image = reopened.sources[0]; assert.ok(image?.kind === 'image');
		await assertBody(recipient, image, fixture);
	} finally { await controller.dispose(); await recipient.close(); await environment.close(); }
});

async function assertBody(store: AudioEditorProjectStore, source: FramescaperImageSourceV1, fixture: Fixture): Promise<void> {
	const blob = canonicalMediaContentBlob(await store.loadMediaAsset(source.storageKey));
	assert.equal(blob.size, source.assetByteLength);
	const reader = await openFramescaperImageFramePackV1({ source, read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()) });
	assert.deepEqual(Buffer.from(await reader.readOriginal()), fixture.bytes);
	for (const [index, pixel] of fixture.frames.entries()) {
		assert.deepEqual(await reader.readFrame(index), Uint8Array.from({ length: fixture.size ** 2 * 4 }, (_, offset) => pixel[offset % 4]!));
		const ticks = BigInt(fixture.animated ? 500_000 : 5_000_000);
		assert.deepEqual(reader.timings[index], { presentationTicks: BigInt(index) * ticks, durationTicks: ticks });
	}
}

function installDecodedFrames(context: TestContext, fixture: Fixture) {
	const saved = ['ImageDecoder', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	context.after(() => { for (const [key, descriptor] of saved) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	let opened = 0, closed = 0, framesClosed = 0;
	class Decoder {
		static async isTypeSupported(): Promise<boolean> { return true; }
		constructor() { opened++; }
		readonly tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: fixture.frames.length + (fixture.animated ? 1 : 0) } };
		async decode({ frameIndex }: { frameIndex: number }) {
			const pixel = fixture.frames[frameIndex]; assert.ok(pixel);
			return { complete: true, image: { displayWidth: fixture.size, displayHeight: fixture.size,
				duration: fixture.animated && fixture.frames.length > 1 ? 500_000 : null, pixel,
				close() { framesClosed++; } } };
		}
		close(): void { closed++; }
	}
	class Canvas {
		getContext() {
			let pixel: number[] | undefined;
			return { clearRect() {}, drawImage(image: { pixel: number[] }) { pixel = image.pixel; }, getImageData() {
				const value = pixel; assert.ok(value);
				return { data: Uint8ClampedArray.from({ length: fixture.size ** 2 * 4 }, (_, offset) => value[offset % 4]!) };
			} };
		}
	}
	Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: Decoder });
	Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: Canvas });
	return () => ({ opened, closed, framesClosed });
}
