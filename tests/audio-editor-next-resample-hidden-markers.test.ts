/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clipSourceTrimFields } from '../src/common/editor/clip-source-trim.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const scope of ['clip', 'track'] as const) test(`NP051: ${scope} resampling preserves hidden source stretch markers`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const full = createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 24_000, source: 12_000, mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		] } });
	const base = createSoundscaperProject({ id: 'resample-hidden-markers', sources: [source], clips: [full],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const trimmed = createSoundscaperProject({ ...base, clips: [{ ...full, ...clipSourceTrimFields(base, full, source,
		{ sourceStartFrame: 24_000, sourceDurationFrames: 24_000, durationFrames: 16_000 }) }] });
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	const archive = await exportScapeProject(trimmed, archiveStore); assert.ok(archive.blob instanceof Blob);
	await archiveStore.close();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Hidden stretch.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const before = controller.project;
	if (scope === 'clip') await controller.actions.clip.resample('clip', { sampleRate: 24_000 });
	else await controller.actions.track.resample('voice', 24_000);
	const resampled = controller.project;
	controller.actions.clipSourcePreview.trim('clip', { sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 48_000 });
	const restored: unknown = controller.project; assert.ok(validateSoundscaperProject(restored));
	const points = normalizeAudioWarpMap(restored.clips[0]?.warpMap).points;
	assert.ok(points.some(point => point.source.num / point.source.den === 6_000
		&& point.outer.num / point.outer.den === 24_000), 'the hidden nonlinear anchor returns on the corresponding resampled source sample');
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, resampled?.clips);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
	controller.actions.edit.redo(); controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, restored.clips);
});
