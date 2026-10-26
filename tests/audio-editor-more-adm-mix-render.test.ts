/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { normalizeAdmProjectMetadata, validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { MockAudioBuffer } from './helpers/mock-audio-context.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createDefaultAdmMetadata } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const withObject of [false, true]) for (const replaceOriginals of [true, false]) {
	test(`MP41: combined Mix and Render refuses to lose authored ADM delivery (object=${String(withObject)}, replace=${String(replaceOriginals)})`, async (context) => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const projectRuntime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `more-adm-mix-${String(withObject)}-${String(replaceOriginals)}` });
		const source = createAudioSource({ id: 'source', frameCount: 8, channelCount: 1, sampleRate: 48_000 });
		const writer = await store.beginSourceWrite(source.id, source); await writer.write([new Float32Array(8).fill(0.25)]); await writer.commit();
		const clips = ['first', 'second'].map((id) => createAudioClip({ id: `${id}-clip`, sourceId: source.id,
			timelineStartFrame: 0, durationFrames: 8, sourceDurationFrames: 8 }));
		let project = createSoundscaperProject({ id: 'adm-mix', sources: [source], clips,
			tracks: ['first', 'second'].map((id) => createAudioTrack({ id, clipIds: [`${id}-clip`] })) });
		const adm = { ...createDefaultAdmMetadata(project, 'stereo'), ...(withObject ? { objects: [{ id: 'voice-object', name: 'Voice',
			stripKind: 'track' as const, stripId: 'first', sourceChannel: 0, gain: 0.5, position: { azimuth: 30, elevation: 0, distance: 1 } }] } : {}) };
		project = createSoundscaperProject({ ...project, masterChannels: withObject ? 3 : 2, metadata: { ...project.metadata, adm } });
		const renders: { project: EngineProject; options: Record<string, unknown> }[] = [];
		const factory = (options: NonNullable<Parameters<typeof createMemoryRenderEngine>[0]>) => {
			const engine = createMemoryRenderEngine(options); let width = 2; let snapshot: EngineProject | null = null;
			return { ...engine, loadProject(value: EngineProject) { snapshot = value; width = Number(value.masterChannels); engine.loadProject(value); },
				async renderMix(range: Record<string, unknown>) { assert.ok(snapshot); renders.push({ project: snapshot, options: range }); return new MockAudioBuffer(width, Number(range.endFrame) - Number(range.startFrame), 48_000); } };
		};
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime, sessionController: projectRuntime.createSessionController(), store,
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: factory as unknown as Options['engineFactory'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready; await controller.actions.project.open(project);
		controller.actions.timeline.setSelection(0, 8, { trackIds: ['first', 'second'] });
		const before = structuredClone(controller.project);
		await assert.rejects(controller.actions.track.mixAndRender({ mixDown: true, mixDownChannelCount: 1, renderEffects: true, replaceOriginals }), /authored ADM/iu);
		assert.deepEqual(controller.project, before);
		if (withObject && !replaceOriginals) {
			await assert.rejects(controller.actions.track.mixAndRender({ mixDown: true, renderEffects: true, replaceOriginals }), /authored ADM/iu);
			assert.deepEqual(controller.project, before);
			return;
		}
		const result = await controller.actions.track.mixAndRender({ mixDown: true, renderEffects: true, replaceOriginals });
		assert.ok(result);
		const mixed = controller.project; assert.ok(mixed?.metadata.adm);
		const delivery = normalizeAdmProjectMetadata(mixed.metadata.adm);
		assert.equal(delivery.mode, 'authored'); if (delivery.mode !== 'authored') assert.fail('Expected authored delivery.');
		assert.deepEqual(delivery.bed.assignments.filter(({ stripId }) => stripId === result.trackId), [
			{ stripKind: 'track', stripId: result.trackId, sourceChannel: 0, bedChannel: 'L', gain: 1 },
			{ stripKind: 'track', stripId: result.trackId, sourceChannel: 1, bedChannel: 'R', gain: 1 },
		]);
		assert.equal(validateAdmAuthoredRouting(delivery, mixed as unknown as RoutingProject)
			.some(({ code }) => code === 'missing-terminal-strip'), false);
		if (withObject) assert.deepEqual(delivery.objects?.[0], { ...adm.objects?.[0], stripId: result.trackId, sourceChannel: 2, gain: 1 });
		controller.actions.edit.undo();
		assert.deepEqual({ ...controller.project, revision: before?.revision, updatedAt: before?.updatedAt }, before);
		const firstIndividual = renders.length;
		const printed = await controller.actions.track.mixAndRender({ mixDown: false, renderEffects: true, replaceOriginals: false });
		assert.ok(printed);
		assert.equal(renders.slice(firstIndividual).length, 2);
		for (const render of renders.slice(firstIndividual)) {
			assert.equal(render.project.metadata?.adm, null, 'individual print captures the strip before delivery mapping');
			assert.equal(render.options.includeTrackPan, false, 'the authored ADM programme suspended ordinary strip pan');
		}
		const individual = controller.project; assert.ok(individual?.metadata.adm);
		const individualAdm = normalizeAdmProjectMetadata(individual.metadata.adm);
		assert.equal(validateAdmAuthoredRouting(individualAdm, individual as unknown as RoutingProject)
			.some(({ code }) => code === 'missing-terminal-strip'), false);
		controller.actions.edit.undo();
		assert.deepEqual({ ...controller.project, revision: before?.revision, updatedAt: before?.updatedAt }, before);
		if (withObject) {
			const groupId = controller.actions.mixer.addBus('group'); assert.equal(typeof groupId, 'string');
			const graph = normalizeMixerGraphV21(controller.project?.mixer);
			const width = graph.groups.find(({ id }) => id === groupId)?.channelCount ?? 2;
			controller.actions.edit.commit({ type: 'mixer-graph/set', expected: graph, mixer: { ...graph,
				edges: graph.edges.map((edge) => edge.source.kind === 'track' && edge.source.id === 'first'
					? { ...edge, destination: { kind: 'mixer-node', id: String(groupId) }, channelMap: defaultMixerChannelMapV21(1, width) } : edge) } });
			const grouped = controller.project; assert.ok(grouped);
			const groupedAdm = createDefaultAdmMetadata(grouped, 'stereo');
			controller.actions.edit.commit({ type: 'metadata/update', changes: { adm: { ...groupedAdm,
				objects: [{ ...adm.objects?.[0], stripKind: 'group', stripId: groupId }] } } });
			const beforeBus = structuredClone(controller.project);
			await assert.rejects(controller.actions.track.mixAndRender({ mixDown: true, renderEffects: true, replaceOriginals }), /authored ADM/iu);
			assert.deepEqual(controller.project, beforeBus);
		}
	});
}
