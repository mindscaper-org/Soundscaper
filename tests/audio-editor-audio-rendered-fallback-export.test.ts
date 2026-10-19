/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitAudioRenderedFallbackExport,
	assertAudioRenderedFallbackExportSettings,
	projectForAudioRenderedFallbackExport,
} from '../src/common/editor/controller/export/internal/audio/audio-rendered-fallback-export.ts';
import { createPlaybackProjectService } from '../src/common/editor/controller/source/playback-project-service.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import {
	PROJECT_FEATURE_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectAudioFallbackIntegritySelector } from '../src/common/editor/project-fallback-integrity.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';

const FALLBACK_SOURCE_ID = 'fallback-audio';
const DIGEST = 'ef'.repeat(32);

test('unknown-role audio fallback export admits and returns only the selected private chunk provider', async () => {
	const featureId = 'org.example.future-mixer';
	const canonical = canonicalProject(featureId);
	const projection = projectForAudioRenderedFallbackExport(
		canonical,
		createPlaybackProjectService({}),
	);
	const events: string[] = [];
	const store = Object.freeze({ id: 'project-store' });
	const controller = new AbortController();
	const channels = Object.freeze([
		Float32Array.of(0.25, -0.25),
		Float32Array.of(-0.25, 0.25),
	]);
	const provider: EngineChunkSource = Object.freeze({
		channelCount: 2,
		frameCount: 12,
		chunkFrames: 4,
		sampleRate: 48_000,
		async readStorageChunk() { return channels; },
	});
	const assertCurrent = () => { events.push('task-current'); };

	assertAudioRenderedFallbackExportSettings(projection, { mode: 'mix', format: 'wav' });
	const admitted = await admitAudioRenderedFallbackExport(canonical, projection, {
		store,
		verifyProjectFallbackIntegrity(project, candidateStore, options) {
			events.push('integrity');
			assert.strictEqual(project, canonical);
			assert.strictEqual(candidateStore, store);
			assert.strictEqual(options.signal, controller.signal);
			assert.strictEqual(options.assertCurrent, assertCurrent);
			assert.deepEqual(options.audioFallback, expectedSelector(featureId));
			return Object.freeze({
				assertCurrent(candidate: unknown) {
					events.push('admission-current');
					assert.strictEqual(candidate, canonical);
				},
				getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector) {
					events.push('provider');
					assert.deepEqual(selector, expectedSelector(featureId));
					return provider;
				},
			});
		},
	}, {
		signal: controller.signal,
		assertCurrent,
	});

	assert.strictEqual(admitted, provider);
	assert.deepEqual(events, [
		'task-current',
		'integrity',
		'admission-current',
		'provider',
		'task-current',
	]);
	assert.strictEqual(await admitted?.readStorageChunk(0, { signal: controller.signal }), channels);
});

test('audio fallback export refuses simultaneous audio and video requirements from a real projection', () => {
	const featureId = 'org.example.future-mixer';
	const original = canonicalProject(featureId);
	const canonical = createCurrentAudioEditorProject({
		...original,
		sources: [...original.sources, createVideoSource({
			id: 'fallback-video', storageKey: 'fallback-video', frameCount: 12,
			sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
		})],
		featureRequirements: { schemaVersion: 1, requirements: [
			{
				id: 'publisher-audio-render', featureId,
				displayName: 'Publisher audio render', disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: FALLBACK_SOURCE_ID, sha256: DIGEST },
			},
			{
				id: 'publisher-video-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher video render', disposition: 'rendered-fallback',
				fallback: { kind: 'video', sourceId: 'fallback-video', sha256: 'ad'.repeat(32) },
			},
		] },
	});
	assert.throws(
		() => projectForAudioRenderedFallbackExport(canonical,
			createPlaybackProjectService({ audioEffects: true, videoEffects: false })),
		/simultaneous|multiple|exactly one|ambiguous/iu,
	);
});

test('stale and cancelled audio fallback exports stop before integrity IO', async () => {
	const canonical = canonicalProject();
	const projection = projectForAudioRenderedFallbackExport(
		canonical,
		createPlaybackProjectService({ audioEffects: false }),
	);
	let verificationCalls = 0;
	const stale = new DOMException('stale export', 'AbortError');
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, {
			store: null,
			verifyProjectFallbackIntegrity() {
				verificationCalls += 1;
				throw new Error('integrity should not start');
			},
		}, { assertCurrent() { throw stale; } }),
		(error: unknown) => error === stale,
	);
	assert.equal(verificationCalls, 0);

	const controller = new AbortController();
	const cancellation = new DOMException('export cancelled', 'AbortError');
	controller.abort(cancellation);
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, {
			store: null,
			verifyProjectFallbackIntegrity() {
				verificationCalls += 1;
				throw new Error('integrity should not start');
			},
		}, { signal: controller.signal, assertCurrent() {} }),
		(error: unknown) => error === cancellation,
	);
	assert.equal(verificationCalls, 0);
});

function canonicalProject(
	featureId: string = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
) {
	const original = createAudioSource({
		id: 'canonical-audio', storageKey: 'canonical-audio', frameCount: 8,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSource({
		id: FALLBACK_SOURCE_ID, storageKey: FALLBACK_SOURCE_ID, frameCount: 12,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const clip = createAudioClip({
		id: 'canonical-clip', sourceId: original.id, durationFrames: original.frameCount,
	});
	return createCurrentAudioEditorProject({
		id: 'audio-fallback-export', now: '2026-08-02T12:00:00.000Z',
		sources: [original, fallback], clips: [clip],
		tracks: [createAudioTrack({ id: 'canonical-track', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-audio-render',
			featureId,
			displayName: 'Publisher audio render',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: FALLBACK_SOURCE_ID, sha256: DIGEST },
		}] },
	});
}
function expectedSelector(
	featureId: string = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
): ProjectAudioFallbackIntegritySelector {
	return Object.freeze({
		requirementId: 'publisher-audio-render',
		featureId,
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: FALLBACK_SOURCE_ID,
		sha256: DIGEST,
		targetTrackId: null,
	});
}

