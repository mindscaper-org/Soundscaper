/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const action of ['selection', 'cut'] as const) for (const anchor of ['sample', 'musical'] as const) {
	test(`P3-021: ${action} audition resolves the selected ${anchor} clip after native File Open`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 48_000,
			...(anchor === 'sample' ? { timelineStartFrame: 24_000, durationFrames: 48_000 }
				: { anchor: 'musical', musicalStartBeat: 1, musicalExtent: 'beat', musicalDurationBeats: 2 }) });
		const project = createSoundscaperProject({ id: 'transport-clip-selection', sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })],
			selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: ['clip'] } });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		const runtime = createSoundscaperProjectRuntimeSelection();
		const calls: unknown[] = [];
		const engine = { ...createMemoryEngine(),
			playCutPreview: async (range: unknown) => { calls.push(range); },
			setPlayRange: (range: unknown) => { calls.push(range); return range; },
		};
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: engine as unknown as Options['engine'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Voice.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		const before = structuredClone(controller.project);
		if (action === 'selection') await controller.actions.transport.playSelection();
		else await controller.actions.transport.playCutPreview();
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0], { startFrame: 24_000, endFrame: 72_000, ...(action === 'cut' ? { trackIds: ['voice'] } : {}) });
		assert.deepEqual(controller.project, before, 'audition leaves selection, loop and history document unchanged');
	});
}
