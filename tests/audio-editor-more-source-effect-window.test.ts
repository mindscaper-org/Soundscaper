/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { SOURCE_CHUNK_FRAMES } from '../src/common/editor/source-pcm-contract.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('a short source-editor effect audition demand-loads only its window from a large original', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const source = createAudioSource({ id: 'large-source', frameCount: 48_000 * 3600,
		channelCount: 1, sampleRate: 48_000, chunkFrames: SOURCE_CHUNK_FRAMES });
	const project = createSoundscaperProject({ id: 'source-effect-window', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const store = createMemoryStore();
	const reads: number[] = [];
	let fullLoads = 0;
	Object.assign(store, {
		getSourceMetadata: async () => ({ ...source, chunkCount: Math.ceil(source.frameCount / SOURCE_CHUNK_FRAMES) }),
		readSourceChunk: async (_id: string, index: number) => {
			reads.push(index);
			return { channels: [new Float32Array(Math.min(SOURCE_CHUNK_FRAMES, source.frameCount - index * SOURCE_CHUNK_FRAMES)).fill(0.25)] };
		},
		loadSourceAudioBuffer: async () => { fullLoads++; throw new Error('The large original must remain demand loaded.'); },
	});
	const audio = new MockAudioContext();
	const played: AudioBuffer[] = [];
	Object.assign(audio, { createBufferSource: () => ({ buffer: null as AudioBuffer | null,
		connect() {}, disconnect() {}, stop() {}, onended: null,
		start() { assert.ok(this.buffer); played.push(this.buffer); } }) });
	const engine = { ...createMemoryEngine(), getAudioContext: async () => audio, getPlaybackDestination: () => audio.destination };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await store.saveProject(project);
	await controller.actions.project.open(project);
	reads.length = 0;
	// Clip Source Editor's focused selection drives the same action port.
	controller.actions.effects.setSourceSelection({ clipId: 'clip', startFrame: 480_000, endFrame: 528_000 });
	await controller.actions.effects.setSelectionType('audacity-invert');
	assert.equal(await controller.actions.effects.previewSelection(), true);
	assert.equal(fullLoads, 0);
	assert.ok(reads.length > 0 && reads.length <= 2);
	assert.deepEqual([...new Set(reads)], [7, 8]);
	assert.equal(played.length, 1);
	assert.equal(played[0]!.length, 48_000);
	assert.equal(played[0]!.getChannelData(0)[100], -0.25);
	reads.length = 0;
	const amplify = await controller.actions.effects.setSelectionType('audacity-amplify');
	assert.equal(Math.round(Number(amplify.gainDb) * 1000), 12_041, 'Amplify derives its default from the bounded selection peak');
	assert.equal(fullLoads, 0);
	assert.deepEqual(reads, [7, 8]);
});
