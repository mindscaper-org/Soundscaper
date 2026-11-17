/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubprojectRenderer } from '../src/common/editor/controller/document/internal/subprojects/subproject-renderer.ts';
import { resolveSubprojectGraph } from '../src/common/editor/controller/document/internal/subprojects/subproject-graph.ts';
import type { SubprojectDocument } from '../src/common/editor/controller/document/subproject-actions.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

for (const streaming of [false, true]) test(`relinking a mono proxy to a stereo child preserves its output layout with streaming=${streaming}`, async context => {
	const audio = createNodeWebAudioEngineFactory(context);
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite('source', { sampleRate: 48000, channelCount: 2 });
	await writer.write([new Float32Array(512).fill(.25), new Float32Array(512).fill(.5)]); await writer.commit();
	const child = createSoundscaperProject({ id: 'child', masterChannels: 2,
		sources: [{ id: 'source', kind: 'audio', storageKey: 'source', sampleRate: 48000, channelCount: 2, frameCount: 512 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 512, sourceDurationFrames: 512 }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }] }) as SubprojectDocument;
	let id = 0;
	const renderer = createSubprojectRenderer({ store, createId: () => `output-${++id}`, createEngine: () => {
		const engine = audio.createEngine();
		// Exercise the sink publication boundary with real offline mixer PCM;
		// the headless Node host has no physical streaming output device.
		return streaming ? { loadProject: engine.loadProject.bind(engine), dispose: engine.dispose.bind(engine),
			async renderMixToSink(options = {}) {
				const channels = audioBufferChannels(await engine.renderMix(options));
				assert.equal(typeof options.sink, 'function');
				if (typeof options.sink === 'function') await options.sink(channels, { sampleRate: 48000 });
				return { sampleRate: 48000, channelCount: channels.length, frameCount: channels[0]!.length, chunkCount: 1 };
			},
		} : engine;
	},
		preflight: async () => undefined, projectForRuntimeConsumers });
	const node = await resolveSubprojectGraph(child.id, 'library', async () => child);
	const output = await renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 512 });
	assert.equal(output.source.channelCount, 1);
	const channels: (readonly Float32Array[])[] = [];
	for await (const chunk of store.readSourceChunks(String(output.source.storageKey))) channels.push(chunk.channels);
	assert.equal(channels[0]!.length, 1);
	assert.ok(Math.abs(channels[0]![0]![256]! - .375) < 1e-6);
});
