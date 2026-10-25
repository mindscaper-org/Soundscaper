/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import {
	createClipTimePitchCacheService,
	type ClipTimePitchCachePort,
	type ClipTimePitchPlaybackState,
	type ClipTimePitchPreparationState,
} from '../src/common/editor/controller/source/clip-time-pitch-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createOwnedStateAccess } from '../src/common/editor/controller/shared/owned-state.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import type { ProjectVisualProject } from '../src/common/editor/controller/document/project-visual-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { FakeStaffPadClient, sourceStore } from './helpers/clip-time-pitch-cache-fixture.js';

for (const otherPitch of [0, -1200]) test(`an isolated mix render cannot retire an unrelated live cache, rendered pitch=${otherPitch}`, async context => {
	const source = createAudioSource({ id: 'source-a', sampleRate: 8000, frameCount: 32, channelCount: 1 });
	const project = createSoundscaperProject({ id: `isolated-cache-${otherPitch}`, sampleRate: 8000, sources: [source],
		clips: ['loop', 'print'].map(id => createAudioClip({ id, sourceId: source.id, sourceDurationFrames: 16,
			durationFrames: 16, pitchCents: id === 'loop' ? 1200 : otherPitch })),
		tracks: ['loop', 'print'].map(id => createAudioTrack({ id: `track-${id}`, clipIds: [id] }, 8000)),
	});
	const store = await sourceStore(`isolated-render-${otherPitch}`);
	const cache = new ClipTimePitchRenderCacheCoordinator({ store, client: new FakeStaffPadClient() });
	context.after(async () => { await cache.dispose(); await store.close(); });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const state: ClipTimePitchPlaybackState & ClipTimePitchPreparationState = {
		recordingStarting: false, recorder: null, playbackCacheGeneration: 0,
		playbackCacheAbort: null, playbackCacheRefreshAbort: null,
	};
	const service = createClipTimePitchCacheService({
		lifetime, state, playbackCacheState: createOwnedStateAccess(state, state),
		cache: cache as unknown as ClipTimePitchCachePort,
		sourceResolver: cache.createEngineSourceResolver(), sourceChunkProviders: new Map<string, unknown>(),
		getProject: () => project as unknown as ProjectVisualProject,
		captureProject: id => generation.capture(id), assertProject: token => generation.assertCurrent(token),
		createBufferFromChannels: async (channels, sampleRate) => ({ length: channels[0]!.length,
			numberOfChannels: channels.length, sampleRate, getChannelData: channel => channels[channel]! }),
		createRenderEngine: () => ({ dispose: () => undefined }), applyProjectToPlaybackEngine: async () => undefined,
		getPlaybackState: () => 'playing', handleError: error => { throw error; },
	});
	await Promise.all(await service.beginPlaybackCachePreparation(project));
	const prepared = cache.getLastValid('loop');
	assert.ok(prepared?.audioBuffer, 'The loop owns a materialized committed playback cache before rendering.');
	const preparedKey = prepared.cacheKey;
	const printedTrack = project.tracks.find(track => track.id === 'track-print'); assert.ok(printedTrack);
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject,
		[printedTrack as unknown as ControllerTrack], { mixDown: false, renderEffects: true });
	assert.deepEqual(snapshot.clips.map(clip => clip.id), ['print']);
	const printedEntries = await service.prepareCommittedTimePitchCaches(snapshot);
	assert.equal(printedEntries.length, otherPitch ? 1 : 0);
	assert.equal(cache.getLastValid('loop')?.cacheKey, preparedKey,
		'A render draft owns its requested preparation, not the lifetime of unrelated live clips.');
	assert.ok(cache.getLastValid('loop')?.audioBuffer);
	assert.equal(service.projectHasTimePitchClips(project as unknown as ProjectVisualProject), true);
	// Actual document retention remains able to reclaim a deleted clip and its buffer.
	cache.retainClipIds(['print']);
	assert.equal(cache.getLastValid('loop') === null, true);
	assert.equal(cache.getCommitted(preparedKey) === null, true);
});
