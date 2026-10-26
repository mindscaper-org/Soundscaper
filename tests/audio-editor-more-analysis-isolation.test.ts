/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import { scheduleProjectAutomationLanesV21 } from '../src/common/editor/engine/project-automation-scheduler-v21.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

class AnalysisGraphContext extends MockAudioContext {
	createChannelSplitter(channels: number) { return this.make('splitter', { numberOfOutputs: channels }); }
	createChannelMerger(channels: number) { return this.make('merger', { numberOfInputs: channels }); }
}

test('MP39: Analyze Selected Track keeps its isolation after production automation is scheduled', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-analysis-isolation' });
	const source = createAudioSource({ id: 'source', frameCount: 2048, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.id, source);
	await writer.write([new Float32Array(2048).fill(0.25)]); await writer.commit();
	const clips = ['selected', 'other'].map((id) => createAudioClip({ id: `${id}-clip`, sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 2048, sourceDurationFrames: 2048 }));
	const lane = (id: string, strip: { kind: 'track'; id: string } | { kind: 'master' }, parameterId: string, value: number) =>
		normalizeAutomationLaneV21({ id, timebase: 'absolute-samples', address: { kind: 'strip', strip, parameterId },
			points: [{ id: `${id}-point`, position: 0, value }], segments: [] });
	const project = createSoundscaperProject({ id: 'analysis-isolation', sources: [source], clips,
		tracks: ['selected', 'other'].map((id) => createAudioTrack({ id, clipIds: [`${id}-clip`] })),
		automationLanes: [lane('selected-mute', { kind: 'track', id: 'selected' }, 'mute', 1),
			lane('other-mute', { kind: 'track', id: 'other' }, 'mute', 0), lane('master-gain', { kind: 'master' }, 'gain', 0.25)] });
	const gains: number[][] = [];
	const engineFactory = (options: NonNullable<Parameters<typeof createMemoryRenderEngine>[0]>) => {
		const engine = createMemoryRenderEngine(options);
		let snapshot: EngineProject | null = null;
		return { ...engine, loadProject(value: EngineProject) { snapshot = value; engine.loadProject(value); },
			async renderMix(range: Record<string, unknown>) {
				assert.ok(snapshot);
				const audioContext = new AnalysisGraphContext();
				const graph = buildProjectGraphV21(audioContext as unknown as BaseAudioContext,
					audioContext.destination as unknown as AudioNode, snapshot, { metering: false });
				scheduleProjectAutomationLanesV21(snapshot, graph.parameterRegistry, { fromFrame: 0, toFrame: 2048,
					sampleRate: 48_000, contextSampleRate: 48_000, contextStartTime: 0 });
				gains.push([{ kind: 'track', id: 'selected' }, { kind: 'track', id: 'other' }, { kind: 'master' }].map((strip) => {
					const target = graph.parameterRegistry.get({ kind: 'strip', strip, parameterId: strip.kind === 'master' ? 'gain' : 'mute' });
					assert.equal(target?.binding.kind, 'audio-param');
					return target?.binding.kind === 'audio-param' ? target.binding.params[0]!.param.value : NaN;
				}));
				return engine.renderMix(range);
			} };
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: engineFactory as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.timeline.selectTrack('selected'); controller.actions.timeline.setSelection(0, 2048);
	await controller.actions.analysis.run('track');
	assert.deepEqual(gains, [[1, 0, 1]], 'isolated selected gate, other gate, and neutral master gain survive scheduling');
	const lanes = controller.project?.automationLanes;
	assert.ok(Array.isArray(lanes));
	assert.equal(lanes.length, 3, 'analysis does not change authored automation');
});
