/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const linked of [false, true]) test(`MP52: File Recover Project preserves intact ${linked ? 'linked' : 'managed'} video and verified timing`, async context => {
	const { store, controller, recovery, project, source } = await fixture(context, linked);
	assert.ok((await recovery.list()).some(row => row.id === project.id));
	const inspection = await recovery.inspect(project.id);
	const restored = await recovery.recover(inspection, 0);
	assert.equal(controller.project?.id, restored.project.id);
	assert.notEqual(restored.project.id, project.id);
	assert.equal(restored.project.sources[0]?.storageKey, source.storageKey);
	assert.equal(restored.project.clips[0]?.id, 'video');
	assert.equal(inspection.candidates[0]?.status, 'usable');
	assert.deepEqual(restored.project.sources[0]?.timingAsset, source.timingAsset);
	assert.deepEqual(await store.loadProject(project.id), project);
	if (linked) assert.ok(await store.getLinkedOriginalBinding(restored.project.id, source.id));
});

for (const damage of ['missing', 'body', 'timing'] as const) test(`MP52: recovery reports confirmed ${damage} video damage without retaining an unusable clip`, async context => {
	const { store, recovery, project, source } = await fixture(context);
	const load = store.loadMediaAsset.bind(store);
	const damagedKey = damage === 'timing' ? source.timingAsset?.storageKey : source.storageKey; assert.ok(damagedKey);
	store.loadMediaAsset = async key => key === damagedKey
		? damage === 'missing' ? null : new Blob(['corrupt']) : load(key);
	const inspection = await recovery.inspect(project.id);
	assert.equal(inspection.candidates[0]?.status, 'repairable');
	const restored = await recovery.recover(inspection, 0);
	assert.equal(restored.project.clips.length, 0);
	assert.equal(restored.project.sources.length, 0);
	assert.deepEqual(await store.loadProject(project.id), project);
});

test('MP52: unavailable video storage blocks recovery instead of silently deleting its media', async context => {
	const { store, recovery, project } = await fixture(context);
	const failure = new DOMException('The media database is unavailable.', 'InvalidStateError');
	store.loadMediaAsset = () => Promise.reject(failure);
	await assert.rejects(recovery.inspect(project.id), error => error === failure);
	assert.deepEqual(await store.loadProject(project.id), project);
});

async function fixture(context: TestContext, linked = false) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const body = new Blob(['recorded video original', context.name], { type: 'video/mp4' });
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false,
		linkedVideoOriginalPort: { load: async () => ({ blob: body, locatorRevision: 'camera_revision_0000000001' }) } });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const contentSha256 = await digestMediaContent(body);
	const timing = createVideoTimingAssetPublication(contentSha256, { timescale: 30_000,
		presentationTicks: Array.from({ length: 30 }, (_, i) => BigInt(i) * 1_000n), finalFrameDurationTicks: 1_000n });
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: `camera-body-${context.name}`, contentSha256,
		sampleFrameCount: 48_000, sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 320, height: 180,
		timingAsset: timing.reference, timingDecision: { mode: 'exact', rate: { num: 30, den: 1 } } });
	const project = createSoundscaperProject({ id: `recovery-picture-${context.name}`, sources: [source], primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture'] }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['video'] }],
		clips: [{ kind: 'video', id: 'video', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }] });
	if (!await store.getMediaAssetMetadata(timing.reference.storageKey)) {
		await store.writeMediaAsset(timing.reference.storageKey, new Blob([Uint8Array.from(timing.bytes)]), { kind: 'video-timing' });
	}
	if (linked) await store.bindLinkedVideoOriginal(project.id, source, 'a'.repeat(48));
	else await store.writeMediaAsset(source.storageKey, body, { kind: 'video' });
	await store.saveProject(project);
	const recovery = bindSoundscaperProjectRecovery(store, recovered => controller.actions.project.open(recovered));
	return { store, controller, recovery, project, source };
}
