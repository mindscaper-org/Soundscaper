/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioTrackFreezeCoordinatorCommandV21 } from '../src/common/editor/audio-track-freeze-coordinator-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import { createDefaultAdmMetadata, setAdmEditorAssignment } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { MockAudioContext, MockNode } from './helpers/mock-audio-context.js';
import { createEffect, rackTailFrames } from '../src/common/editor/effects.js';
import type { EngineRenderMixOptions } from '../src/common/editor/engine/public-api.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createSoundscaperAudioFreezeActions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const RATE = 48_000;

test('MP31: Freeze and Commit Frozen Audio retain the release of an automated filter', async (context) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-freeze-tail' });
	const source = createAudioSource({ id: 'source', frameCount: 8, channelCount: 1, sampleRate: RATE });
	const writer = await store.beginSourceWrite(source.id, source);
	await writer.write([new Float32Array(8).fill(0.5)]); await writer.commit();
	const effect = createEffect('lowpass', { id: 'filter', params: { frequency: 1000, q: 0.707 } });
	const lane = normalizeAutomationLaneV21({ id: 'frequency', timebase: 'absolute-samples',
		address: { kind: 'effect', strip: { kind: 'track', id: 'voice' }, effectId: effect.id, parameterId: 'frequency' },
		points: [{ id: 'frequency-start', position: 0, value: 10 }], segments: [] });
	const expectedTail = rackTailFrames([effect], RATE, 10, [lane]);
	assert.ok(expectedTail > rackTailFrames([effect], RATE, 10));
	let current = createSoundscaperProject({ id: 'freeze-tail', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 12,
			durationFrames: 8, sourceDurationFrames: 8 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], effects: [effect] })], automationLanes: [lane] });
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	const calls: EngineRenderMixOptions[] = [];
	const binding = createSoundscaperAudioFreezeActions({ store, playback }, {
		get project() { return current; },
		actions: { edit: { commit(command: AudioTrackFreezeCoordinatorCommandV21) {
			current = applySoundscaperProjectCommand(current, command); return current;
		} } },
	}, { createId: (kind) => kind === 'source' ? 'frozen-source' : 'frozen-clip', createRenderEngine: () => ({
		loadProject() { /* Only render duration is isolated; storage and commit are real. */ },
		async renderTrack(_id, options = {}) {
			calls.push(options); return { channels: [new Float32Array(Number(options.outputFrames))] };
		},
		async dispose() { /* no-op */ },
	}) });
	context.after(async () => { await binding.dispose(); playback.dispose(); await store.close(); });
	await binding.actions.freeze('voice');
	assert.equal(calls[0]?.outputFrames, 8 + expectedTail);
	assert.equal(calls[0]?.endFrame, 20);
	assert.equal(calls[0]?.includeTail, expectedTail / RATE);
	await binding.actions.commit('voice');
	assert.equal(current.clips[0]?.durationFrames, 8 + expectedTail);
	assert.equal((await store.getSourceMetadata('frozen-source'))?.frameCount, 8 + expectedTail);
});

test('MP32: Freeze captures a source strip before authored ADM programme channel mapping', async (context) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-freeze-adm' });
	const source = createAudioSource({ id: 'source', frameCount: 8, channelCount: 1, sampleRate: RATE });
	const writer = await store.beginSourceWrite(source.id, source);
	await writer.write([new Float32Array(8).fill(0.5)]); await writer.commit();
	const clips = ['left', 'right'].map((id) => createAudioClip({ id: `${id}-clip`, sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 8, sourceDurationFrames: 8 }));
	let current = createSoundscaperProject({ id: 'freeze-adm', sources: [source], clips,
		tracks: ['left', 'right'].map((id) => createAudioTrack({ id, clipIds: [`${id}-clip`] })) });
	const adm = setAdmEditorAssignment(createDefaultAdmMetadata(current, 'stereo'), {
		stripKind: 'track', stripId: 'right', sourceChannel: 0, bedChannel: 'R', gain: 0.5,
	});
	current = createSoundscaperProject({ ...current, metadata: { ...current.metadata, adm } });
	assert.deepEqual(validateAdmAuthoredRouting(current.metadata.adm, current as unknown as RoutingProject), []);
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	const renderContext = new FreezeGraphContext();
	const binding = createSoundscaperAudioFreezeActions({ store, playback }, {
		get project() { return current; },
		actions: { edit: { commit(command: AudioTrackFreezeCoordinatorCommandV21) {
			current = applySoundscaperProjectCommand(current, command); return current;
		} } },
	}, { createId: (kind) => kind === 'source' ? 'adm-frozen-source' : 'adm-frozen-clip', createRenderEngine: () => ({
		loadProject(project) {
			assert.ok(project);
			buildProjectGraphV21(renderContext as unknown as BaseAudioContext,
				renderContext.destination as unknown as AudioNode, project, {
					includeMaster: false, includeTrackPan: false, respectMuteSolo: false, metering: false,
				});
		},
		async renderTrack(_id, options = {}) { return { channels: [new Float32Array(Number(options.outputFrames))] }; },
		async dispose() { /* no-op */ },
	}) });
	context.after(async () => { await binding.dispose(); playback.dispose(); await store.close(); });
	await binding.actions.freeze('right');
	assert.equal(renderContext.created.some((node) => node.connectionDetails.some((connection) =>
		connection.node.kind === 'merger' && connection.input === 1)), false,
	'pre-strip mono freeze must not send channel zero into programme output one');
	assert.deepEqual(current.metadata.adm, adm, 'the saved programme retains its authored mapping and gain');
});

class FreezeGraphContext extends MockAudioContext {
	readonly created: MockNode[] = [];
	override make(kind: string, properties: Record<string, unknown> = {}) {
		const node = super.make(kind, properties); this.created.push(node); return node;
	}
	createChannelSplitter(channels: number) { return this.make('splitter', { numberOfOutputs: channels }); }
	createChannelMerger(channels: number) { return this.make('merger', { numberOfInputs: channels }); }
}
