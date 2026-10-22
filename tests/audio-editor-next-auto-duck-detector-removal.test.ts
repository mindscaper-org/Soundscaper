/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { rewireSoundscaperRoutingEdge } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const { removed, disabledSpare } of [
	{ removed: ['old-control'], disabledSpare: false },
	{ removed: ['actual-control'], disabledSpare: false },
	{ removed: ['old-control', 'actual-control'], disabledSpare: false },
	{ removed: ['actual-control'], disabledSpare: true },
]) {
	test(`Remove tracks respects the graph detector when deleting ${removed.join('+')}${disabledSpare ? ' with a disabled spare route' : ''}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const source = createAudioSource({ id: 'tone', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
		const names = ['programme', 'old-control', 'actual-control'];
		const project = createSoundscaperProject({ sources: [source],
			clips: names.map(id => createAudioClip({ id: `${id}-clip`, sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })),
			tracks: names.map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-clip`] })) });
		const store = createMemoryStore();
		store.audioSources.set(source.id, [new Float32Array(source.frameCount).fill(.1)]);
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
		const effectId = controller.actions.effects.add({ type: 'audacity-auto-duck', scope: 'track', trackId: 'programme',
			options: { context: { controlTrackId: 'old-control' } } });
		assert.ok(effectId);
		const graph = normalizeMixerGraphV21(controller.project!.mixer);
		const route = graph.edges.find(edge => edge.destination.kind === 'effect-sidechain' && edge.destination.effectId === effectId);
		assert.ok(route);
		const rewired = rewireSoundscaperRoutingEdge(controller.project, graph, route.id, { kind: 'track', id: 'actual-control' }, route.destination);
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: graph as unknown as Readonly<Record<string, unknown>>,
			mixer: { ...rewired.graph, edges: [...rewired.graph.edges, ...(disabledSpare ? [{ ...route, id: 'inactive-spare', enabled: false }] : [])] } as unknown as Readonly<Record<string, unknown>> });
		controller.actions.timeline.setSelection(0, 0, { trackIds: removed });
		createAudacityActionRuntime(controller).actions.track.removeSelected();
		const next = controller.project!;
		const effect = next.tracks.find(track => track.id === 'programme')?.effects?.find(candidate => candidate.id === effectId);
		assert.ok(effect);
		const routes = normalizeMixerGraphV21(next.mixer).edges.filter(edge => edge.destination.kind === 'effect-sidechain' && edge.destination.effectId === effectId);
		assert.equal(effect.enabled, !removed.includes('actual-control'), 'only deleting the actual detector may disable the processor');
		assert.deepEqual(routes.filter(edge => edge.enabled).map(edge => edge.source), removed.includes('actual-control') ? [] : [{ kind: 'track', id: 'actual-control' }]);
		controller.actions.edit.undo();
		assert.equal(controller.project!.tracks.length, 3);
		assert.equal(controller.project!.tracks.find(track => track.id === 'programme')?.effects?.[0]?.enabled, true);
		controller.actions.edit.redo();
		assert.equal(controller.project!.tracks.find(track => track.id === 'programme')?.effects?.[0]?.enabled, !removed.includes('actual-control'));
	});
}
