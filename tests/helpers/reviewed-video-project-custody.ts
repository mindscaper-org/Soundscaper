/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createContainerVideoTimingProbe } from '../../src/common/editor/video-timing-demux.ts';
import { probeVideoTiming } from '../../src/common/editor/video-timing-probe.ts';
import { publishVideoTimingAsset, loadVideoTimingAsset } from '../../src/common/editor/video-timing-storage.ts';
import { publishImportedVideo } from '../../src/common/editor/controller/import/internal/source-import-video-publication.ts';
import { createFramescaperAudioEditorController, type FramescaperAudioEditorControllerPresentation } from '../../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../../src/framescaper/editor-project-environment.ts';
import { cloneFramescaperProject, createFramescaperProject, type FramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export interface ReviewedVideoBytes {
	readonly name: string;
	readonly mimeType: string;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly sha256: string;
}

/** Native picture decoding stays in the browser. Publish real, demux-authenticated media/timing here. */
export async function reviewedVideoProjectCustody(context: TestContext, files: readonly ReviewedVideoBytes[], rate = { num: 25, den: 1 },
	presentation: FramescaperAudioEditorControllerPresentation = {}) {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const { project, controller } = await (async () => {
		try {
			const sources = [];
			for (const [index, fixture] of files.entries()) {
				assert.equal(createHash('sha256').update(fixture.bytes).digest('hex'), fixture.sha256);
				const file = new File([fixture.bytes], fixture.name, { type: fixture.mimeType });
				const probe = await probeVideoTiming(file, { probes: [createContainerVideoTimingProbe()] });
				assert.equal(probe.decision, 'timing-asset'); assert.ok(probe.decision === 'timing-asset');
				const characteristics = probe.characteristics;
				assert.ok(characteristics.codedWidth && characteristics.codedHeight);
				const id = `camera-${index}`;
				const publication = await publishImportedVideo(environment.store, id, file, { name: fixture.name, mimeType: fixture.mimeType });
				const timing = await publishVideoTimingAsset(environment.store, publication.sha256, probe.timing);
				const source = createVideoSource({ id, storageKey: id, name: fixture.name, mimeType: fixture.mimeType,
					contentSha256: publication.sha256, width: characteristics.codedWidth, height: characteristics.codedHeight,
					sampleFrameCount: Math.round(Number(probe.timing.endTicks) * 48_000 / probe.timing.timescale),
					frameRate: probe.nominalRate, sourceFrameCount: probe.timing.frameCount,
					timingAsset: timing.reference, timingDecision: { mode: 'exact', rate: probe.nominalRate, backend: probe.backend },
					characteristics, videoCodec: characteristics.videoCodec, hasAudio: false, audioCodec: null });
				sources.push(source);
			}
			const project = createFramescaperProject(PROFILE, { id: crypto.randomUUID(), title: 'Camera custody', sources,
				clips: sources.map((source, index) => ({ kind: 'video', id: `picture-${index}`, title: source.name, sourceId: source.id, sequenceId: 'main',
					sequenceStartFrame: 0, sequenceFrameCount: Math.max(1, Math.round(source.sampleFrameCount * rate.num / (48_000 * rate.den))), sourceInFrame: 0, sourceFrameCount: source.sourceFrameCount, retimeMap: null })),
				tracks: sources.map((_, index) => ({ id: `pictures-${index}`, type: 'video', clipIds: [`picture-${index}`] })),
				sequences: [{ id: 'main', rate, trackIds: sources.map((_, index) => `pictures-${index}`) }], primarySequenceId: 'main' });
			assert.ok(await environment.createProjectIfAbsent(project));
			await environment.store.saveSetting('framescaper:last-project-id', project.id);
			return { project, controller: createFramescaperAudioEditorController(environment, presentation) };
		} catch (error) { await environment.close(); throw error; }
	})();
	context.after(async () => { try { await controller.dispose(); } finally { await environment.close(); } });
	await controller.ready;
	assert.equal(controller.project?.id, project.id);
	return { environment, controller, project, async verifyMedia(value: unknown, store = environment.store) {
		const current = cloneFramescaperProject(PROFILE, value);
		assert.equal(current.sources.length, files.length);
		for (const fixture of files) {
			const source = current.sources.find(source => source.name === fixture.name); assert.ok(source?.kind === 'video');
			const blob = await store.loadMediaAsset(source.storageKey); assert.ok(blob instanceof Blob);
			assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), fixture.bytes);
			assert.equal(source.contentSha256, fixture.sha256);
			const timing = await loadVideoTimingAsset(store, source.timingAsset, { sourceSha256: fixture.sha256 });
			assert.equal(timing.status, 'available'); assert.equal(timing.index?.frameCount, source.sourceFrameCount);
		}
		return current;
	} };
}

export function currentReviewedVideoProject(value: unknown): FramescaperProject { return cloneFramescaperProject(PROFILE, value); }
