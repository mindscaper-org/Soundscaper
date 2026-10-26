/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const mode of ['take', 'lane'] as const) for (const colliding of [false, true]) {
	test(`P3-023: ${mode} auditions distinguish ${colliding ? 'colon-bearing' : 'ordinary'} group identities`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const previews: ReturnType<typeof createMemoryEngine>[] = [];
		const sources = ['First', 'Second'].map((name, index) => createAudioSource({ id: `source-${index}`, name,
			frameCount: 48_000, channelCount: 1, sampleRate: 48_000 }));
		for (const [index, source] of sources.entries()) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(48_000).fill(index ? -.5 : .125)]); await writer.commit();
		}
		const groupIds = colliding ? ['a:b', 'a'] : ['first', 'second'];
		const memberIds = colliding ? ['c', 'b:c'] : ['first-member', 'second-member'];
		const laneIds = mode === 'lane' ? memberIds : ['lane-first', 'lane-second'];
		const takeIds = mode === 'take' ? memberIds : ['take-first', 'take-second'];
		const project = createSoundscaperProject({ id: 'take-preview-identity', sources,
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
			takeGroups: groupIds.map((id, index) => ({ id, sequenceId: 'main', trackId: 'voice',
				startSample: index * 48_000, endSample: (index + 1) * 48_000,
				laneOrder: [laneIds[index]], lanes: [{ id: laneIds[index] }],
				takes: [{ id: takeIds[index], laneId: laneIds[index], sourceId: sources[index]!.id,
					startSample: index * 48_000, endSample: (index + 1) * 48_000, sourceStartSample: 0 }], compRegions: [],
			})), sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main' });
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: { ...createMemoryEngine(), getPlaybackGain: () => 1 } as unknown as Options['engine'],
			engineFactory: (() => { const engine = { ...createMemoryEngine(), setPlaybackGain() {} }; previews.push(engine); return engine; }) as unknown as Options['engineFactory'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Takes.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		const audition = mode === 'take' ? controller.actions.takeComp.auditionTake : controller.actions.takeComp.auditionLane;
		await audition(groupIds[0]!, memberIds[0]!);
		const next: unknown = await audition(groupIds[1]!, memberIds[1]!);
		assert.ok(next && typeof next === 'object' && 'state' in next && 'groupId' in next);
		assert.equal(next.state, 'playing', 'choosing another group starts its requested media rather than pausing the previous group');
		assert.equal(next.groupId, groupIds[1]);
		assert.equal(previews[0]?.loadedProjects.length, 2);
		const paused: unknown = await audition(groupIds[1]!, memberIds[1]!);
		assert.ok(paused && typeof paused === 'object' && 'state' in paused);
		assert.equal(paused.state, 'paused', 'the exact same group/member still toggles playback');
	});
}
