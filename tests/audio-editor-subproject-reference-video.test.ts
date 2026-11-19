/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubprojectRenderer } from '../src/common/editor/controller/document/internal/subprojects/subproject-renderer.ts';
import { resolveSubprojectGraph } from '../src/common/editor/controller/document/internal/subprojects/subproject-graph.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

test('a saved audio subproject can render its mix with a reference video in the timeline', async context => {
	const audio = createNodeWebAudioEngineFactory(context);
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite('voice', { sampleRate: 48000, channelCount: 1 });
	await writer.write([new Float32Array(12000).fill(.25)]); await writer.commit();
	const child = createSoundscaperProject({ id: 'child', masterChannels: 1,
		sources: [{ id: 'voice', kind: 'audio', storageKey: 'voice', sampleRate: 48000, channelCount: 1, frameCount: 12000 },
			createVideoSource({ id: 'picture', sampleFrameCount: 48000, sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 320, height: 180 })],
		tracks: [{ id: 'audio', type: 'audio', clipIds: ['sound'] }, createVideoTrack({ id: 'video', clipIds: ['reference'] })],
		primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['audio', 'video'] }],
		clips: [{ id: 'sound', sourceId: 'voice', durationFrames: 12000, sourceDurationFrames: 12000 },
			{ id: 'reference', kind: 'video', sourceId: 'picture', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
	});
	const renderer = createSubprojectRenderer({ store, createId: () => 'rendered', createEngine: audio.createEngine,
		preflight: async () => undefined, projectForRuntimeConsumers });
	const node = await resolveSubprojectGraph(child.id, 'library', async () => child);
	const geometry = renderer.plan(child, 48000);
	const output = await renderer.render(node, geometry);
	const channels: (readonly Float32Array[])[] = [];
	for await (const chunk of store.readSourceChunks(String(output.source.storageKey))) channels.push(chunk.channels);
	assert.equal(output.source.frameCount, 12000, 'the longer reference video does not extend the audio placement');
	assert.ok(channels[0]![0]!.some(value => Math.abs(value) > .01), 'the audio mix remains audible');
	assert.equal(child.clips.length, 2, 'rendering leaves the child picture intact');
});
