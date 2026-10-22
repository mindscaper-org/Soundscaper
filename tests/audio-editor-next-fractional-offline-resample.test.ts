/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createAudioEditorController, createController, createCurrentAudioEditorProject, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY } from './helpers/audio-editor-multitrack-selection-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

async function sourceFixture(name: string, frames = 70_000) {
	const pcm = new Float32Array(frames).fill(.25);
	const { store } = await createTwoTrackFixture(name, new Map<string, Float32Array>(), 48_000);
	const writer = await store.beginSourceWrite('voice-source', { name: 'Voice.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1 });
	for (let start = 0; start < pcm.length; start += 65_536) await writer.write([pcm.subarray(start, start + 65_536)]);
	await writer.commit({ sampleRate: 48_000, channelCount: 1 });
	const initial = createCurrentAudioEditorProject({ id: 'fractional-resample', title: 'Voice', sampleRate: 48_000,
		sources: [{ id: 'voice-source', name: 'Voice.wav', storageKey: 'voice-source', frameCount: pcm.length,
			channelCount: 1, sampleRate: 48_000, chunkFrames: 65_536, sampleFormat: 'float32' }],
		tracks: [{ id: 'voice', name: 'Voice', type: 'audio', clipIds: ['voice-clip'] }],
		clips: [{ id: 'voice-clip', sourceId: 'voice-source', title: 'Voice', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: pcm.length, durationFrames: pcm.length }],
	});
	await store.saveProject(initial); await store.saveSetting('last-project-id', initial.id);
	return { store, pcm };
}

for (const reversed of [false, true]) test(`a selection export of a ${reversed ? 'reversed ' : ''}speed-changed chunk source respects fractional source bounds`, async () => {
	const { store, pcm } = await sourceFixture(`next-fractional-resample-${String(reversed)}`);
	const controller = createController(store, undefined);
	const offline: MockOfflineAudioContext[] = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: () => new MockAudioContext() as unknown as EngineAudioContext,
		offlineAudioContextFactory: options => {
			const context = new MockOfflineAudioContext(options); offline.push(context);
			return context as unknown as OfflineAudioContext;
		},
	});
	try {
		await controller.ready;
		// Clip context menu > Pitch and Speed > link pitch/tempo, then select an interior range.
		controller.actions.clip.setTimePitch('voice-clip', { speedRatio: 1.5, linkPitchAndTempo: true });
		if (reversed) await controller.actions.clip.reverse('voice-clip');
		controller.actions.timeline.setSelection(1, 16_001, { trackIds: ['voice'], clipIds: [] });
		const project = controller.getSnapshot().project;
		assert.ok(project);
		engine.loadProject(project, new Map(), { chunkSources: new Map([['voice-source', {
			channelCount: 1, frameCount: pcm.length, sampleRate: 48_000, chunkFrames: 65_536,
			readStorageChunk: (index: number) => [pcm.subarray(index * 65_536, Math.min(pcm.length, (index + 1) * 65_536))],
		}]]) });
		// File > Export Audio > Selection uses the production offline clip scheduler.
		const result = await engine.renderMix({ startFrame: 1, endFrame: 16_001, includeTail: false });
		assert.equal(result.length, 16_000);
		const scheduled = offline[0]?.bufferSources[0]?.buffer;
		assert.ok(scheduled);
		assert.equal(scheduled.length, 16_000);
		assert.deepEqual(scheduled.getChannelData(0), new Float32Array(16_000).fill(.25));
	} finally { await engine.dispose(); await controller.dispose(); }
});


test('the public Selection WAV export completes for a nonresident speed-changed recording', async () => {
	// Exceed the real 32 MiB resident-source ceiling; no fixture option forces streaming.
	const { store } = await sourceFixture('next-fractional-export', 8_400_001);
	const offline: MockOfflineAudioContext[] = [];
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
		engineFactory: options => createAudioEditorEngine({ ...options,
			audioContextFactory: () => new MockAudioContext() as unknown as EngineAudioContext,
			offlineAudioContextFactory: geometry => {
				const context = new MockOfflineAudioContext(geometry); offline.push(context);
				return context as unknown as OfflineAudioContext;
			},
		}),
	});
	try {
		await controller.ready;
		controller.actions.clip.setTimePitch('voice-clip', { speedRatio: 1.5, linkPitchAndTempo: true });
		controller.actions.timeline.setSelection(1, 16_001, { trackIds: ['voice'], clipIds: [] });
		const result: unknown = await controller.actions.export.start({ format: 'wav', range: 'selection', sampleFormat: 'float32', includeTail: false });
		assert.ok(result && typeof result === 'object' && 'mimeType' in result);
		assert.equal(result.mimeType, 'audio/wav');
		const scheduled = offline[0]?.bufferSources[0]?.buffer;
		assert.ok(scheduled, 'the existing export action must schedule the real stored chunk provider');
		assert.deepEqual(scheduled.getChannelData(0), new Float32Array(scheduled.length).fill(.25));
	} finally { await controller.dispose(); }
});
