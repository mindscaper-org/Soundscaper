/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAudioEditorBusyBlock } from '../src/common/editor/edit-blocking.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { registeredVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { digestMediaContent } from '../src/common/media/content-digest.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP51: an admitted project rename while source re-probe loads derivatives preserves its video preview', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const body = new Blob(['camera'], { type: 'video/mp4' });
	const camera = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'camera',
		contentSha256: await digestMediaContent(body), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	const project = createSoundscaperProject({ id: 'video-project', sources: [camera], primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture'] }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['video'] }],
		clips: [{ kind: 'video', id: 'video', sourceId: camera.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }] });
	await store.writeMediaAsset(camera.storageKey, body, { kind: 'video' });
	let armed = false, held = false;
	let release: () => void = () => undefined, entered: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	const list = store.listVideoDerivatives.bind(store);
	store.listVideoDerivatives = async key => {
		if (armed && !held) { held = true; entered(); await gate; }
		return list(key);
	};
	const ffmpeg = Object.assign(createMemoryFfmpeg(), { probeVideoTiming: async () => ({ nominalRate: { num: 24, den: 1 },
		timescale: 24_000, presentationTicks: Array.from({ length: 24 }, (_, i) => BigInt(i) * 1_000n),
		finalFrameDurationTicks: 1_000n }) });
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: ffmpeg as unknown as Options['ffmpeg'] });
	context.after(async () => { release(); await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	assert.ok(controller.actions.timeline.getClipVisualData('video')?.mediaUrl);
	armed = true;
	const reprobe = controller.actions.video.reprobeSource(camera.id); await started;
	assert.equal(selectAudioEditorBusyBlock(controller.getSnapshot()).blocked, false, 'File Rename stays admitted during source properties re-probe');
	await controller.actions.project.rename('Edited while re-probing');
	release(); await reprobe;
	assert.equal(controller.project?.title, 'Edited while re-probing');
	assert.ok(controller.actions.timeline.getClipVisualData('video')?.mediaUrl);
	const updated = controller.project?.sources.find(source => source.id === camera.id); assert.ok(updated);
	assert.equal(registeredVideoTimingIndex(updated)?.frameCount, 24, 'the re-probed source timing is ready for preview and source-time fields');
});
