/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const extent of ['beat', 'sample'] as const) for (const automated of [false, true]) test(`NP036: per-track ripple delete resolves musical ${extent} extent, automation=${automated}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const project = createSoundscaperProject({ id: 'musical-ripple', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['first', 'later'] })], clips: ['first', 'later'].map((id, index) =>
			createAudioClip({ id, title: id, sourceId: source.id, anchor: 'musical', musicalStartBeat: index * 8,
				musicalExtent: extent, ...(extent === 'beat' ? { musicalDurationBeats: 2 } : { durationFrames: 48_000 }), sourceDurationFrames: 48_000 })),
		automationLanes: automated ? [normalizeAutomationLaneV21({ id: 'ride',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' }, timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 1 }, { id: 'later-gain', position: 192_000, value: .25 }], segments: [{ kind: 'linear' }],
		})] : [],
	});
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Musical clips.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.selectClip('first'); const before = controller.project;
	controller.actions.edit.deletePerTrackRipple();
	const result: unknown = controller.project; assert.ok(validateSoundscaperProject(result));
	assert.equal(result.clips.length, 1, JSON.stringify(controller.getSnapshot().status));
	assert.equal(resolveRuntimeProjectProjection(result).clips[0]?.timelineStartFrame, 144_000);
	assert.deepEqual(result.clips[0]?.musicalStartBeat, { num: 6, den: 1 });
	if (automated) assert.equal(result.automationLanes[0]?.points.find(point => point.id === 'later-gain')?.position, 144_000);
	controller.actions.edit.undo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...before, revision: 0, updatedAt: '' });
	controller.actions.edit.redo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...result, revision: 0, updatedAt: '' });
});
