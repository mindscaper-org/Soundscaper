/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { zeroCrossingRouteProject } from './helpers/next-zero-crossing-route-project.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const mode of ['assignment', 'adm', 'detector'] as const) test(`NP038: zero crossing isolates the ordinary ${mode} output route`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const { project, source, samples } = zeroCrossingRouteProject(mode === 'detector' ? 'reference' : mode, mode === 'detector');
	const captures: EngineProject[] = [];
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([samples]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: () => createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
			softwareRenderer: ({ project: captured, captureStartFrame, endFrame, sampleRate }) => {
				captures.push(captured as EngineProject);
				return { channels: Array.from({ length: Number(captured.masterChannels) }, () => samples.slice(Number(captureStartFrame), Number(endFrame))), sampleRate };
			},
		}),
	});
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Crossing.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.setExactSelection(10_007, 30_007, { trackIds: ['voice'] });
	const before = structuredClone(controller.project);
	await controller.actions.timeline.zeroCross();
	assert.equal(captures.length, 1);
	const captured = captures[0]!, graph = normalizeMixerGraphV21(captured.mixer);
	const output = graph.edges.filter(edge => edge.kind === 'assignment' && edge.source.kind === 'track' && edge.source.id === 'voice');
	assert.ok(output.length && output.every(edge => edge.enabled && edge.level > 0), 'the capture bypasses a zero programme output level');
	const metadata = captured.metadata as Readonly<{ adm?: unknown }> | undefined;
	assert.equal(metadata?.adm ?? null, null, 'programme ADM assignments cannot hide the selected recording');
	const track = captured.tracks.find(track => track.id === 'voice'); assert.ok(track);
	assert.equal(track.gain, .6); assert.equal(track.mute, true, 'mute is retained for the renderer respectMuteSolo:false policy');
	if (mode === 'detector') {
		assert.equal(graph.edges.find(edge => edge.id === 'external-detector')?.level, .5);
		assert.ok(graph.edges.some(edge => edge.kind === 'assignment' && edge.source.kind === 'track' && edge.source.id === 'detector' && edge.level === 0));
		assert.ok(track.effects?.some(effect => effect.id === 'gate'), 'the selected rack and detector closure remain authored');
	}
	assert.deepEqual(controller.project?.tracks, before?.tracks); assert.deepEqual(controller.project?.master, before?.master);
	assert.deepEqual(controller.project?.mixer, before?.mixer); assert.deepEqual(controller.project?.metadata, before?.metadata);
});
