/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clipSourceTrimFields } from '../src/common/editor/clip-source-trim.ts';
import { normalizeAudioWarpMap, type AudioWarpPoint } from '../src/common/editor/audio-warp-domain.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const scope of ['swap', 'pencil', 'stereo split'] as const) test(`P3-005: ${scope} source replacement preserves hidden stretch markers`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 });
	const normalized = createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 24_000, source: 12_000, mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		] } });
	const full = { ...normalized, timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 };
	const base = createSoundscaperProject({ id: 'resample-hidden-markers', sources: [source], clips: [full],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const trimmed = createSoundscaperProject({ ...base, clips: [{ ...full, ...clipSourceTrimFields(base, full, source,
		{ sourceStartFrame: 24_000, sourceDurationFrames: 24_000, durationFrames: 16_000 }) }] });
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25), new Float32Array(48_000).fill(-.5)]); await writer.commit();
	const archive = await exportScapeProject(trimmed, archiveStore); assert.ok(archive.blob instanceof Blob);
	await archiveStore.close();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Hidden stretch.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const before = controller.project;
	if (scope === 'swap') await controller.actions.track.swapChannels('voice');
	else if (scope === 'stereo split') await controller.actions.track.splitStereoLR('voice');
	else {
		controller.actions.timeline.selectClip('clip');
		controller.actions.timeline.setZoom(288_000);
		assert.equal(controller.getSnapshot().sampleEdit.available, true);
		const opened: unknown = controller.project; assert.ok(validateSoundscaperProject(opened));
		const clip = opened.clips[0]; assert.ok(clip && typeof clip.timelineStartFrame === 'number');
		await controller.actions.sampleEdit.pencil({ clipId: 'clip', channel: 0,
			points: [{ timelineFrame: clip.timelineStartFrame + 1, value: .75 }],
		});
	}
	const replaced: unknown = controller.project; assert.ok(validateSoundscaperProject(replaced));
	const editedClip = replaced.clips[0]; assert.ok(editedClip);
	const editedSource = replaced.sources.find(source => source.id === editedClip.sourceId); assert.ok(editedSource);
	assert.equal(typeof editedSource.channelCount, 'number');
	const channelCount = editedSource.channelCount; assert.ok(typeof channelCount === 'number');
	const channels: number[][] = [[], []];
	for await (const chunk of store.readSourceChunks(String(editedSource.storageKey))) {
		for (let channel = 0; channel < channelCount; channel += 1) channels[channel]!.push(...chunk.channels[channel]!);
	}
	if (scope === 'swap') { assert.equal(channels[0]?.[24_000], -.5); assert.equal(channels[1]?.[24_000], .25); }
	else if (scope === 'stereo split') { assert.equal(editedSource.channelCount, 1); assert.equal(channels[0]?.[24_000], .25); }
	else { assert.equal(channels[0]?.[24_001], .75); assert.equal(channels[1]?.[24_001], -.5); }
	const extendedIds = scope === 'stereo split' ? replaced.clips.map(clip => clip.id) : ['clip'];
	for (const clipId of extendedIds) {
		controller.actions.clipSourcePreview.trim(clipId, { sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 });
	}
	const restored: unknown = controller.project; assert.ok(validateSoundscaperProject(restored));
	for (const clipId of extendedIds) {
		const points: readonly AudioWarpPoint[] = normalizeAudioWarpMap(restored.clips.find(clip => clip.id === clipId)?.warpMap).points;
		assert.ok(points.some(point => point.source.num / point.source.den === 12_000
			&& point.outer.num / point.outer.den === 24_000), 'the hidden nonlinear anchor returns after extending the edited source');
	}
	for (let index = 0; index < extendedIds.length; index++) controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, replaced.clips);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
	controller.actions.edit.redo();
	for (let index = 0; index < extendedIds.length; index++) controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, restored.clips);
});
